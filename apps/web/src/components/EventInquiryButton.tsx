import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import MailOutlineIcon from "@mui/icons-material/MailOutline";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMe } from "../api/hooks.js";
import { useCreateEventInquiry } from "../api/inquiryHooks.js";
import { i18next } from "../i18n/index.js";
import { errorMessage } from "../lib/errorMessage.js";
import { CounterTextField } from "./CounterTextField.js";

/**
 * イベントのページの「主催者に問い合わせる」(D-EVENT-CONTACT)。
 * 送れるのはイベントを見られるログイン中の人なら誰でも（参加していなくてよい）。門はサーバー。
 * スタッフ本人は受け手なので出さない。未ログインならログインへ（戻り先はこのイベント）。
 */
export function EventInquiryButton({
  eventId,
  isStaff,
}: {
  eventId: string;
  isStaff: boolean;
}) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const [open, setOpen] = useState(false);

  if (isStaff) return null;
  if (!me) {
    return (
      <Box>
        <Button
          variant="outlined"
          startIcon={<MailOutlineIcon />}
          component={RouterLink}
          to={`/login?next=/events/${eventId}`}
        >
          {t("eventInquiry.loginToAsk")}
        </Button>
      </Box>
    );
  }

  return (
    <Box>
      <Button
        variant="outlined"
        startIcon={<MailOutlineIcon />}
        onClick={() => setOpen(true)}
      >
        {t("eventInquiry.ask")}
      </Button>
      {/* 送信の処理は開いたときだけ組み立てる（ボタンだけなら何も取りに行かない） */}
      {open && (
        <EventInquiryDialog eventId={eventId} onClose={() => setOpen(false)} />
      )}
    </Box>
  );
}

function EventInquiryDialog({
  eventId,
  onClose,
}: {
  eventId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const create = useCreateEventInquiry(eventId);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const submit = () => {
    if (!body.trim()) return;
    create.mutate(
      { subject: subject.trim(), body: body.trim() },
      { onSuccess: ({ id }) => navigate(`/inquiries/${id}`) },
    );
  };

  return (
    <Dialog open onClose={onClose} fullWidth>
      <DialogTitle>{t("eventInquiry.dialogTitle")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {t("eventInquiry.dialogNote")}
          </Typography>
          <CounterTextField
            label={t("eventInquiry.subjectPlaceholder")}
            value={subject}
            max={200}
            onChange={(e) => setSubject(e.target.value)}
            fullWidth
          />
          <CounterTextField
            label={t("eventInquiry.bodyPlaceholder")}
            value={body}
            max={5000}
            onChange={(e) => setBody(e.target.value)}
            multiline
            minRows={4}
            fullWidth
          />
          {create.isError && (
            <Alert severity="error">
              {errorMessage(create.error, {
                event_inquiry_limit: i18next.t("eventInquiry.tooMany"),
                default: i18next.t("inquiries.sendError"),
              })}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button
          variant="contained"
          disabled={!body.trim() || create.isPending}
          onClick={submit}
        >
          {t("eventInquiry.send")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
