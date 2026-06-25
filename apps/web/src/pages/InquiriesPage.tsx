import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { useCreateInquiry, useInquiries } from "../api/inquiryHooks.js";
import { formatDateTime } from "../lib/format.js";

export function InquiriesPage() {
  const navigate = useNavigate();
  const { data: inquiries, isLoading } = useInquiries();
  const create = useCreateInquiry();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const submit = () => {
    if (!subject.trim() || !body.trim()) return;
    create.mutate(
      { subject: subject.trim(), body: body.trim() },
      { onSuccess: ({ id }) => navigate(`/inquiries/${id}`) },
    );
  };

  return (
    <Stack spacing={3}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h5" fontWeight={700}>
          お問い合わせ
        </Typography>
        {!open && (
          <Button variant="contained" onClick={() => setOpen(true)}>
            新規問い合わせ
          </Button>
        )}
      </Stack>

      {open && (
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={2}>
              <TextField
                label="件名"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                fullWidth
              />
              <TextField
                label="内容"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                multiline
                minRows={4}
                fullWidth
              />
              {create.isError && (
                <Alert severity="error">送信に失敗しました。</Alert>
              )}
              <Stack direction="row" spacing={1} justifyContent="flex-end">
                <Button onClick={() => setOpen(false)}>キャンセル</Button>
                <Button
                  variant="contained"
                  disabled={!subject.trim() || !body.trim() || create.isPending}
                  onClick={submit}
                >
                  送信
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      )}

      {isLoading || !inquiries ? (
        <Typography>読み込み中…</Typography>
      ) : inquiries.length === 0 ? (
        <Typography color="text.secondary">
          お問い合わせはまだありません。ご質問・ご要望はお気軽にどうぞ。
        </Typography>
      ) : (
        <Stack spacing={1.5}>
          {inquiries.map((q) => (
            <Card key={q.id} variant="outlined">
              <CardActionArea component={RouterLink} to={`/inquiries/${q.id}`}>
                <CardContent>
                  <Stack direction="row" spacing={1} alignItems="center">
                    {q.unread && (
                      <Box
                        sx={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          bgcolor: "error.main",
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <Typography sx={{ flex: 1, fontWeight: q.unread ? 700 : 400 }}>
                      {q.subject}
                    </Typography>
                    <Chip
                      size="small"
                      label={q.status === "answered" ? "回答済み" : "対応中"}
                      color={q.status === "answered" ? "success" : "default"}
                    />
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    最終更新 {formatDateTime(q.lastMessageAt)}
                  </Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
