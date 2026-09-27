import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Alert, Box, Button, IconButton, Stack, Typography } from "@mui/material";
import ArrowBackIosNewIcon from "@mui/icons-material/ArrowBackIosNew";
import ArrowForwardIosIcon from "@mui/icons-material/ArrowForwardIos";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { usePublicDeck } from "../api/deckHooks.js";
import { SlideStage } from "../components/SlideStage.js";
import { ensureDeckFonts } from "../lib/deckFonts.js";

export function DeckViewerPage() {
  const { t } = useTranslation();
  const { slug = "" } = useParams();
  const { data: deck, isLoading, isError } = usePublicDeck(slug);
  const [index, setIndex] = useState(0);
  const [width, setWidth] = useState(0);
  const [reading, setReading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [deck]);

  useEffect(() => {
    if (deck) ensureDeckFonts(deck.content);
  }, [deck]);

  const slides = deck?.content.slides ?? [];
  const total = slides.length;
  const go = useCallback(
    (d: number) => setIndex((i) => Math.min(Math.max(i + d, 0), Math.max(total - 1, 0))),
    [total],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (reading) return;
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft") {
        go(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, reading]);

  const fullscreen = () => wrapRef.current?.requestFullscreen?.();

  if (isError)
    return <Alert severity="info">{t("studio.deckNotFound")}</Alert>;
  if (isLoading || !deck) return <Typography>{t("common.loading")}</Typography>;
  if (total === 0)
    return <Alert severity="info">{t("studio.deckNoPages")}</Alert>;

  const slide = slides[Math.min(index, total - 1)];

  return (
    <Stack spacing={1.5}>
      {deck.title && (
        <Typography variant="h6" fontWeight={700}>
          {deck.title}
        </Typography>
      )}
      <Button sx={{ alignSelf: "flex-start" }} variant={reading ? "outlined" : "contained"} onClick={() => setReading(!reading)}>{t(reading ? "deckImport.closeReading" : "deckImport.readFullSize")}</Button>
      {reading && <Typography variant="body2">{t("deckImport.readingHint", { n: Math.min(index + 1, total), total })}</Typography>}
      <Box
        ref={wrapRef}
        role={reading ? "region" : undefined}
        aria-label={reading ? t("deckImport.page", { n: Math.min(index + 1, total) }) : undefined}
        tabIndex={reading ? 0 : undefined}
        sx={{ bgcolor: "#000", borderRadius: 2, overflowX: reading ? "auto" : "hidden", overflowY: reading ? "auto" : "hidden", maxWidth: "100%" }}
      >
        <Box
          ref={stageRef}
          onClick={reading ? undefined : () => go(1)}
          sx={{
            width: reading ? 960 : "100%",
            aspectRatio: "16 / 9",
            cursor: reading ? "auto" : "pointer",
            display: "flex",
          }}
        >
          {(reading || width > 0) && <SlideStage slide={slide} width={reading ? 960 : width} />}
        </Box>
      </Box>
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="center">
        <IconButton onClick={() => go(-1)} disabled={index === 0}>
          <ArrowBackIosNewIcon />
        </IconButton>
        <Typography variant="body2">
          {Math.min(index + 1, total)} / {total}
        </Typography>
        <IconButton onClick={() => go(1)} disabled={index >= total - 1}>
          <ArrowForwardIosIcon />
        </IconButton>
        <IconButton onClick={fullscreen} title={t("studio.deckFullscreen")}>
          <FullscreenIcon />
        </IconButton>
      </Stack>
    </Stack>
  );
}
