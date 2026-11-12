import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Box, Button, Chip, IconButton, Link, Stack, Typography } from "@mui/material";
import ArrowBackIosNewIcon from "@mui/icons-material/ArrowBackIosNew";
import ArrowForwardIosIcon from "@mui/icons-material/ArrowForwardIos";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Deck, PresentControlConfig } from "@eventer/shared";
import { SlideStage } from "./SlideStage.js";
import { ensureDeckFonts } from "../lib/deckFonts.js";
import { usePresentPageSync, type MakePresentTransport } from "../lib/presentPageSync.js";

/** 発表画面の左側に出す、発表中のエントリーのスライド。
 * ページめくりを持つ人（運営、または渡された発表者）がめくると、見ている画面も同じページになる
 * （Nostr で同期。lib/presentPageSync.ts）。見ている人は手元でめくってもよく、
 * 「発表者に合わせる」で戻る。同期の設定が無ければ手元だけでめくる。
 * 発表が変わったら親が key で作り直して1ページ目に戻す。
 * ← → は採点欄や入力欄にフォーカスがあるときは奪わない（採点の点数ボタンを矢印で動かす人がいるため） */
export function PresentationDeckPane({
  deck,
  slug,
  control,
  makeTransport,
}: {
  deck: Deck;
  slug: string;
  control?: PresentControlConfig | null;
  makeTransport?: MakePresentTransport;
}) {
  const { t } = useTranslation();
  const slides = deck.content.slides;
  const total = slides.length;
  const sync = usePresentPageSync(control, slug, total, makeTransport);
  const [width, setWidth] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const current = sync.page;
  const go = sync.go;
  const goRef = useRef(go);
  goRef.current = go;

  useEffect(() => {
    ensureDeckFonts(deck.content);
  }, [deck]);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement || target.isContentEditable
        || target.closest("[role=listbox],[role=dialog],[data-scoring-panel]"))) return;
      if (e.key === "ArrowRight") { e.preventDefault(); goRef.current(1); }
      if (e.key === "ArrowLeft") { e.preventDefault(); goRef.current(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (total === 0) return null;
  return (
    <Stack spacing={1}>
      <Box sx={{ bgcolor: "#000", borderRadius: 2, overflow: "hidden" }}>
        <Box ref={stageRef} sx={{ width: "100%", aspectRatio: "16 / 9", display: "flex" }}>
          {width > 0 && <SlideStage slide={slides[current]} width={width} />}
        </Box>
      </Box>
      {sync.holder && (
        <Chip size="small" color="primary" sx={{ alignSelf: "center" }} label={t("eventRun.presentYouControl")} />
      )}
      {!sync.following && (
        <Button size="small" variant="contained" sx={{ alignSelf: "center" }} onClick={sync.follow}>
          {t("eventRun.presentFollow")}
        </Button>
      )}
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="center">
        <IconButton onClick={() => go(-1)} disabled={current === 0} aria-label={t("studio.slidePrev")}>
          <ArrowBackIosNewIcon />
        </IconButton>
        <Typography variant="body2">{current + 1} / {total}</Typography>
        <IconButton onClick={() => go(1)} disabled={current >= total - 1} aria-label={t("studio.slideNext")}>
          <ArrowForwardIosIcon />
        </IconButton>
        <Link component={RouterLink} to={`/d/${slug}`} target="_blank" rel="noreferrer"
          sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, ml: 1 }}>
          {t("eventRun.presentDeckOpen")}
          <OpenInNewIcon fontSize="small" />
        </Link>
      </Stack>
    </Stack>
  );
}
