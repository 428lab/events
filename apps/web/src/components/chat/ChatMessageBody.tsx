import { useState } from "react";
import { Box, Link, Typography } from "@mui/material";
import { detectImageUrl, splitByUrls } from "@eventer/shared";

/** 本文中のURLリンク（新しいタブで開く）。スタッフチャットとも共有する */
export function ChatUrlLink({ url }: { url: string }) {
  return (
    <Link
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      sx={{ wordBreak: "break-all" }}
    >
      {url}
    </Link>
  );
}

/** インライン画像。読み込み失敗時はリンク表示にフォールバック (#241) */
function InlineChatImage({
  url,
  onOpen,
}: {
  url: string;
  onOpen: (url: string) => void;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return <ChatUrlLink url={url} />;
  return (
    <Box
      component="img"
      src={url}
      alt={url}
      loading="lazy"
      draggable={false}
      // 外部ホストにチャットのURLを渡さない（既存の画像表示と同ポリシー）
      referrerPolicy="no-referrer"
      role="button"
      tabIndex={0}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === "Enter") onOpen(url);
      }}
      onClick={() => onOpen(url)}
      onError={() => setFailed(true)}
      sx={{
        maxWidth: "100%",
        maxHeight: 220,
        objectFit: "contain",
        display: "block",
        mt: 0.5,
        borderRadius: "4px",
        cursor: "zoom-in",
      }}
    />
  );
}

/** メッセージ本文。linkify のときだけURLをリンク/インライン画像にする (#241)。
 * 表示側で制御するのは、外部クライアントからの投稿はサーバーで
 * 止められないため（プレーン表示が最終防衛線） */
export function ChatMessageBody({
  content,
  linkify,
  onOpenImage,
  fontSize,
}: {
  content: string;
  linkify: boolean;
  onOpenImage: (url: string) => void;
  /** 投影用の拡大表示 (#215)。未指定なら variant="body2" の既定サイズ */
  fontSize?: string;
}) {
  return (
    <Typography
      variant="body2"
      sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize }}
    >
      {linkify
        ? splitByUrls(content).map((tok, i) =>
            tok.type === "text" ? (
              <span key={i}>{tok.value}</span>
            ) : detectImageUrl(tok.value) ? (
              <InlineChatImage key={i} url={tok.value} onOpen={onOpenImage} />
            ) : (
              <ChatUrlLink key={i} url={tok.value} />
            ),
          )
        : content}
    </Typography>
  );
}
