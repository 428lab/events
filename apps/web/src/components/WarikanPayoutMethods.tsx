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
  IconButton,
  MenuItem,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import BoltOutlinedIcon from "@mui/icons-material/BoltOutlined";
import LinkOutlinedIcon from "@mui/icons-material/LinkOutlined";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { useTranslation } from "react-i18next";
import type { PayoutKind, WarikanLedger, WarikanPayout } from "@eventer/shared";
import { PAYOUT_KINDS, WARIKAN_PAYOUT_MAX, payoutMethodInput } from "@eventer/shared";
import { useDeletePayoutMethod, useSavePayoutMethods } from "../api/warikanHooks.js";
import { errorMessage } from "../lib/errorMessage.js";
import { QrCodeSvg } from "./BigQrDialog.js";
import { useWarikanErrors } from "./WarikanSettlementRow.js";

/**
 * 割り勘の受け取り先 (#556 §3.6)。
 *
 * 受け取り先は URL と Lightning の2種だけ（銀行口座は保存しない）。
 * アプリは外部リンクを開くだけで、中で支払いの画面を描かない。Lightning は文字列を
 * `lightning:` URI と QR にするだけで、invoice の発行も LNURL の解決もしない。
 */

/** ホスト名。なりすましのリンクに気づけるよう、ボタンの下に小さく出す */
function hostOf(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}

/** 相手の受け取り先1件の表示（精算の行の中で使う） */
export function PayoutMethodView({ method }: { method: WarikanPayout }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  if (method.kind === "url") {
    return (
      <Box>
        <Button
          size="medium"
          variant="contained"
          sx={{ minHeight: 44 }}
          startIcon={<LinkOutlinedIcon />}
          href={method.value}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("warikan.openLink")}
        </Button>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
          {hostOf(method.value)}
        </Typography>
      </Box>
    );
  }

  const uri = `lightning:${method.value}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(method.value);
      setCopied(true);
    } catch {
      window.prompt(t("common.sharePrompt"), method.value);
    }
  };
  return (
    <Box>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
        <Button
          size="medium"
          variant="contained"
          sx={{ minHeight: 44 }}
          startIcon={<BoltOutlinedIcon />}
          href={uri}
        >
          {t("warikan.openWallet")}
        </Button>
        {/* 幅が足りないときは「コピー」と「QR」をまとめて次の段へ（QR だけ落とさない） */}
        <Stack direction="row" spacing={1}>
          <Button size="small" startIcon={<ContentCopyIcon />} onClick={copy}>
            {t("warikan.copyAddress")}
          </Button>
          <Button size="small" onClick={() => setQrOpen(true)}>
            {t("warikan.showQr")}
          </Button>
        </Stack>
      </Stack>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block", mt: 0.5, wordBreak: "break-all" }}
      >
        {method.value}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
        {t("warikan.satsNote")}
      </Typography>
      <Dialog open={qrOpen} onClose={() => setQrOpen(false)} maxWidth="xs" fullWidth>
        {/* 読み取り面は常に白（BigQrDialog と同じ） */}
        <DialogContent sx={{ bgcolor: "#ffffff" }}>
          <Box sx={{ width: "100%", maxWidth: 320, mx: "auto" }}>
            <QrCodeSvg url={uri} label={method.value} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setQrOpen(false)}>{t("common.close")}</Button>
        </DialogActions>
      </Dialog>
      <Snackbar
        open={copied}
        autoHideDuration={2000}
        onClose={() => setCopied(false)}
        message={t("warikan.copied")}
      />
    </Box>
  );
}

/** 自分の受け取り先の登録・削除（本人のぶんだけ） */
export function WarikanPayoutMethods({
  eventId,
  ledger,
}: {
  eventId: string;
  ledger: WarikanLedger;
}) {
  const { t } = useTranslation();
  const overrides = useWarikanErrors();
  const save = useSavePayoutMethods(eventId);
  const remove = useDeletePayoutMethod(eventId);
  const [kind, setKind] = useState<PayoutKind>("url");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mine = ledger.payoutMethods.filter((m) => m.userId === ledger.me.userId);
  const kindLabel = (k: PayoutKind) =>
    k === "url" ? t("warikan.kindUrl") : t("warikan.kindLightning");

  const add = () => {
    const parsed = payoutMethodInput.safeParse({ kind, value: value.trim() });
    if (!parsed.success) {
      setError(t("warikan.errorInvalidInput"));
      return;
    }
    setError(null);
    // PUT は置換なので、いまの分に1件足して送る
    save.mutate(
      [...mine.map((m) => ({ kind: m.kind, value: m.value }) as typeof parsed.data), parsed.data],
      {
        onSuccess: () => setValue(""),
        onError: (e) => setError(errorMessage(e, overrides)),
      },
    );
  };

  return (
    <Card variant="outlined" id="warikan-payout">
      <CardContent>
        <Typography variant="h6" fontWeight={700}>
          {t("warikan.payoutHeading")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("warikan.payoutCaption")}
        </Typography>

        <Stack spacing={1} sx={{ mb: 2 }}>
          {mine.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              {t("warikan.noPayouts")}
            </Typography>
          )}
          {mine.map((m) => (
            <Stack key={m.id} direction="row" spacing={1} alignItems="center">
              {m.kind === "url" ? (
                <LinkOutlinedIcon fontSize="small" color="action" />
              ) : (
                <BoltOutlinedIcon fontSize="small" color="action" />
              )}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="caption" color="text.secondary">
                  {kindLabel(m.kind)}
                </Typography>
                <Typography variant="body2" sx={{ wordBreak: "break-all" }}>
                  {m.value}
                </Typography>
              </Box>
              <Tooltip title={t("common.delete")}>
                <IconButton
                  aria-label={t("common.delete")}
                  disabled={remove.isPending}
                  onClick={() => {
                    if (!window.confirm(t("warikan.deletePayoutConfirm"))) return;
                    remove.mutate(m.id, { onError: (e) => setError(errorMessage(e, overrides)) });
                  }}
                >
                  <DeleteOutlineIcon />
                </IconButton>
              </Tooltip>
            </Stack>
          ))}
        </Stack>

        {mine.length < WARIKAN_PAYOUT_MAX && (
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "flex-start" }}>
            <TextField
              select
              size="small"
              value={kind}
              inputProps={{ "aria-label": t("warikan.payoutHeading") }}
              onChange={(e) => setKind(e.target.value as PayoutKind)}
              sx={{ minWidth: 220 }}
            >
              {PAYOUT_KINDS.map((k) => (
                <MenuItem key={k} value={k}>
                  {kindLabel(k)}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              fullWidth
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={
                kind === "url" ? t("warikan.payoutValueUrl") : t("warikan.payoutValueLightning")
              }
              helperText={kind === "url" ? t("warikan.kindUrlHelp") : t("warikan.kindLightningHelp")}
              inputProps={{ "aria-label": kindLabel(kind) }}
            />
            <Button variant="outlined" onClick={add} disabled={!value.trim() || save.isPending}>
              {t("warikan.addPayout")}
            </Button>
          </Stack>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {error}
          </Alert>
        )}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          {t("warikan.noBankNote")}
        </Typography>
      </CardContent>
    </Card>
  );
}
