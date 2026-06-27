import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Alert, Box, IconButton, Stack, Typography } from "@mui/material";
import ArrowBackIosNewIcon from "@mui/icons-material/ArrowBackIosNew";
import ArrowForwardIosIcon from "@mui/icons-material/ArrowForwardIos";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import { useParams } from "react-router-dom";
import { usePublicDeck } from "../api/deckHooks.js";
import { SlideStage } from "../components/SlideStage.js";

export function DeckViewerPage() {
  const { slug = "" } = useParams();
  const { data: deck, isLoading, isError } = usePublicDeck(slug);
  const [index, setIndex] = useState(0);
  const [width, setWidth] = useState(0);
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

  const slides = deck?.content.slides ?? [];
  const total = slides.length;
  const go = useCallback(
    (d: number) => setIndex((i) => Math.min(Math.max(i + d, 0), Math.max(total - 1, 0))),
    [total],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft") {
        go(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const fullscreen = () => wrapRef.current?.requestFullscreen?.();

  if (isError) return <Alert severity="info">スライドが見つかりません。</Alert>;
  if (isLoading || !deck) return <Typography>読み込み中…</Typography>;
  if (total === 0)
    return <Alert severity="info">このスライドにはまだページがありません。</Alert>;

  const slide = slides[Math.min(index, total - 1)];

  return (
    <Stack spacing={1.5}>
      {deck.title && (
        <Typography variant="h6" fontWeight={700}>
          {deck.title}
        </Typography>
      )}
      <Box
        ref={wrapRef}
        sx={{ bgcolor: "#000", borderRadius: 2, overflow: "hidden" }}
      >
        <Box
          ref={stageRef}
          onClick={() => go(1)}
          sx={{
            width: "100%",
            aspectRatio: "16 / 9",
            cursor: "pointer",
            display: "flex",
          }}
        >
          {width > 0 && <SlideStage slide={slide} width={width} />}
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
        <IconButton onClick={fullscreen} title="フルスクリーン">
          <FullscreenIcon />
        </IconButton>
      </Stack>
    </Stack>
  );
}
