import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Box, Button, Stack, Typography, Alert } from "@mui/material";
import { useTranslation } from "react-i18next";
import type { DeckContent, DeckSlide } from "@eventer/shared";
import { SlideStage } from "./SlideStage.js";
import { useCanvasScale } from "../lib/editor/useCanvasScale.js";

type Warning = { page: number; element?: number; kind: "overflow" | "empty" | "whitespace" | "placeholder" | "measureFailed" };
function Thumbnail({ slide, onImageStatus }: { slide: DeckSlide; onImageStatus: (elementId: string, src: string, status: "loaded" | "error") => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } }, { rootMargin: "200px" });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} style={{ width: 144, height: 81 }}>{visible && <SlideStage slide={slide} width={144} onImageStatus={onImageStatus} />}</div>;
}
export function DeckImportPreview({ content }: { content: DeckContent }) {
  const { t } = useTranslation();
  const { ref, width } = useCanvasScale(960);
  const [selected, setSelected] = useState(0);
  const [reading, setReading] = useState(false);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [failedImages, setFailedImages] = useState<Record<string, true>>({});
  useEffect(() => {
    setSelected(0); setReading(false); setWarnings([]); setFailedImages({});
    let page = 0;
    const found: Warning[] = [];
    let timer: ReturnType<typeof setTimeout>;
    const measure = document.createElement("div");
    Object.assign(measure.style, { position: "fixed", left: "-10000px", top: "0", visibility: "hidden", height: "auto", lineHeight: "1.3", whiteSpace: "pre-wrap", wordBreak: "break-word", padding: "0", border: "0" });
    // Inherit the preview's actual default font rather than loading a web font.
    measure.style.fontFamily = ref.current ? getComputedStyle(ref.current).fontFamily : "";
    ref.current?.appendChild(measure);
    const checkPage = () => {
      const slide = content.slides[page];
      if (!slide.elements.length) found.push({ page, kind: "empty" });
      slide.elements.forEach((el, element) => {
        if (el.type === "image") { if (!el.src) found.push({ page, element, kind: "placeholder" }); return; }
        if (!(el.text ?? "").trim()) found.push({ page, element, kind: "whitespace" });
        try {
          Object.assign(measure.style, { width: `${el.w}px`, fontFamily: el.fontFamily || (ref.current ? getComputedStyle(ref.current).fontFamily : ""), fontSize: `${el.fontSize}px`, fontWeight: el.bold ? "700" : "400", fontStyle: el.italic ? "italic" : "normal", textAlign: el.align });
          measure.textContent = el.text ?? "";
          const height = measure.getBoundingClientRect().height;
          if (!measure.isConnected || height <= 0) found.push({ page, element, kind: "measureFailed" });
          else if (height > el.h + 1 || measure.scrollWidth > el.w + 1) found.push({ page, element, kind: "overflow" });
        } catch { found.push({ page, element, kind: "measureFailed" }); }
      });
      setWarnings([...found]);
      if (++page < content.slides.length) timer = setTimeout(checkPage, 0);
      else measure.remove();
    };
    timer = setTimeout(checkPage, 0);
    return () => { clearTimeout(timer); measure.remove(); };
  }, [content, ref]);
  const page = Math.min(selected, content.slides.length - 1);
  useLayoutEffect(() => {
    if (reading && ref.current) ref.current.scrollLeft = 0;
  }, [page, reading, ref]);
  const onImageStatus = (slideIndex: number, elementId: string, src: string, status: "loaded" | "error") => {
    const slide = content.slides[slideIndex];
    if (!slide?.elements.some((el) => el.id === elementId && el.src === src)) return;
    const key = `${slide.id}:${elementId}`;
    setFailedImages((old) => {
      if (Boolean(old[key]) === (status === "error")) return old;
      const next = { ...old };
      if (status === "error") next[key] = true;
      else delete next[key];
      return next;
    });
  };
  return <Stack spacing={2}>
    <Alert severity="info">{t("deckImport.manual")}</Alert>
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
      {content.slides.map((slide, i) => <Button key={slide.id} aria-label={t("deckImport.page", { n: i + 1 })} variant={page === i ? "contained" : "outlined"} onClick={() => setSelected(i)} aria-pressed={page === i} sx={{ display: "block", p: 0.5, borderRadius: "14px", overflow: "hidden" }}>
        <Thumbnail slide={slide} onImageStatus={(elementId, src, status) => onImageStatus(i, elementId, src, status)} /><Typography variant="caption">{t("deckImport.page", { n: i + 1 })}</Typography>
      </Button>)}
    </Box>
    <Button sx={{ alignSelf: "flex-start" }} variant={reading ? "outlined" : "contained"} onClick={() => setReading(!reading)}>{t(reading ? "deckImport.closeReading" : "deckImport.readFullSize")}</Button>
    {reading && <Typography variant="body2">{t("deckImport.readingHint", { n: page + 1, total: content.slides.length })}</Typography>}
    <Box ref={ref} tabIndex={0} role="region" aria-label={t("deckImport.page", { n: page + 1 })}
      onKeyDown={(e) => { if (!reading && (e.key === "ArrowRight" || e.key === "ArrowLeft")) { e.preventDefault(); setSelected(Math.max(0, Math.min(content.slides.length - 1, page + (e.key === "ArrowRight" ? 1 : -1)))); } }} sx={{ width: "100%", minWidth: 0, overflowX: reading ? "auto" : "visible", overflowY: reading ? "auto" : "visible" }}>
      {(reading || width > 0) && <SlideStage slide={content.slides[page]} width={reading ? 960 : Math.min(width, 960)} onImageStatus={(elementId, src, status) => onImageStatus(page, elementId, src, status)} />}
    </Box>
    <Stack direction="row" spacing={1}><Button disabled={page === 0} onClick={() => setSelected(page - 1)}>{t("deckImport.previous")}</Button><Button disabled={page === content.slides.length - 1} onClick={() => setSelected(page + 1)}>{t("deckImport.next")}</Button></Stack>
    {warnings.map((warning, i) => <Alert key={i} severity="warning">{t("deckImport.page", { n: warning.page + 1 })}{warning.element !== undefined && ` / ${t("deckImport.element", { n: warning.element + 1 })}`}: {t(`deckImport.${warning.kind}`)}</Alert>)}
    {content.slides.flatMap((slide, slideIndex) => slide.elements.flatMap((el, elementIndex) => failedImages[`${slide.id}:${el.id}`] && el.src ? [<Alert key={`${slide.id}:${el.id}`} severity="warning">{t("deckImport.page", { n: slideIndex + 1 })} / {t("deckImport.element", { n: elementIndex + 1 })}: {t("deckImport.imageFailure")}</Alert>] : []))}
  </Stack>;
}
