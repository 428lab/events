import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  CardContent,
  FormControl,
  FormControlLabel,
  FormLabel,
  LinearProgress,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from "@mui/material";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { messageKey, type MessageKey } from "../lib/messageKey.js";
import { useDeckLeaveWarning } from "../lib/useDeckLeaveWarning.js";
import { PDF_MAX_PAGES, type PdfImportMode } from "../lib/pdfImport/pdfSlides.js";
import type { PdfDocumentAdapter } from "../lib/pdfImport/pdfPages.js";
import { importPdf, PdfImportError, type PdfImportProgress } from "../lib/pdfImport/importPdf.js";

/** pdf.js は重いので、この画面で PDF を選んだときにだけ読む */
const loadPdf = () => import("../lib/pdfImport/pdfPages.js");

/**
 * PDF から取り込む（docs/slide-editor.md「PDF から取り込む」）。
 * オーナー決定 2026-11-20: 対応は PDF だけ。取り込み方は「見た目そのまま（既定）」と「文字を直せる形」から選ぶ。
 */
export function PdfImportPanel({ open = openPdfFile }: { open?: (file: File) => Promise<PdfDocumentAdapter> }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [pdf, setPdf] = useState<{ doc: PdfDocumentAdapter; name: string } | null>(null);
  const [mode, setMode] = useState<PdfImportMode>("image");
  const [opening, setOpening] = useState(false);
  const [progress, setProgress] = useState<PdfImportProgress | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  /** 一部のページを見た目そのままにしたとき: 伝えてから、ボタンで開いてもらう */
  const [done, setDone] = useState<{ deckId: string; imagePages: number[] } | null>(null);
  const location = useLocation();
  const card = useRef<HTMLDivElement>(null);
  // スライドの一覧の「PDFから取り込む」から来たら、この欄まで送る
  useEffect(() => {
    if (location.hash === "#pdf-import") card.current?.scrollIntoView?.({ block: "start" });
  }, [location.hash]);
  const cancel = useRef(false);
  const docRef = useRef<PdfDocumentAdapter | null>(null);
  docRef.current = pdf?.doc ?? null;
  useEffect(() => () => { cancel.current = true; docRef.current?.destroy(); }, []);
  const running = progress !== null;
  useDeckLeaveWarning(running, t("deckImportPdf.leave"));

  async function choose(file: File) {
    setError(null);
    setDone(null);
    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
      setError(messageKey("deckImportPdf.notPdf"));
      return;
    }
    setOpening(true);
    try {
      pdf?.doc.destroy();
      setPdf({ doc: await open(file), name: file.name });
    } catch (e) {
      setPdf(null);
      setError(messageKey((e as { code?: string }).code === "password" ? "deckImportPdf.password" : "deckImportPdf.invalid"));
    } finally {
      setOpening(false);
    }
  }

  async function start() {
    if (!pdf) return;
    const { doc, name } = pdf;
    if (doc.pageCount > PDF_MAX_PAGES &&
        !window.confirm(t("deckImportPdf.tooManyConfirm", { max: PDF_MAX_PAGES, n: doc.pageCount }))) return;
    cancel.current = false;
    setError(null);
    setDone(null);
    const title = (doc.title ?? name.replace(/\.pdf$/i, "")).trim().slice(0, 120) || t("deckImportPdf.untitled");
    try {
      const result = await importPdf({ pdf: doc, title, mode, onProgress: setProgress, cancelled: () => cancel.current });
      setProgress(null);
      if (!result) return;
      void qc.invalidateQueries({ queryKey: ["decks", "mine"] });
      if (result.imagePages.length > 0) {
        setDone({ deckId: result.deck.id, imagePages: result.imagePages });
        return;
      }
      navigate(`/decks/${result.deck.id}/edit`);
    } catch (e) {
      setProgress(null);
      if (e instanceof PdfImportError) {
        setError(e.stage === "save" ? messageKey("deckImportPdf.failedSave")
          : messageKey(e.stage === "render" ? "deckImportPdf.failedRender" : "deckImportPdf.failedUpload", { page: e.page ?? 0 }));
      } else {
        setError(messageKey("deckImportPdf.failedSave"));
      }
    }
  }

  const progressText = progress && t(
    progress.stage === "save" ? "deckImportPdf.progressSave" : progress.stage === "render" ? "deckImportPdf.progressRender" : "deckImportPdf.progressUpload",
    { page: progress.page, total: progress.total },
  );

  return (
    <Card variant="outlined" id="pdf-import" ref={card} sx={{ scrollMarginTop: 88 }}>
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h6" component="h2" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <PictureAsPdfOutlinedIcon /> {t("deckImportPdf.heading")}
          </Typography>
          <Typography variant="body2">{t("deckImportPdf.intro")}</Typography>
          <Typography variant="body2" color="text.secondary">{t("deckImportPdf.otherFormats")}</Typography>
          <Button component="label" variant="outlined" disabled={running || opening} sx={{ alignSelf: "flex-start" }}>
            {t("deckImportPdf.choose")}
            <input
              hidden
              type="file"
              accept="application/pdf,.pdf"
              disabled={running || opening}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void choose(file);
              }}
            />
          </Button>
          {opening && <Typography variant="body2">{t("deckImportPdf.opening")}</Typography>}
          {pdf && (
            <>
              <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                {t("deckImportPdf.fileName", { name: pdf.name, n: pdf.doc.pageCount })}
              </Typography>
              {pdf.doc.pageCount > PDF_MAX_PAGES && (
                <Alert severity="warning">{t("deckImportPdf.tooManyPages", { n: pdf.doc.pageCount, max: PDF_MAX_PAGES })}</Alert>
              )}
              <FormControl disabled={running}>
                <FormLabel id="pdf-import-mode">{t("deckImportPdf.modeLabel")}</FormLabel>
                <RadioGroup aria-labelledby="pdf-import-mode" value={mode} onChange={(e) => setMode(e.target.value as PdfImportMode)}>
                  <FormControlLabel
                    value="image"
                    control={<Radio />}
                    label={<><Typography>{t("deckImportPdf.modeImage")}</Typography><Typography variant="body2" color="text.secondary">{t("deckImportPdf.modeImageHelp")}</Typography></>}
                  />
                  <FormControlLabel
                    value="editable"
                    control={<Radio />}
                    label={<><Typography>{t("deckImportPdf.modeEditable")}</Typography><Typography variant="body2" color="text.secondary">{t("deckImportPdf.modeEditableHelp")}</Typography></>}
                  />
                </RadioGroup>
              </FormControl>
              <Alert severity="info">{t("deckImportPdf.publicNotice")}</Alert>
              <Stack direction="row" spacing={1}>
                <Button variant="contained" onClick={() => void start()} disabled={running}>{t("deckImportPdf.start")}</Button>
                {running && <Button onClick={() => { cancel.current = true; }}>{t("deckImportPdf.cancel")}</Button>}
              </Stack>
            </>
          )}
          {progress && (
            <Stack spacing={0.5} role="status">
              <Typography variant="body2">{progressText}</Typography>
              <LinearProgress
                variant="determinate"
                value={progress.stage === "save" ? 100 : ((progress.page - 1 + (progress.stage === "upload" ? 0.5 : 0)) / progress.total) * 100}
              />
            </Stack>
          )}
          {done && (
            <Alert
              severity="success"
              action={<Button color="inherit" onClick={() => navigate(`/decks/${done.deckId}/edit`)}>{t("deckImportPdf.open")}</Button>}
            >
              {t("deckImportPdf.imagePagesNotice", { pages: done.imagePages.join(", ") })}
            </Alert>
          )}
          {error && <Alert severity="error">{t(error.key, error.params)}</Alert>}
        </Stack>
      </CardContent>
    </Card>
  );
}

async function openPdfFile(file: File): Promise<PdfDocumentAdapter> {
  const { openPdf } = await loadPdf();
  return openPdf(file);
}
