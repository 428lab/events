import { useState } from "react";
import {
  Box,
  Button,
  Chip,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { InquiryDetail } from "@eventer/shared";
import { CounterTextField } from "./CounterTextField.js";
import { formatDateTime } from "../lib/format.js";
import { tDynamic } from "../i18n/index.js";

export function InquiryThread({
  detail,
  selfSender,
  onSend,
  sending,
}: {
  detail: InquiryDetail;
  selfSender: "user" | "admin";
  onSend: (body: string) => void;
  sending: boolean;
}) {
  const { t } = useTranslation();
  const [body, setBody] = useState("");
  const send = () => {
    if (!body.trim()) return;
    onSend(body.trim());
    setBody("");
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="h6" sx={{ flex: 1 }}>
          {detail.subject}
        </Typography>
        <Chip
          size="small"
          // サーバーが状態を増やしても画面にキー名が出ないよう、辞書に無ければ
          // 生のコードを出す（API 応答は実行時に検証していない）
          label={tDynamic(`inquiryStatus.${detail.status}`, detail.status)}
          color={detail.status === "answered" ? "success" : "default"}
        />
      </Stack>

      <Stack spacing={1.5}>
        {detail.messages.map((m) => {
          const mine = m.sender === selfSender;
          const senderLabel = mine
            ? t("inquiries.senderYou")
            : m.sender === "admin"
              ? t("inquiries.senderAdmin")
              : (detail.userName ?? t("inquiries.senderUser"));
          // 運営視点でユーザー発言の名前はプロフィールへリンク
          const linkToUser =
            !mine && m.sender === "user" && detail.userHandle
              ? `/users/${detail.userHandle}`
              : null;
          return (
            <Box
              key={m.id}
              sx={{
                alignSelf: mine ? "flex-end" : "flex-start",
                maxWidth: "85%",
              }}
            >
              <Box
                sx={{
                  bgcolor: mine ? "primary.main" : "action.hover",
                  color: mine ? "primary.contrastText" : "text.primary",
                  px: 1.5,
                  py: 1,
                  borderRadius: 2,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {m.body}
              </Box>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", textAlign: mine ? "right" : "left", mt: 0.25 }}
              >
                {linkToUser ? (
                  <Link
                    component={RouterLink}
                    to={linkToUser}
                    color="inherit"
                    underline="hover"
                  >
                    {senderLabel}
                  </Link>
                ) : (
                  senderLabel
                )}
                {t("common.dotSeparator")}
                {formatDateTime(m.createdAt)}
              </Typography>
            </Box>
          );
        })}
      </Stack>

      <Stack direction="row" spacing={1} alignItems="flex-end">
        <CounterTextField
          fullWidth
          multiline
          minRows={2}
          size="small"
          placeholder={t("inquiries.replyPlaceholder")}
          value={body}
          max={5000}
          onChange={(e) => setBody(e.target.value)}
        />
        <Button variant="contained" disabled={sending || !body.trim()} onClick={send}>
          {t("common.send")}
        </Button>
      </Stack>
    </Stack>
  );
}
