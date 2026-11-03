import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Alert, Box, Button, GlobalStyles, Stack, Typography } from "@mui/material";
import { flushSync } from "react-dom";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { DECK_H, DECK_W } from "@eventer/shared";
import { usePublicDeck } from "../api/deckHooks.js";
import { SlideStage } from "../components/SlideStage.js";
import { ensureDeckFonts } from "../lib/deckFonts.js";

/** 画像が読めない（エラーも出さない）ときでも、ここまで待ったら印刷に進む */
const READY_TIMEOUT_MS = 15_000;

/** 印刷では消すもの。共通ヘッダー・フッター・この画面の操作・重なり系 */
const HIDDEN_IN_PRINT = [
  ".MuiAppBar-root", ".version-footer", ".deck-print-controls",
  ".MuiSnackbar-root", ".MuiDialog-root", ".MuiPopover-root", ".MuiTooltip-popper", ".MuiFab-root",
];

/** 1 ページ＝1 スライド（960×540）。用紙そのものをスライドの大きさにして余白を無くす */
const PRINT_STYLES = {
  "@media print": {
    "@page": { size: `${DECK_W}px ${DECK_H}px`, margin: 0 },
    "html, body": { background: "#fff", margin: 0, padding: 0 },
    [HIDDEN_IN_PRINT.join(",")]: { display: "none !important" },
    ".MuiContainer-root": { maxWidth: "none !important", margin: "0 !important", padding: "0 !important" },
    // 外枠の min-height: 100vh が残ると、最後の 1 枚のあとに白紙が増える
    "#root > div": { minHeight: "0 !important" },
    // 改ページ指定は flex の中では効かないブラウザがあるので、印刷では普通の縦積みにする
    ".deck-print-sheets": { display: "block !important", margin: "0 !important", gap: "0 !important" },
    // Stack の spacing は 2 枚目以降に上の余白を付ける。残ると 1 枚ずつずれて白紙が出る
    ".deck-print-sheets > .deck-print-slide": { margin: "0 !important" },
    ".deck-print-slide": {
      breakAfter: "page", pageBreakAfter: "always", breakInside: "avoid",
      printColorAdjust: "exact", WebkitPrintColorAdjust: "exact", boxShadow: "none !important",
    },
    ".deck-print-slide:last-of-type": { breakAfter: "auto", pageBreakAfter: "auto" },
  },
} as const;

/**
 * スライドを PDF にするための印刷画面 `/d/:slug/print`（docs/slide-editor.md 4.1）。
 * 全ページを縦に並べ、書体と画像がそろったら一度だけ印刷の画面を開く。
 * PDF はブラウザの「PDFとして保存」で作る（サーバーでは作らない）。
 */
export function DeckPrintPage() {
  const { t } = useTranslation();
  const { slug = "" } = useParams();
  const { data: deck, isError } = usePublicDeck(slug);
  const [settled, setSettled] = useState<Set<string>>(() => new Set());
  const [fontsReady, setFontsReady] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [width, setWidth] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const printed = useRef(false);

  useEffect(() => {
    if (!deck) return;
    ensureDeckFonts(deck.content);
    let alive = true;
    void (document.fonts?.ready ?? Promise.resolve()).then(() => { if (alive) setFontsReady(true); });
    const timer = window.setTimeout(() => setTimedOut(true), READY_TIMEOUT_MS);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [deck]);

  // 画面では幅に合わせて縮め、印刷のときだけ原寸（960px）で描く
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [deck]);
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => { window.removeEventListener("beforeprint", before); window.removeEventListener("afterprint", after); };
  }, []);

  const slides = deck?.content.slides ?? [];
  const imageIds = slides.flatMap((s) => s.elements.filter((e) => e.type === "image" && e.src).map((e) => e.id));
  const ready = Boolean(deck) && fontsReady && (timedOut || imageIds.every((id) => settled.has(id)));

  const print = () => {
    flushSync(() => setPrinting(true));
    window.print();
  };
  useEffect(() => {
    if (!ready || printed.current || slides.length === 0) return;
    printed.current = true;
    print();
  }, [ready]);

  if (isError) return <Alert severity="info">{t("studio.deckNotFound")}</Alert>;
  if (deck && slides.length === 0) return <Alert severity="info">{t("studio.deckNoPages")}</Alert>;
  const stageWidth = printing ? DECK_W : Math.min(DECK_W, width);

  return (
    <>
      <GlobalStyles styles={PRINT_STYLES} />
      <Stack className="deck-print-controls" spacing={1} sx={{ mb: 2 }}>
        {deck && <Typography variant="h6" fontWeight={700}>{deck.title}</Typography>}
        <Typography variant="body2" color="text.secondary">
          {ready ? t("studio.deckPrintHint") : t("studio.deckPrintPreparing")}
        </Typography>
        <Box><Button variant="contained" disabled={!ready} onClick={print}>{t("studio.deckPrintAgain")}</Button></Box>
      </Stack>
      <Stack ref={listRef} className="deck-print-sheets" spacing={2} data-print-ready={ready ? "true" : "false"}>
        {stageWidth > 0 && slides.map((slide) => (
          <Box key={slide.id} className="deck-print-slide" sx={{ width: stageWidth, boxShadow: 1 }}>
            <SlideStage slide={slide} width={stageWidth} onImageStatus={(id) =>
              setSettled((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))} />
          </Box>
        ))}
      </Stack>
    </>
  );
}
