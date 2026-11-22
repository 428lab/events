import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Alert, Box, Button, IconButton, Stack, Typography } from "@mui/material";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import ArrowBackIosNewIcon from "@mui/icons-material/ArrowBackIosNew";
import ArrowForwardIosIcon from "@mui/icons-material/ArrowForwardIos";
import CloseIcon from "@mui/icons-material/Close";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import { createPortal, flushSync } from "react-dom";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useDeckViewCount, usePublicDeck } from "../api/deckHooks.js";
import { SlideStage } from "../components/SlideStage.js";
import { DeckExportMenu } from "../components/DeckExportMenu.js";
import { DECK_H, DECK_W } from "@eventer/shared";
import { ensureDeckFonts } from "../lib/deckFonts.js";

/** 「拡大して読む」の倍率。画面に合わせた幅に掛ける（オーナー指摘 2026-11-22: 等倍 960px に
 *  切り替えるだけでは、PC の画面ではほとんど大きくならなかった） */
export const DECK_ZOOM_STEPS = [1.5, 2, 3] as const;
/** 拡大の基準の最小の幅。スマホでも最初の段階（150%）で原寸（960px）になり、段階ごとに大きくなる */
const ZOOM_BASE_MIN = DECK_W / DECK_ZOOM_STEPS[0];
/** ふだんの表示は、見出し・ページ送りと一緒に画面の高さに収める（広い器でスライドが縦にはみ出さない） */
const FIT_MAX_WIDTH = `min(100%, calc((100vh - 320px) * ${DECK_W} / ${DECK_H}))`;

export function DeckViewerPage() {
  const { t } = useTranslation();
  const { slug = "" } = useParams();
  const { data: deck, isLoading, isError } = usePublicDeck(slug);
  // 開いたら表示回数を1回数え、今の回数を出す（同じ人は1日1回。持ち主・メンバーは数えない）
  const { data: views } = useDeckViewCount(slug, Boolean(deck));
  const [index, setIndex] = useState(0);
  const [width, setWidth] = useState(0);
  const [reading, setReading] = useState(false);
  /** 拡大の段階（DECK_ZOOM_STEPS の添字） */
  const [zoomStep, setZoomStep] = useState(0);
  /** 拡大する前の、画面に合わせた幅。拡大中は器がスライドより狭くなるので、開く前の幅を基準にする */
  const [fitBase, setFitBase] = useState(0);
  const [presenting, setPresenting] = useState(false);
  const [screenSize, setScreenSize] = useState({ w: 0, h: 0 });
  const presentRef = useRef<HTMLDivElement>(null);
  /** ネイティブのフルスクリーンに入れたか（iPhone Safari は要素のフルスクリーンが無く、ページ内の全面表示だけ） */
  const nativeRef = useRef(false);
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

  useLayoutEffect(() => {
    if (reading && wrapRef.current) wrapRef.current.scrollLeft = 0;
  }, [index, reading]);

  const slides = deck?.content.slides ?? [];
  const total = slides.length;
  const go = useCallback(
    (d: number) => setIndex((i) => Math.min(Math.max(i + d, 0), Math.max(total - 1, 0))),
    [total],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (presenting && e.key === "Escape") {
        closePresenting();
        return;
      }
      if (reading && !presenting) return;
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft") {
        go(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, reading, presenting]);

  const closePresenting = () => {
    setPresenting(false);
    if (nativeRef.current && document.fullscreenElement) void document.exitFullscreen?.();
    nativeRef.current = false;
  };

  /** 全面表示を開き、使えるならネイティブのフルスクリーンにする。使えない・拒否されたら全面表示のまま */
  const fullscreen = () => {
    flushSync(() => setPresenting(true));
    const el = presentRef.current;
    if (!el?.requestFullscreen) return;
    el.requestFullscreen().then(
      () => { nativeRef.current = true; },
      () => { nativeRef.current = false; },
    );
  };

  useEffect(() => {
    if (!presenting) return;
    const onChange = () => {
      if (nativeRef.current && !document.fullscreenElement) {
        nativeRef.current = false;
        setPresenting(false);
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.body.style.overflow = overflow;
    };
  }, [presenting]);

  useLayoutEffect(() => {
    const el = presentRef.current;
    if (!presenting || !el) return;
    const measure = () => setScreenSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [presenting]);

  if (isError)
    return <Alert severity="info">{t("studio.deckNotFound")}</Alert>;
  if (isLoading || !deck) return <Typography>{t("common.loading")}</Typography>;
  if (total === 0)
    return <Alert severity="info">{t("studio.deckNoPages")}</Alert>;

  const slide = slides[Math.min(index, total - 1)];
  const fitWidth = Math.floor(Math.min(screenSize.w, (screenSize.h * DECK_W) / DECK_H));
  const zoomWidth = Math.round(Math.max(ZOOM_BASE_MIN, fitBase || width) * DECK_ZOOM_STEPS[zoomStep]!);

  return (
    <>
    <Stack spacing={1.5}>
      {deck.title && (
        <Typography variant="h6" fontWeight={700}>
          {deck.title}
        </Typography>
      )}
      {views !== undefined && (
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: "text.secondary" }}>
          <VisibilityOutlinedIcon sx={{ fontSize: 16 }} aria-hidden />
          <Typography variant="caption">{t("studio.deckViews", { n: views })}</Typography>
        </Stack>
      )}
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Button variant={reading ? "outlined" : "contained"} onClick={() => {
          if (!reading) { setFitBase(width); setZoomStep(0); }
          setReading(!reading);
        }}>{t(reading ? "deckImport.closeReading" : "deckImport.readFullSize")}</Button>
        {reading && (
          <>
            <IconButton onClick={() => setZoomStep((z) => Math.max(0, z - 1))} disabled={zoomStep === 0} aria-label={t("studio.deckZoomOut")} title={t("studio.deckZoomOut")}>
              <ZoomOutIcon />
            </IconButton>
            <Typography variant="body2" sx={{ minWidth: 48, textAlign: "center" }}>{Math.round(DECK_ZOOM_STEPS[zoomStep]! * 100)}%</Typography>
            <IconButton onClick={() => setZoomStep((z) => Math.min(DECK_ZOOM_STEPS.length - 1, z + 1))} disabled={zoomStep === DECK_ZOOM_STEPS.length - 1} aria-label={t("studio.deckZoomIn")} title={t("studio.deckZoomIn")}>
              <ZoomInIcon />
            </IconButton>
          </>
        )}
      </Stack>
      {reading && <Typography variant="body2">{t("studio.deckReadingHint", { n: Math.min(index + 1, total), total })}</Typography>}
      <Box
        ref={wrapRef}
        role={reading ? "region" : undefined}
        aria-label={reading ? t("deckImport.page", { n: Math.min(index + 1, total) }) : undefined}
        tabIndex={reading ? 0 : undefined}
        sx={{ bgcolor: "#000", borderRadius: 2, overflowX: reading ? "auto" : "hidden", overflowY: reading ? "auto" : "hidden", maxWidth: reading ? "100%" : FIT_MAX_WIDTH, width: reading ? undefined : "100%", alignSelf: "center" }}
      >
        <Box
          ref={stageRef}
          onClick={reading ? undefined : () => go(1)}
          sx={{
            width: reading ? zoomWidth : "100%",
            aspectRatio: "16 / 9",
            cursor: reading ? "auto" : "pointer",
            display: "flex",
          }}
        >
          {/* 拡大した幅で描き直す（CSS の拡大ではないので文字がぼやけない） */}
          {(reading || width > 0) && <SlideStage slide={slide} width={reading ? zoomWidth : width} />}
        </Box>
      </Box>
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="center">
        <IconButton onClick={() => go(-1)} disabled={index === 0} aria-label={t("studio.deckPrevPage")}>
          <ArrowBackIosNewIcon />
        </IconButton>
        <Typography variant="body2">
          {Math.min(index + 1, total)} / {total}
        </Typography>
        <IconButton onClick={() => go(1)} disabled={index >= total - 1} aria-label={t("studio.deckNextPage")}>
          <ArrowForwardIosIcon />
        </IconButton>
        <IconButton onClick={fullscreen} title={t("studio.deckFullscreen")}>
          <FullscreenIcon />
        </IconButton>
      </Stack>
      <Box sx={{ display: "flex", justifyContent: "center" }}>
        <DeckExportMenu slug={slug} deck={deck} />
      </Box>
    </Stack>
      {presenting &&
        createPortal(
          <Box
            ref={presentRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("studio.deckFullscreen")}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              go(e.clientX - r.left < r.width / 2 ? -1 : 1);
            }}
            sx={{
              position: "fixed",
              inset: 0,
              width: "100vw",
              height: "100dvh",
              zIndex: (theme) => theme.zIndex.modal + 1,
              bgcolor: "#000",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
              touchAction: "manipulation",
              userSelect: "none",
            }}
          >
            {fitWidth > 0 && <SlideStage slide={slide} width={fitWidth} />}
            <IconButton
              aria-label={t("common.close")}
              onClick={(e) => {
                e.stopPropagation();
                closePresenting();
              }}
              sx={{ position: "absolute", top: "max(8px, env(safe-area-inset-top))", right: "max(8px, env(safe-area-inset-right))", color: "#fff", bgcolor: "rgba(0,0,0,0.45)", "&:hover": { bgcolor: "rgba(0,0,0,0.6)" } }}
            >
              <CloseIcon />
            </IconButton>
            <Typography
              variant="body2"
              sx={{ position: "absolute", bottom: "max(8px, env(safe-area-inset-bottom))", left: 0, right: 0, textAlign: "center", color: "rgba(255,255,255,0.8)", pointerEvents: "none" }}
            >
              {Math.min(index + 1, total)} / {total}
            </Typography>
          </Box>,
          document.body,
        )}
    </>
  );
}
