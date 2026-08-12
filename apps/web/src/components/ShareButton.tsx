import { useState } from "react";
import { IconButton, Snackbar, Tooltip } from "@mui/material";
import ShareIcon from "@mui/icons-material/Share";
import { useTranslation } from "react-i18next";

/** 短いシェアURLをワンタップでクリップボードにコピー（共有シートは使わない）。
 * prefix: "e"=イベント(/e/:slug) / "r"=たまご(/r/:slug)。
 * url を直接渡すとそのURLをコピーする（プロフィール等の任意ページ用） */
export function ShareButton({
  slug = "",
  title: _title,
  prefix = "e",
  url: urlProp,
}: {
  slug?: string;
  title: string;
  prefix?: "e" | "r";
  url?: string;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  if (!slug && !urlProp) return null;
  const url = urlProp ?? `${window.location.origin}/${prefix}/${slug}`;

  const share = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      window.prompt(t("common.sharePrompt"), url);
    }
  };

  return (
    <>
      <Tooltip title={t("common.shareCopy")}>
        <IconButton onClick={share} aria-label={t("common.share")}>
          <ShareIcon />
        </IconButton>
      </Tooltip>
      <Snackbar
        open={copied}
        autoHideDuration={2000}
        onClose={() => setCopied(false)}
        message={t("common.shareCopied", { url })}
      />
    </>
  );
}
