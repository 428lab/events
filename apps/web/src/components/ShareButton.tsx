import { useState } from "react";
import { IconButton, Snackbar, Tooltip } from "@mui/material";
import ShareIcon from "@mui/icons-material/Share";

/** 短いシェアURLを共有（モバイルはOSの共有シート、他はクリップボードにコピー） */
export function ShareButton({ slug, title }: { slug: string; title: string }) {
  const [copied, setCopied] = useState(false);
  if (!slug) return null;
  const url = `${window.location.origin}/e/${slug}`;

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        /* キャンセル時はフォールバックしない */
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      window.prompt("このURLをコピーしてください", url);
    }
  };

  return (
    <>
      <Tooltip title="シェアリンクをコピー">
        <IconButton onClick={share} aria-label="シェア">
          <ShareIcon />
        </IconButton>
      </Tooltip>
      <Snackbar
        open={copied}
        autoHideDuration={2000}
        onClose={() => setCopied(false)}
        message={`リンクをコピーしました: ${url}`}
      />
    </>
  );
}
