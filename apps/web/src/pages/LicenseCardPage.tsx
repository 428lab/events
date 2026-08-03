import { useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  GlobalStyles,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import PrintIcon from "@mui/icons-material/Print";
import DownloadIcon from "@mui/icons-material/Download";
import { Link as RouterLink, useParams } from "react-router-dom";
import { useUserProfile } from "../api/userHooks.js";
import {
  BG_STORAGE_KEY,
  BG_VARIANTS,
  EXPORT_H,
  EXPORT_W,
  LicenseCardSvg,
  toCardData,
} from "../components/licenseCard/LicenseCardSvg.js";
import type { CardBgVariant } from "../components/licenseCard/LicenseCardSvg.js";
// PNG書き出し時にSVGへ埋め込むフォント（SVG-as-image はページのフォントを参照できない）
import jakarta600Url from "@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-600-normal.woff2?url";
import jakarta700Url from "@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-700-normal.woff2?url";

/** ライセンスカードジェネレーターのページ (#178)。
 * カード本体の描画は components/licenseCard/LicenseCardSvg.tsx にあり、
 * ここでは背景パターン選択・印刷・PNG書き出しなどページの振る舞いを担当する。 */

function loadBgVariant(): CardBgVariant {
  const saved = localStorage.getItem(BG_STORAGE_KEY);
  return BG_VARIANTS.some((v) => v.key === saved)
    ? (saved as CardBgVariant)
    : "rosette";
}

// ---------------------------------------------------------------------------
// 書き出し（PNG）と印刷
// ---------------------------------------------------------------------------

/** URLの内容を dataURL 化する（フォント・アバターのSVG埋め込み用） */
async function fetchAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** 表示中のSVGを自己完結した文字列へシリアライズする。
 * - フォントを dataURL の @font-face として埋め込む（SVG-as-image対策）
 * - アバターを dataURL に差し替える（外部URLのままだと canvas が汚染されPNG化できない。
 *   Discord CDN は ACAO:* を返すため fetch で取得できる。失敗時は image を除去して
 *   下のイニシャル矩形で出力を続行する） */
async function buildExportSvg(svgEl: SVGSVGElement): Promise<string> {
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  try {
    const [w600, w700] = await Promise.all([
      fetchAsDataUrl(jakarta600Url),
      fetchAsDataUrl(jakarta700Url),
    ]);
    const style = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "style",
    );
    style.textContent =
      `@font-face{font-family:'Plus Jakarta Sans';font-weight:600;src:url(${w600}) format('woff2')}` +
      `@font-face{font-family:'Plus Jakarta Sans';font-weight:700;src:url(${w700}) format('woff2')}`;
    clone.insertBefore(style, clone.firstChild);
  } catch {
    /* フォントが取得できなくてもシステムフォントで出力を続行 */
  }
  // コミュニティアイコン等、SVG内の全imageを dataURL 化（SVG-as-image は外部参照を読まない）
  for (const img of Array.from(clone.querySelectorAll("image:not([data-avatar])"))) {
    const href = img.getAttribute("href");
    if (!href || href.startsWith("data:")) continue;
    try {
      img.setAttribute("href", await fetchAsDataUrl(href));
    } catch {
      img.remove(); // 取得失敗時は下地（イニシャル/プレースホルダ）を見せる
    }
  }
  const avatar = clone.querySelector("image[data-avatar]");
  if (avatar) {
    try {
      const href = avatar.getAttribute("href");
      if (!href) throw new Error("no avatar href");
      avatar.setAttribute("href", await fetchAsDataUrl(href));
    } catch {
      avatar.remove();
    }
  }
  return new XMLSerializer().serializeToString(clone);
}

/** SVG文字列を 2148x1300 のPNGにラスタライズしてダウンロードする */
async function downloadAsPng(svgText: string, fileName: string): Promise<void> {
  const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("SVGの読み込みに失敗しました"));
      img.src = svgUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = EXPORT_W;
    canvas.height = EXPORT_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas を初期化できませんでした");
    ctx.drawImage(img, 0, 0, EXPORT_W, EXPORT_H);
    const png = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!png) throw new Error("PNGの生成に失敗しました");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(png);
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

// ---------------------------------------------------------------------------
// ページ本体
// ---------------------------------------------------------------------------

export function LicenseCardPage() {
  const { id = "" } = useParams();
  const { data, isLoading, isError } = useUserProfile(id);
  const [variant, setVariant] = useState<CardBgVariant>(loadBgVariant);
  const [busy, setBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  if (isError) return <Alert severity="info">ユーザーが見つかりません。</Alert>;
  if (isLoading || !data) return <Typography>読み込み中…</Typography>;

  const card = toCardData(data, id, window.location.host);
  // QRの飛び先は公開プロフィール。?ref=card は将来プロフィールビュー計測を入れた際に流入元として集計される（許可リスト登録済み）
  const qrUrl = `${window.location.origin}/users/${card.handle}?ref=card`;

  const selectVariant = (v: CardBgVariant) => {
    setVariant(v);
    localStorage.setItem(BG_STORAGE_KEY, v);
  };

  const handleDownload = async () => {
    if (!svgRef.current || busy) return;
    setBusy(true);
    setExportError(null);
    try {
      const svgText = await buildExportSvg(svgRef.current);
      await downloadAsPng(svgText, `events-lab-card-${card.handle}.png`);
    } catch (e) {
      setExportError(
        e instanceof Error ? e.message : "PNGの書き出しに失敗しました",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 1100, mx: "auto" }}>
      {/* 印刷時はカードのみを 91×55mm（名刺サイズ・横）で出力する。
          SVGはベクターなのでそのまま印刷されるが、環境によっては
          印刷ダイアログの「背景のグラフィック」を有効にすると確実 */}
      <GlobalStyles
        styles={{
          "@media print": {
            "@page": { size: "91mm 55mm", margin: 0 },
            // 隠した要素がレイアウト高さを持つと2ページ目以降にカードが複製されるため、
            // ページ全体を1ページ分に固定する（Safari は @page size 非対応＝用紙左上に印字）
            html: { height: "55mm", overflow: "hidden" },
            body: { height: "55mm", overflow: "hidden" },
            "body *": { visibility: "hidden" },
            "#license-card-print, #license-card-print *": {
              visibility: "visible",
            },
            "#license-card-print": {
              position: "fixed",
              inset: 0,
              width: "91mm",
              height: "55mm",
              breakInside: "avoid",
            },
            "#license-card-print svg": {
              width: "91mm !important",
              height: "55mm !important",
              display: "block",
            },
          },
        }}
      />
      <Stack spacing={2}>
        <Box>
          <Typography variant="h5" fontWeight={700}>
            ライセンスカード
          </Typography>
          <Typography variant="caption" color="text.secondary">
            印刷して名札ホルダーに入れられます（91×55mm）
            {" ・ "}
            <Link component={RouterLink} to={`/users/${card.handle}`}>
              プロフィールへ戻る
            </Link>
          </Typography>
        </Box>

        {/* 背景パターンの選択（選択は端末に保存） */}
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {BG_VARIANTS.map((v) => (
            <Chip
              key={v.key}
              label={v.label}
              color={variant === v.key ? "primary" : "default"}
              variant={variant === v.key ? "filled" : "outlined"}
              onClick={() => selectVariant(v.key)}
            />
          ))}
        </Stack>

        <Box
          id="license-card-print"
          sx={{
            borderRadius: "28px",
            // カード自体が薄色なのでダークテーマでも浮くよう影をつける
            boxShadow: 3,
            overflow: "hidden",
          }}
        >
          <LicenseCardSvg
            card={card}
            variant={variant}
            qrUrl={qrUrl}
            svgRef={svgRef}
          />
        </Box>

        {exportError && <Alert severity="error">{exportError}</Alert>}

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button
            variant="contained"
            startIcon={<PrintIcon />}
            onClick={() => window.print()}
          >
            印刷する
          </Button>
          <Button
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={handleDownload}
            disabled={busy}
          >
            {busy ? "書き出し中…" : "PNGをダウンロード"}
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}
