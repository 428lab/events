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
import { Link as RouterLink, Navigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useUserProfile } from "../api/userHooks.js";
import { BigQrDialog } from "../components/BigQrDialog.js";
import { LicenseCardSvg } from "../components/licenseCard/LicenseCardSvg.js";
import { toCardData } from "../components/licenseCard/cardData.js";
import { generateCardPng, OG_UPLOAD_W } from "../components/licenseCard/profileCardPng.js";
import {
  BG_VARIANTS,
  CARD_THEMES,
} from "../components/licenseCard/cardTheme.js";
import type {
  CardBgVariant,
  CardThemeKey,
} from "../components/licenseCard/cardTheme.js";
import {
  cardLook,
  cardLookKey,
  loadLocalCardLook,
  saveLocalCardLook,
} from "../components/licenseCard/cardLook.js";
// PNG書き出し時にSVGへ埋め込むフォント（SVG-as-image はページのフォントを参照できない）
/** プロフィールカードのデザイン画面 (#178)。
 * カード本体の描画は components/licenseCard/LicenseCardSvg.tsx にあり、
 * ここでは背景パターン選択・印刷・PNG書き出しなどページの振る舞いを担当する。
 *
 * **本人だけの画面** (#334)。カードは持ち主が決めた意匠で描くものなので、
 * 他人のカードには編集も印刷も無い。他人が直接URLを開いたらその人の
 * プロフィールへ戻す。見た目の決め方は components/licenseCard/cardLook.ts にある。 */

// ---------------------------------------------------------------------------
// 書き出し（PNG）と印刷
// ---------------------------------------------------------------------------

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
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const { data, isLoading, isError, refetch } = useUserProfile(id);
  // 表示中の見た目。保存済みの値が届くまでは手元の既定で描く
  const [variant, setVariant] = useState<CardBgVariant>(
    () => loadLocalCardLook().variant,
  );
  const [theme, setTheme] = useState<CardThemeKey>(
    () => loadLocalCardLook().theme,
  );
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

  // 保存済みの見た目に合わせる (#334)。データが届いたら、その人が前回選んだ
  // 組み合わせで描き直す。手元の既定のまま描いていると、下のOG画像アップロードが
  // 保存済みの組み合わせと食い違った絵で上書きしてしまう。
  // 一度も保存していない（cardImageKey が無い）ときだけ手元の既定を使う
  const savedLookKey = data?.cardImageKey ?? null;
  const profileId = data?.id;
  useEffect(() => {
    if (!profileId) return;
    const look = cardLook(savedLookKey);
    setVariant(look.variant);
    setTheme(look.theme);
  }, [profileId, savedLookKey]);

  // 本人が開いたら、表示中のカードをPNG化してOG画像としてサーバへ静かに送る (#193)。
  // ダウンロードと同じ生成経路（フォント・アバター埋め込み）を使うので見た目は一致する。
  // 失敗してもページ利用には影響させない（既定OG画像のまま）
  const isMe = data?.isMe ?? false;
  useEffect(() => {
    const combo = cardLookKey({ variant, theme });
    const generation = data?.cardImageGeneration;
    if (!generation || !profileId) return;
    const uploadKey = `${profileId}:${generation}:${combo}`;
    let canceled = false, completed = false;
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
          if (canceled) return;
          const res = await fetch(`/api/me/card-image?k=${combo}&g=${generation}`, {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "image/png" },
            body: png,
          });
          if (res.status === 409) {
            uploadedVariantsRef.current.delete(uploadKey);
            if (!canceled) await refetch();
            return;
          }
          if (canceled) return;
          if (!res.ok) {
            // 理由が分からないと直しようがないので、状態から言葉にする
            throw new Error(
              res.status === 413
                ? "画像が大きすぎて保存できませんでした"
                : `保存に失敗しました（${res.status}）`,
            );
          }
          completed = true;
          setOgStatus("done");
        } catch (e) {
          if (canceled) return;
          uploadedVariantsRef.current.delete(uploadKey);
          console.warn("プロフィールカードのOG画像更新に失敗しました", e);
          setOgStatus("error");
        }
      })();
    }, 800);
    return () => { canceled = true; clearTimeout(timer); if (!completed) uploadedVariantsRef.current.delete(uploadKey); };
  }, [isMe, variant, theme, data, profileId, refetch]);

  if (isError) return <Alert severity="info">ユーザーが見つかりません。</Alert>;
  if (isLoading || !data) return <Typography>読み込み中…</Typography>;

  // ここは自分のカードを仕立てる画面 (#334)。他人のカードは編集も印刷もしないので、
  // 直接URLを開かれたらその人のプロフィールへ戻す（カードはそこに載っている）
  if (!data.isMe) {
    return <Navigate to={`/users/${data.handle ?? id}`} replace />;
  }

  const card = toCardData(data, id, window.location.host);
  // QRの飛び先は公開プロフィール。?ref=card は将来プロフィールビュー計測を入れた際に流入元として集計される（許可リスト登録済み）
  const qrUrl = `${window.location.origin}/users/${card.handle}?ref=card`;

  // 選んだ組み合わせはサーバー（＝持ち主の意匠）に保存されるが、名札を刷るときなどの
  // 既定として手元にも覚えておく。ここは本人の画面なので自分の既定を書いてよい
  const selectVariant = (v: CardBgVariant) => {
    setVariant(v);
    saveLocalCardLook({ variant: v, theme });
  };

  const selectTheme = (t: CardThemeKey) => {
    setTheme(t);
    saveLocalCardLook({ variant, theme: t });
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
              label={t(v.labelKey)}
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
          {CARD_THEMES.map((th) => (
            <Chip
              key={th.key}
              label={t(th.nameKey)}
              color={theme === th.key ? "primary" : "default"}
              variant={theme === th.key ? "filled" : "outlined"}
              onClick={() => selectTheme(th.key)}
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
          {/* 交流の場で相手に読み取ってもらう用の大きなQR (#324) */}
          <Button
            variant="outlined"
            startIcon={<QrCode2Icon />}
            onClick={() => setQrOpen(true)}
          >
            QRを大きく表示
          </Button>
        </Stack>

        <BigQrDialog
          open={qrOpen}
          onClose={() => setQrOpen(false)}
          name={card.name}
          avatarUrl={data.avatarUrl}
        />

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
      </Stack>
    </Box>
  );
}
