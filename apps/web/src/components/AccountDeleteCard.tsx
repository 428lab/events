import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  Typography,
} from "@mui/material";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useDeletionGraceMs } from "../api/hooks.js";

import { useDeleteAccount } from "../api/userHooks.js";
import { i18next } from "../i18n/index.js";

/** 退会カード (#244, #250)。アカウント設定の最下部に置く。
 * 何が残り何が消えるか・猶予期間 (#250) を説明し、
 * チェック＋確認ダイアログの二段構えで実行する */
/** 猶予期間の表示（環境で変わる。staging は検証用に短い） */
function formatGrace(ms: number): string {
  const days = Math.round(ms / 86_400_000);
  if (days >= 1) return i18next.t("settings.graceDays", { n: days });
  return i18next.t("settings.graceMinutes", {
    n: Math.max(1, Math.round(ms / 60_000)),
  });
}

export function AccountDeleteCard() {
  const { t } = useTranslation();
  const graceText = formatGrace(useDeletionGraceMs());
  const deleteAccount = useDeleteAccount();
  const qc = useQueryClient();
  const [agreed, setAgreed] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    setConfirmOpen(false);
    setError(null);
    deleteAccount.mutate(undefined, {
      onSuccess: () => {
        // アカウントは即座に利用不可になるので、手元の表示キャッシュも全部捨てて
        // ログイン画面へ移動する
        qc.clear();
        window.location.assign("/login");
      },
      onError: () => setError(t("settings.deleteFailed")),
    });
  };

  return (
    <Card variant="outlined" sx={{ borderColor: "error.main" }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          {t("settings.deleteTitle")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {t("settings.deleteGraceNotice", { grace: graceText })}
        </Typography>
        <Typography
          variant="body2"
          color="text.secondary"
          component="div"
          sx={{ mb: 2 }}
        >
          <ul style={{ margin: 0, paddingLeft: "1.4em" }}>
            <li>{t("settings.deleteBulletLogout")}</li>
            <li>{t("settings.deleteBulletPurge", { grace: graceText })}</li>
            <li>{t("settings.deleteBulletKeptContent")}</li>
            <li>{t("settings.deleteBulletActivity")}</li>
            <li>{t("settings.deleteBulletMedia")}</li>
            <li>{t("settings.deleteBulletChat")}</li>
            <li>{t("settings.deleteBulletNewAccount")}</li>
          </ul>
        </Typography>
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
          }
          label={t("settings.deleteAgree")}
        />
        <Box sx={{ mt: 1 }}>
          <Button
            variant="contained"
            color="error"
            size="small"
            disabled={!agreed || deleteAccount.isPending}
            onClick={() => setConfirmOpen(true)}
          >
            {t("settings.deleteButton")}
          </Button>
        </Box>
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </CardContent>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>{t("settings.deleteConfirmTitle")}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t("settings.deleteConfirmBody", { grace: graceText })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={deleteAccount.isPending}
            onClick={run}
          >
            {t("settings.deleteConfirmRun")}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
