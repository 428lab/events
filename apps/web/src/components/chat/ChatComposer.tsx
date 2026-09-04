import { useState } from "react";
import { Alert, IconButton, Stack, TextField, Typography } from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import { useTranslation } from "react-i18next";
import { CHAT_MESSAGE_MAX, containsUrl } from "@eventer/shared";
import type { ChatSendResult } from "./useChatChannel.js";

/**
 * 入力欄と送信 (#199 / #241)。投影用画面 (#215) では呼び出し側が描かない。
 *
 * 親の Stack の間隔をそのまま使うため、囲む要素を足さず素の兄弟として返す。
 */
export function ChatComposer({
  inWriteWindow,
  canSend,
  allowUrls,
  onSend,
}: {
  /** 書き込み可能時間帯か（開始30分前〜終了2時間後） */
  inWriteWindow: boolean;
  /** 送信先（チャンネル）が確定しているか */
  canSend: boolean;
  /** URL を投稿してよいか（スタッフ、またはURL投稿が許可されたイベント #241） */
  allowUrls: boolean;
  onSend: (text: string) => Promise<ChatSendResult>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);

  const submit = async () => {
    const text = draft.trim();
    if (!text || !canSend || !inWriteWindow) return;
    if (text.length > CHAT_MESSAGE_MAX) return;
    // URL投稿の送信ガード (#241)。判定は表示側のリンク化と同じ関数を共用
    if (!allowUrls && containsUrl(text)) {
      setSendError(t("eventSocial.chatSendUrlNotAllowed"));
      return;
    }
    setSendError(null);
    const result = await onSend(text);
    if (result === "ok") {
      setDraft("");
      return;
    }
    setSendError(
      t(
        result === "offline"
          ? "eventSocial.chatSendFailedOffline"
          : "eventSocial.chatSendFailed",
      ),
    );
  };

  return (
    <>
      {sendError && (
        <Alert severity="warning" onClose={() => setSendError(null)}>
          {sendError}
        </Alert>
      )}
      <Stack direction="row" spacing={1} alignItems="center">
        <TextField
          size="small"
          fullWidth
          value={draft}
          disabled={!inWriteWindow}
          placeholder={
            inWriteWindow
              ? t("eventSocial.chatInputPlaceholder")
              : t("eventSocial.chatInputClosedPlaceholder")
          }
          inputProps={{ maxLength: CHAT_MESSAGE_MAX }}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <IconButton
          color="primary"
          disabled={!inWriteWindow || !draft.trim() || !canSend}
          onClick={() => void submit()}
          aria-label={t("common.send")}
        >
          <SendIcon fontSize="small" />
        </IconButton>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {t("eventSocial.chatPublicNotice")}
      </Typography>
    </>
  );
}
