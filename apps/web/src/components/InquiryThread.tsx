import { useState } from "react";
import { Box, Button, Chip, Stack, TextField, Typography } from "@mui/material";
import type { InquiryDetail } from "@eventer/shared";
import { formatDateTime } from "../lib/format.js";

const STATUS_LABEL: Record<string, string> = {
  open: "対応中",
  answered: "回答済み",
  closed: "クローズ",
};

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
          label={STATUS_LABEL[detail.status] ?? detail.status}
          color={detail.status === "answered" ? "success" : "default"}
        />
      </Stack>

      <Stack spacing={1.5}>
        {detail.messages.map((m) => {
          const mine = m.sender === selfSender;
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
                {m.sender === "admin" ? "運営" : "あなた"} ・ {formatDateTime(m.createdAt)}
              </Typography>
            </Box>
          );
        })}
      </Stack>

      <Stack direction="row" spacing={1} alignItems="flex-end">
        <TextField
          fullWidth
          multiline
          minRows={2}
          size="small"
          placeholder="返信を入力…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <Button variant="contained" disabled={sending || !body.trim()} onClick={send}>
          送信
        </Button>
      </Stack>
    </Stack>
  );
}
