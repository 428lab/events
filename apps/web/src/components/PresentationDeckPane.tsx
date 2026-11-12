import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Box, IconButton, Link, Stack, Typography } from "@mui/material";
import ArrowBackIosNewIcon from "@mui/icons-material/ArrowBackIosNew";
import ArrowForwardIosIcon from "@mui/icons-material/ArrowForwardIos";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Deck } from "@eventer/shared";
import { SlideStage } from "./SlideStage.js";
import { ensureDeckFonts } from "../lib/deckFonts.js";

/** 発表画面の左側に出す、発表中のエントリーのスライド。
 * ページ送りは見ている人ごと（手元だけ）。発表が変わったら親が key で作り直して1ページ目に戻す。
 * ← → は採点欄や入力欄にフォーカスがあるときは奪わない（採点の点数ボタンを矢印で動かす人がいるため） */
export function PresentationDeckPane({ deck, slug }: { deck: Deck; slug: string }) {
  const { t } = useTranslation();
  const slides = deck.content.slides;
  const total = slides.length;
  const [page, setPage] = useState(0);
  const [width, setWidth] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const current = Math.min(page, Math.max(total - 1, 0));
  const go = (d: number) => setPage((p) => Math.min(Math.max(p + d, 0), Math.max(total - 1, 0)));
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
