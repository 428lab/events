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
  Typography,
} from "@mui/material";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useCreateInquiry, useInquiries } from "../api/inquiryHooks.js";
import { CounterTextField } from "../components/CounterTextField.js";
import { formatDateTime } from "../lib/format.js";

export function InquiriesPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
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
          {t("nav.inquiries")}
        </Typography>
        {!open && (
          <Button variant="contained" onClick={() => setOpen(true)}>
            {t("inquiries.create")}
          </Button>
        )}
      </Stack>

      {open && (
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={2}>
              <CounterTextField
                label={t("common.subject")}
                value={subject}
                max={200}
                onChange={(e) => setSubject(e.target.value)}
                fullWidth
              />
              <CounterTextField
                label={t("inquiries.body")}
                value={body}
                max={5000}
                onChange={(e) => setBody(e.target.value)}
                multiline
                minRows={4}
                fullWidth
              />
              {create.isError && (
                <Alert severity="error">{t("inquiries.sendError")}</Alert>
              )}
              <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1} justifyContent="flex-end">
                <Button onClick={() => setOpen(false)}>
                  {t("common.cancel")}
                </Button>
                <Button
                  variant="contained"
                  disabled={!subject.trim() || !body.trim() || create.isPending}
                  onClick={submit}
                >
                  {t("inquiries.send")}
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      )}

      {isLoading || !inquiries ? (
        <Typography>{t("common.loading")}</Typography>
      ) : inquiries.length === 0 ? (
        <Typography color="text.secondary">{t("inquiries.empty")}</Typography>
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
                      label={t(
                        q.status === "answered"
                          ? "inquiryStatus.answered"
                          : "inquiryStatus.open",
                      )}
                      color={q.status === "answered" ? "success" : "default"}
                    />
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    {t("inquiries.lastUpdated", {
                      time: formatDateTime(q.lastMessageAt),
                    })}
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
