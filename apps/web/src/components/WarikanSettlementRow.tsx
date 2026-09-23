import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Settlement, WarikanLedger } from "@eventer/shared";
import { WARIKAN_AMOUNT_MAX, formatYen } from "@eventer/shared";
import { useRecordPayment } from "../api/warikanHooks.js";
import { errorMessage } from "../lib/errorMessage.js";
import { formatMonthDay } from "../lib/format.js";
import { PayoutMethodView } from "./WarikanPayoutMethods.js";

/**
 * 割り勘の精算の行 (#556 §3.9「あなたの精算」)。
 *
 * 金額の正負は色ではなく語（「支払う」「受け取る」）で表す。記録は本人の申告で、
 * アプリは確かめない。ボタンは「精算する」ではなく「支払ったことを記録する」。
 */

/** サーバーのエラーコードのうち、割り勘の画面だけで言い方を変えるもの（§3.8.2） */
export function useWarikanErrors(): Record<string, string> {
  const { t } = useTranslation();
  return {
    invalid_party: t("warikan.errorInvalidParty"),
    too_many_expenses: t("warikan.errorTooManyExpenses"),
    too_many_payments: t("warikan.errorTooManyPayments"),
    access_changed: t("warikan.errorAccessChanged"),
    validation_error: t("warikan.errorInvalidInput"),
  };
}

/** 円の表示（ja `1,200円` / en `¥1,200`） */
export function useYen(): (amount: number) => string {
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ja";
  return (amount: number) => formatYen(amount, locale);
}

/** 符号つきの円（内訳用。+1,000円 / -200円） */
export function useSignedYen(): (amount: number) => string {
  const yen = useYen();
  return (amount: number) => (amount > 0 ? `+${yen(amount)}` : yen(amount));
}

/** 帳簿のメンバーの表示名。退会申請中・退会済みは「退会済みユーザー」 */
export function useMemberName(
  ledger: WarikanLedger | undefined,
): (userId: string | null) => string {
  const { t } = useTranslation();
  return (userId) => {
    const m = userId ? ledger?.members.find((x) => x.userId === userId) : undefined;
    return m?.displayName ?? t("warikan.deletedUser");
  };
}

/** 自分が当事者の精算の行 */
export function mySettlements(ledger: WarikanLedger): Settlement[] {
  return ledger.settlements.filter(
    (s) => s.fromUserId === ledger.me.userId || s.toUserId === ledger.me.userId,
  );
}

/** 金額をクリップボードへ（向こうのアプリで金額を打つため） */
function CopyAmountButton({ amount }: { amount: number }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <>
      <Button
        size="small"
        startIcon={<ContentCopyIcon />}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(String(amount));
            setCopied(true);
          } catch {
            window.prompt(t("common.sharePrompt"), String(amount));
          }
        }}
      >
        {t("warikan.copyAmount")}
      </Button>
      <Snackbar
        open={copied}
        autoHideDuration={2000}
        onClose={() => setCopied(false)}
        message={t("warikan.copied")}
      />
    </>
  );
}

/** 支払い／受け取りの記録ダイアログ。金額の初期値はその行の残り */
function RecordPaymentDialog({
  eventId,
  settlement,
  counterpartName,
  iPay,
  open,
  onClose,
}: {
  eventId: string;
  settlement: Settlement;
  counterpartName: string;
  iPay: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const yen = useYen();
  const overrides = useWarikanErrors();
  const record = useRecordPayment(eventId);
  const [amount, setAmount] = useState(String(settlement.amount));
  const [error, setError] = useState<string | null>(null);

  const value = Number(amount);
  const valid = Number.isInteger(value) && value >= 1 && value <= WARIKAN_AMOUNT_MAX;

  const submit = () => {
    if (!valid) return;
    // 残りを超える記録は逆向きの行を生むので、保存前に確かめる
    if (
      value > settlement.amount &&
      !window.confirm(t("warikan.recordOverConfirm", { remaining: yen(settlement.amount) }))
    ) {
      return;
    }
    record.mutate(
      { fromUserId: settlement.fromUserId, toUserId: settlement.toUserId, amount: value },
      {
        onSuccess: onClose,
        onError: (e) => setError(errorMessage(e, overrides)),
      },
    );
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>
        {iPay
          ? t("warikan.recordPaidTitle", { name: counterpartName })
          : t("warikan.recordReceivedTitle", { name: counterpartName })}
      </DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          margin="dense"
          label={t("warikan.recordAmount")}
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
          inputProps={{ inputMode: "numeric", pattern: "[0-9]*" }}
        />
        <Typography variant="caption" color="text.secondary">
          {t("warikan.recordSelfReport")}
        </Typography>
        {error && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="contained" onClick={submit} disabled={!valid || record.isPending}>
          {t("warikan.record")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** 「あなたの精算」の1行 */
export function WarikanSettlementRow({
  eventId,
  ledger,
  settlement,
  chatAvailable,
}: {
  eventId: string;
  ledger: WarikanLedger;
  settlement: Settlement;
  chatAvailable: boolean;
}) {
  const { t } = useTranslation();
  const yen = useYen();
  const signed = useSignedYen();
  const nameOf = useMemberName(ledger);
  const [openBreakdown, setOpenBreakdown] = useState(false);
  const [recording, setRecording] = useState(false);

  const me = ledger.me.userId;
  const iPay = settlement.fromUserId === me;
  const counterpartId = iPay ? settlement.toUserId : settlement.fromUserId;
  const counterpart = ledger.members.find((m) => m.userId === counterpartId);
  const counterpartName = nameOf(counterpartId);
  const counterpartDeleted = !counterpart || counterpart.standing === "deleted";
  const theirPayouts = ledger.payoutMethods.filter((m) => m.userId === counterpartId);
  const myPayouts = ledger.payoutMethods.filter((m) => m.userId === me);

  const breakdownLabel = (item: Settlement["breakdown"][number]): string => {
    if (item.kind === "expense") {
      const expense = ledger.expenses.find((e) => e.id === item.expenseId);
      const title = expense?.title ?? "";
      return expense?.payerUserId === me
        ? t("warikan.breakdownYourExpense", { title })
        : title;
    }
    const payment = ledger.payments.find((p) => p.id === item.paymentId);
    return t("warikan.breakdownPayment", {
      date: payment ? formatMonthDay(payment.createdAt) : "",
    });
  };

  return (
    <Box sx={{ py: 1.5, borderBottom: 1, borderColor: "divider" }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography fontWeight={700}>
          {iPay
            ? t("warikan.payTo", { name: counterpartName, amount: yen(settlement.amount) })
            : t("warikan.receiveFrom", { name: counterpartName, amount: yen(settlement.amount) })}
        </Typography>
        <CopyAmountButton amount={settlement.amount} />
      </Stack>

      {counterpartDeleted ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t("warikan.counterpartDeleted")}
        </Typography>
      ) : (
        <Stack spacing={1} sx={{ mt: 1 }}>
          {iPay &&
            (theirPayouts.length > 0 ? (
              theirPayouts.map((m) => <PayoutMethodView key={m.id} method={m} />)
            ) : (
              <Box>
                <Typography variant="body2" color="text.secondary">
                  {t("warikan.noPayoutMethod")}
                </Typography>
                {chatAvailable && (
                  <Link component={RouterLink} to={`/events/${eventId}/chat`} variant="body2">
                    {t("warikan.chatNudge")}
                  </Link>
                )}
              </Box>
            ))}
          {!iPay && myPayouts.length === 0 && (
            <Box>
              <Button size="small" href="#warikan-payout">
                {t("warikan.registerPayout")}
              </Button>
            </Box>
          )}
          <Box>
            <Button size="small" variant="outlined" onClick={() => setRecording(true)}>
              {iPay ? t("warikan.recordPaid") : t("warikan.recordReceived")}
            </Button>
          </Box>
        </Stack>
      )}

      <Button
        size="small"
        sx={{ mt: 0.5 }}
        endIcon={openBreakdown ? <ExpandLessIcon /> : <ExpandMoreIcon />}
        onClick={() => setOpenBreakdown((v) => !v)}
        aria-expanded={openBreakdown}
      >
        {t("warikan.breakdown")}
      </Button>
      <Collapse in={openBreakdown}>
        <Stack spacing={0.25} sx={{ pl: 1 }}>
          {settlement.breakdown.map((item) => (
            <Stack
              key={item.kind === "expense" ? `e:${item.expenseId}` : `p:${item.paymentId}`}
              direction="row"
              justifyContent="space-between"
              spacing={2}
            >
              <Typography variant="body2">{breakdownLabel(item)}</Typography>
              <Typography variant="body2">{signed(item.amount)}</Typography>
            </Stack>
          ))}
          <Typography variant="body2" fontWeight={700} textAlign="right">
            {t("warikan.breakdownTotal", { amount: yen(settlement.amount) })}
          </Typography>
        </Stack>
      </Collapse>

      {recording && (
        <RecordPaymentDialog
          eventId={eventId}
          settlement={settlement}
          counterpartName={counterpartName}
          iPay={iPay}
          open={recording}
          onClose={() => setRecording(false)}
        />
      )}
    </Box>
  );
}
