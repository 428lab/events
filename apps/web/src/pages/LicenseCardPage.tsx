import { useEffect, useRef, useState } from "react";
import { CircularProgress,
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
import QrCode2Icon from "@mui/icons-material/QrCode2";
import { Link as RouterLink, useParams } from "react-router-dom";
import { useUserProfile } from "../api/userHooks.js";
import { BigQrDialog } from "../components/BigQrDialog.js";
import {
  BG_STORAGE_KEY,
  BG_VARIANTS,
  CARD_THEMES,
  EXPORT_H,
  EXPORT_W,
  LicenseCardSvg,
  THEME_STORAGE_KEY,
  toCardData,
} from "../components/licenseCard/LicenseCardSvg.js";
import type {
  CardBgVariant,
  CardThemeKey,
} from "../components/licenseCard/LicenseCardSvg.js";
// PNG書き出し時にSVGへ埋め込むフォント（SVG-as-image はページのフォントを参照できない）
import jakarta600Url from "@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-600-normal.woff2?url";
import jakarta700Url from "@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-700-normal.woff2?url";

/** プロフィールカードジェネレーターのページ (#178)。
 * カード本体の描画は components/licenseCard/LicenseCardSvg.tsx にあり、
 * ここでは背景パターン選択・印刷・PNG書き出しなどページの振る舞いを担当する。 */

function loadBgVariant(): CardBgVariant {
  const saved = localStorage.getItem(BG_STORAGE_KEY);
  return BG_VARIANTS.some((v) => v.key === saved)
    ? (saved as CardBgVariant)
    : "rosette";
}

function loadCardTheme(): CardThemeKey {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  return CARD_THEMES.some((t) => t.key === saved)
    ? (saved as CardThemeKey)
    : "indigo";
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

/** シェア時のOG画像に使う幅。
 *
 * ダウンロード用の 2148px をそのまま送ると 2MB の上限を超えて 413 で弾かれる
 * （実際に保存できていなかった）。OG画像は表示上 1200px あれば足りるので、
 * 保存用だけ小さくする。ダウンロードは印刷にも使えるよう高解像度のまま */
const OG_UPLOAD_W = 1200;

/** 表示中のSVGをPNG Blob にラスタライズする。
 * ダウンロードとOG画像アップロード (#193) の両方で同じ生成経路を使う */
async function generateCardPng(
  svgEl: SVGSVGElement,
  width: number = EXPORT_W,
): Promise<Blob> {
  const svgText = await buildExportSvg(svgEl);
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
    // 縦横比はカードのまま保つ
    const height = Math.round((width * EXPORT_H) / EXPORT_W);
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas を初期化できませんでした");
    ctx.drawImage(img, 0, 0, width, height);
    const png = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!png) throw new Error("PNGの生成に失敗しました");
    return png;
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

/** PNG Blob をファイルとしてダウンロードさせる */
function downloadBlob(png: Blob, fileName: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(png);
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}

// ---------------------------------------------------------------------------
// ページ本体
// ---------------------------------------------------------------------------

export function LicenseCardPage() {
  const { id = "" } = useParams();
  const { data, isLoading, isError } = useUserProfile(id);
  const [variant, setVariant] = useState<CardBgVariant>(loadBgVariant);
  const [theme, setTheme] = useState<CardThemeKey>(loadCardTheme);
  const [busy, setBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  // 交流の場で相手に読み取ってもらう用の大きなQR (#324)。自分のカードのときだけ
  const [qrOpen, setQrOpen] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  // OG画像アップロード済みの「背景×配色」（マウント中は同じ組み合わせを二重送信しない） (#193)
  const uploadedVariantsRef = useRef<Set<string>>(new Set());
  // OG画像の生成/保存状態（本人のみ表示）
  const [ogStatus, setOgStatus] = useState<
    "idle" | "generating" | "done" | "error"
  >("idle");

  // 本人が開いたら、表示中のカードをPNG化してOG画像としてサーバへ静かに送る (#193)。
  // ダウンロードと同じ生成経路（フォント・アバター埋め込み）を使うので見た目は一致する。
  // 失敗してもページ利用には影響させない（既定OG画像のまま）
  const isMe = data?.isMe ?? false;
  useEffect(() => {
    const uploadKey = `${variant}:${theme}`;
    if (!isMe || uploadedVariantsRef.current.has(uploadKey)) return;
    // 描画直後の連打（背景・配色切り替え）をまとめるための小さなディレイ
    const timer = setTimeout(() => {
      const svgEl = svgRef.current;
      if (!svgEl || uploadedVariantsRef.current.has(uploadKey)) return;
      uploadedVariantsRef.current.add(uploadKey);
      setOgStatus("generating");
      void (async () => {
        try {
          const png = await generateCardPng(svgEl, OG_UPLOAD_W);
          const res = await fetch(`/api/me/card-image?k=${variant}-${theme}`, {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "image/png" },
            body: png,
          });
          if (!res.ok) {
            // 理由が分からないと直しようがないので、状態から言葉にする
            throw new Error(
              res.status === 413
                ? "画像が大きすぎて保存できませんでした"
                : `保存に失敗しました（${res.status}）`,
            );
          }
          setOgStatus("done");
        } catch (e) {
          console.warn("プロフィールカードのOG画像更新に失敗しました", e);
          setOgStatus("error");
        }
      })();
    }, 800);
    return () => clearTimeout(timer);
  }, [isMe, variant, theme]);

  if (isError) return <Alert severity="info">ユーザーが見つかりません。</Alert>;
  if (isLoading || !data) return <Typography>読み込み中…</Typography>;

  const card = toCardData(data, id, window.location.host);
  // QRの飛び先は公開プロフィール。?ref=card は将来プロフィールビュー計測を入れた際に流入元として集計される（許可リスト登録済み）
  const qrUrl = `${window.location.origin}/users/${card.handle}?ref=card`;

  const selectVariant = (v: CardBgVariant) => {
    setVariant(v);
    localStorage.setItem(BG_STORAGE_KEY, v);
  };

  const selectTheme = (t: CardThemeKey) => {
    setTheme(t);
    localStorage.setItem(THEME_STORAGE_KEY, t);
  };

  const handleDownload = async () => {
    if (!svgRef.current || busy) return;
    setBusy(true);
    setExportError(null);
    try {
      const png = await generateCardPng(svgRef.current);
      downloadBlob(png, `events-lab-card-${card.handle}.png`);
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
            プロフィールカード
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
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
          <Typography variant="caption" color="text.secondary" sx={{ minWidth: 32 }}>
            背景
          </Typography>
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

        {/* 配色テーマの選択（選択は端末に保存） */}
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
          <Typography variant="caption" color="text.secondary" sx={{ minWidth: 32 }}>
            色
          </Typography>
          {CARD_THEMES.map((t) => (
            <Chip
              key={t.key}
              label={t.name}
              color={theme === t.key ? "primary" : "default"}
              variant={theme === t.key ? "filled" : "outlined"}
              onClick={() => selectTheme(t.key)}
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
            theme={theme}
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
          {data.isMe && (
            <Button
              variant="outlined"
              startIcon={<QrCode2Icon />}
              onClick={() => setQrOpen(true)}
            >
              QRを大きく表示
            </Button>
          )}
        </Stack>

        {data.isMe && (
          <BigQrDialog
            open={qrOpen}
            onClose={() => setQrOpen(false)}
            name={card.name}
            avatarUrl={data.avatarUrl}
          />
        )}

        {data.isMe && (
          <Stack spacing={0.25}>
            {ogStatus === "generating" && (
              <Stack direction="row" spacing={1} alignItems="center">
                <CircularProgress size={14} />
                <Typography variant="caption" color="text.secondary">
                  プロフィールカードを作成しています…
                </Typography>
              </Stack>
            )}
            {ogStatus === "done" && (
              <Typography variant="caption" color="success.main">
                シェア用のカード画像を保存しました
              </Typography>
            )}
            {ogStatus === "error" && (
              <Typography variant="caption" color="warning.main">
                カード画像の保存に失敗しました（リロードで再試行できます）
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary">
              このカードはプロフィールURLをシェアしたときのOG画像として使われます
            </Typography>
          </Stack>
        )}
      </Stack>
    </Box>
  );
}
