import { useState } from "react";
import { Alert, IconButton, Stack, TextField, Typography } from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import { useTranslation } from "react-i18next";
import { CHAT_MESSAGE_MAX, containsUrl } from "@eventer/shared";
import type { ChatWriteWindow } from "@eventer/shared";
import { formatDateTime } from "../../lib/format.js";
import type { ChatSendResult } from "./useChatChannel.js";

/**
 * 入力欄と送信 (#199 / #241)。投影用画面 (#215) では呼び出し側が描かない。
 *
 * 親の Stack の間隔をそのまま使うため、囲む要素を足さず素の兄弟として返す。
 */
export function ChatComposer({
  inWriteWindow,
  writeWindow,
  now,
  canSend,
  allowUrls,
  onSend,
  notice,
}: {
  /** 書き込める期間の中か（期間は主催者が選ぶ #578） */
  inWriteWindow: boolean;
  /** 書き込める期間。期間外のときに実際の期間を案内するのに使う */
  writeWindow: ChatWriteWindow;
  /** inWriteWindow を判定した時刻（期間前か期間後かの出し分け） */
  now: number;
  /** 送信先（チャンネル）が確定しているか */
  canSend: boolean;
  /** URL を投稿してよいか（スタッフ、またはURL投稿が許可されたイベント #241） */
  allowUrls: boolean;
  onSend: (text: string) => Promise<ChatSendResult>;
  /** 入力欄の下の注意書き。既定は「公開されます」。参加者のみ（暗号化）(#582) では
   * 公開されないので、呼び出し側が暗号化の説明に差し替える */
  notice?: string;
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

  // 期間外の案内 (#578)。実際の期間を書く（「開催時間の前後のみ」では
  // 主催者が期間を広げたイベントで何時から書けるのか分からない）
  // 期間外は「始まる前」か「終わった後」のどちらか（opensAt が null なら終わった後だけ）
  const closedMessage = inWriteWindow
    ? null
    : writeWindow.opensAt !== null && now < writeWindow.opensAt
      ? t("eventSocial.chatWriteWindowRange", {
          opensAt: formatDateTime(writeWindow.opensAt),
          closesAt: formatDateTime(writeWindow.closesAt),
        })
      : t("eventSocial.chatWriteWindowEnded", {
          closesAt: formatDateTime(writeWindow.closesAt),
        });

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
      {closedMessage && (
        <Typography variant="caption" color="text.secondary">
          {closedMessage}
        </Typography>
      )}
      <Typography variant="caption" color="text.secondary">
        {notice ?? t("eventSocial.chatPublicNotice")}
      </Typography>
    </>
  );
}
