import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { useTranslation } from "react-i18next";
import { useIssueMergeCode, useMergeAccount } from "../api/userHooks.js";
import { errorCode } from "../lib/errorMessage.js";

/** アカウント統合カード (#240)。
 * 誤ログイン等で複数できてしまったアカウントを、ユーザー自身で1つにまとめる。
 * 片方のアカウントで統合コードを発行し、もう片方で入力して実行する */
export function AccountMergeCard() {
  const { t } = useTranslation();
  const issue = useIssueMergeCode();
  const merge = useMergeAccount();
  const [issuedCode, setIssuedCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [inputCode, setInputCode] = useState("");
  const [keep, setKeep] = useState<"me" | "other">("me");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const issueCode = () => {
    setCopied(false);
    issue.mutate(undefined, {
      onSuccess: (data) => setIssuedCode(data.code),
      onError: () => setError(t("settings.mergeIssueFailed")),
    });
  };

  const copyCode = async () => {
    if (!issuedCode) return;
    try {
      await navigator.clipboard.writeText(issuedCode);
      setCopied(true);
    } catch {
      // コピー不可の環境ではテキストを手動選択してもらう
    }
  };

  const runMerge = () => {
    setConfirmOpen(false);
    setError(null);
    merge.mutate(
      { code: inputCode.trim(), keep },
      {
        onSuccess: () => {
          // 残らない側のセッションだった場合はログイン画面に戻る
          window.location.reload();
        },
        onError: (e) => {
          setError(
            errorCode(e) === "same_account"
              ? t("settings.mergeSameAccountError")
              : t("settings.mergeCodeInvalidError"),
          );
        },
      },
    );
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          {t("settings.mergeTitle")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("settings.mergeDescription")}
        </Typography>

        <Stack spacing={1} sx={{ mb: 3 }}>
          <Typography variant="subtitle2">{t("settings.mergeStep1")}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t("settings.mergeStep1Description")}
          </Typography>
          <Alert severity="warning">{t("settings.mergeCodeWarning")}</Alert>
          <Box>
            <Button
              variant="outlined"
              size="small"
              disabled={issue.isPending}
              onClick={issueCode}
            >
              {t("settings.mergeIssueCode")}
            </Button>
          </Box>
          {issuedCode && (
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField
                size="small"
                fullWidth
                value={issuedCode}
                slotProps={{
                  input: {
                    readOnly: true,
                    sx: { fontFamily: "monospace", fontSize: 13 },
                  },
                }}
                onFocus={(e) => e.target.select()}
              />
              <Button
                size="small"
                startIcon={<ContentCopyIcon />}
                onClick={copyCode}
              >
                {copied ? t("settings.mergeCopied") : t("settings.mergeCopy")}
              </Button>
            </Stack>
          )}
        </Stack>

        <Stack spacing={1}>
          <Typography variant="subtitle2">{t("settings.mergeStep2")}</Typography>
          <TextField
            size="small"
            label={t("settings.mergeCodeLabel")}
            value={inputCode}
            onChange={(e) => {
              setInputCode(e.target.value);
              setError(null);
            }}
            sx={{ maxWidth: 480 }}
          />
          <Typography variant="body2" color="text.secondary">
            {t("settings.mergeKeepLabel")}
          </Typography>
          <RadioGroup
            value={keep}
            onChange={(e) => setKeep(e.target.value as "me" | "other")}
          >
            <FormControlLabel
              value="me"
              control={<Radio size="small" />}
              label={t("settings.mergeKeepMe")}
            />
            <FormControlLabel
              value="other"
              control={<Radio size="small" />}
              label={t("settings.mergeKeepOther")}
            />
          </RadioGroup>
          <Typography variant="body2" color="text.secondary">
            {t("settings.mergeKeepNotice")}
          </Typography>
          <Box>
            <Button
              variant="contained"
              color="warning"
              size="small"
              disabled={!inputCode.trim() || merge.isPending}
              onClick={() => setConfirmOpen(true)}
            >
              {t("settings.mergeRun")}
            </Button>
          </Box>
          {error && <Alert severity="warning">{error}</Alert>}
        </Stack>
      </CardContent>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>{t("settings.mergeConfirmTitle")}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t("settings.mergeConfirmBody")}
            {keep === "other" && " " + t("settings.mergeConfirmKeepOtherNote")}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button color="warning" variant="contained" onClick={runMerge}>
            {t("settings.mergeConfirmRun")}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
