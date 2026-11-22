import { useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useCreateStaffContact } from "../api/inquiryHooks.js";
import { CounterTextField } from "./CounterTextField.js";

/**
 * 運営からメンバー1人へ個別に連絡する（運営から始める問い合わせ。オーナー決定 2026-11-22）。
 * 参加者一覧の「…」とタイムテーブルの登壇者から開く。送ったら、そのスレッド（運営側）を開く。
 * 件名と本文の上限は問い合わせと同じ。誰に送れるかはサーバーが決める（そのイベントのメンバーで自分以外）
 */
export function StaffContactDialog({
  eventId,
  userId,
  name,
  onClose,
}: {
  eventId: string;
  userId: string;
  name: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const create = useCreateStaffContact(eventId);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const submit = () => {
    if (!body.trim()) return;
    create.mutate(
      { userId, subject: subject.trim(), body: body.trim() },
      { onSuccess: ({ id }) => navigate(`/events/${eventId}/inquiries/${id}`) },
    );
  };

  return (
    <Dialog open onClose={onClose} fullWidth>
      <DialogTitle>{t("eventInquiry.contactDialogTitle", { name })}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {t("eventInquiry.contactDialogNote", { name })}
          </Typography>
          <CounterTextField
            label={t("eventInquiry.subjectPlaceholder")}
            value={subject}
            max={200}
            onChange={(e) => setSubject(e.target.value)}
            fullWidth
          />
          <CounterTextField
            label={t("eventInquiry.contactBodyPlaceholder")}
            value={body}
            max={5000}
            onChange={(e) => setBody(e.target.value)}
            multiline
            minRows={4}
            fullWidth
          />
          {create.isError && <Alert severity="error">{t("eventInquiry.contactSendFailed")}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="contained" disabled={!body.trim() || create.isPending} onClick={submit}>
          {t("eventInquiry.send")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
