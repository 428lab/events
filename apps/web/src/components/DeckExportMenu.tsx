import { useState } from "react";
import { Button, Menu, MenuItem, Snackbar } from "@mui/material";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import { useTranslation } from "react-i18next";
import { exportDeckV2, validateDeckImport, type Deck, type DeckContent } from "@eventer/shared";
import { api } from "../api/client.js";

/** ファイル名に使えない文字を落とす（タイトルが空なら deck） */
function fileName(title: string): string {
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "").trim().slice(0, 80);
  return `${base || "deck"}.json`;
}

/**
 * スライドの「書き出す ▾」(docs/slide-editor.md 4.1)。
 * - JSON: 公開の取り込み形式 v2 にして保存する。検証に通らなければファイルにしない
 * - PDF: 印刷用の画面 `/d/:slug/print` を開き、ブラウザの「PDFとして保存」で保存する
 * 中身を持っていない画面（チームのスライド欄）は、押したときに公開の取得から読む。
 */
export function DeckExportMenu({ slug, deck, disabled }: {
  slug: string;
  deck?: { title: string; content: DeckContent };
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [error, setError] = useState(false);

  const exportJson = async () => {
    setAnchor(null);
    try {
      const source = deck ?? (await api.get<Deck>(`/public/decks/${slug}`));
      const value = exportDeckV2(source, window.location.origin);
      if (!validateDeckImport(value).ok) throw new Error("invalid_export");
      const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName(source.title);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError(true);
    }
  };

  return (
    <>
      <Button size="small" variant="outlined" startIcon={<FileDownloadIcon />} disabled={disabled}
        onClick={(e) => setAnchor(e.currentTarget)} aria-haspopup="menu">
        {t("studio.deckExport")}
      </Button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <MenuItem onClick={() => void exportJson()}>{t("studio.deckExportJson")}</MenuItem>
        <MenuItem component="a" href={`/d/${slug}/print`} target="_blank" rel="noopener" onClick={() => setAnchor(null)}>
          {t("studio.deckExportPdf")}
        </MenuItem>
      </Menu>
      <Snackbar open={error} autoHideDuration={8000} onClose={() => setError(false)} message={t("studio.deckExportFailed")} />
    </>
  );
}
