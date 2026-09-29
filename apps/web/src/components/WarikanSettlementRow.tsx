import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Collapse,
  FormControlLabel,
  Snackbar,
  Stack,
  Typography,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import { useTranslation } from "react-i18next";
import type { WarikanLedger } from "@eventer/shared";
import { formatYen } from "@eventer/shared";
import { useToggleSettlementDone } from "../api/warikanHooks.js";
import { errorMessage } from "../lib/errorMessage.js";
import { formatMonthDay } from "../lib/format.js";
import { PayoutMethodView } from "./WarikanPayoutMethods.js";

/**
 * 割り勘の精算の行 (#556 §3.9「あなたの精算」)。
 *
 * 金額の正負は色ではなく語（「支払う」「受け取る」）で表す。
 * 支払い自体は他のアプリで行うので、ここは相手・金額・受け取り先・内訳と「済み」を出すだけ。
 * 行の金額は計算結果で、操作できるのは当事者が付け外しする「済み」の印だけ（§3.5.1）。
 */

/** 帳簿の応答の精算の行（内訳・「済み」・付け外しできるかを含む） */
export type LedgerSettlement = WarikanLedger["settlements"][number];

/** サーバーのエラーコードのうち、割り勘の画面だけで言い方を変えるもの（§3.8.2） */
export function useWarikanErrors(): Record<string, string> {
  const { t } = useTranslation();
  return {
    invalid_party: t("warikan.errorInvalidParty"),
    too_many_expenses: t("warikan.errorTooManyExpenses"),
    access_changed: t("warikan.errorAccessChanged"),
    validation_error: t("warikan.errorInvalidInput"),
    invalid_weight: t("warikan.errorInvalidWeight"),
    amount_changed: t("warikan.amountChanged"),
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

/** 自分が当事者の精算の行。自分が支払う行を先、受け取る行を後に並べる（「済み」の行も含む） */
export function mySettlements(ledger: WarikanLedger): LedgerSettlement[] {
  const me = ledger.me.userId;
  return [
    ...ledger.settlements.filter((s) => s.fromUserId === me),
    ...ledger.settlements.filter((s) => s.toUserId === me),
  ];
}

/** 自分の行のうち「済み」でないもの（カードに出す・ページで先に並べる行） */
export function myPendingSettlements(ledger: WarikanLedger): LedgerSettlement[] {
  return mySettlements(ledger).filter((s) => !s.done);
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

/** 「済み」のチェック。付けるときは行の額を送る（§3.8）。額が変わっていたら案内して取り直す */
function DoneCheckbox({
  eventId,
  settlement,
}: {
  eventId: string;
  settlement: LedgerSettlement;
}) {
  const { t } = useTranslation();
  const overrides = useWarikanErrors();
  const toggle = useToggleSettlementDone(eventId);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <FormControlLabel
        control={
          <Checkbox
            checked={Boolean(settlement.done)}
            disabled={toggle.isPending}
            onChange={(e) => {
              setError(null);
              toggle.mutate(
                {
                  fromUserId: settlement.fromUserId,
                  toUserId: settlement.toUserId,
                  amount: settlement.amount,
                  done: e.target.checked,
                },
                { onError: (err) => setError(errorMessage(err, overrides)) },
              );
            }}
          />
        }
        label={t("warikan.done")}
      />
      {error && (
        <Alert severity="warning" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}
    </>
  );
}

/** 「あなたの精算」の1行 */
export function WarikanSettlementRow({
  eventId,
  ledger,
  settlement,
}: {
  eventId: string;
  ledger: WarikanLedger;
  settlement: LedgerSettlement;
}) {
  const { t } = useTranslation();
  const yen = useYen();
  const signed = useSignedYen();
  const nameOf = useMemberName(ledger);
  const [openBreakdown, setOpenBreakdown] = useState(false);

  const me = ledger.me.userId;
  const iPay = settlement.fromUserId === me;
  const counterpartId = iPay ? settlement.toUserId : settlement.fromUserId;
  const counterpart = ledger.members.find((m) => m.userId === counterpartId);
  const counterpartName = nameOf(counterpartId);
  const counterpartDeleted = !counterpart || counterpart.standing === "deleted";
  const theirPayouts = ledger.payoutMethods.filter((m) => m.userId === counterpartId);
  const myPayouts = ledger.payoutMethods.filter((m) => m.userId === me);

  const breakdownLabel = (item: LedgerSettlement["breakdown"][number]): string => {
    const expense = ledger.expenses.find((e) => e.id === item.expenseId);
    const title = expense?.title ?? "";
    return expense?.payerUserId === me ? t("warikan.breakdownYourExpense", { title }) : title;
  };

  const breakdownButton = (
    <Button
      size="small"
      endIcon={openBreakdown ? <ExpandLessIcon /> : <ExpandMoreIcon />}
      onClick={() => setOpenBreakdown((v) => !v)}
      aria-expanded={openBreakdown}
    >
      {t("warikan.breakdown")}
    </Button>
  );

  const doneCheckbox = settlement.canToggle && (
    <DoneCheckbox eventId={eventId} settlement={settlement} />
  );

  // 済みの行は薄く残す。操作はチェックを外すだけで、金額コピー・受け取り先は出さない
  if (settlement.done) {
    return (
      <Box sx={{ py: 1.5, borderBottom: 1, borderColor: "divider", opacity: 0.6 }}>
        <Typography fontWeight={700}>
          {iPay
            ? t("warikan.payTo", { name: counterpartName, amount: yen(settlement.amount) })
            : t("warikan.receiveFrom", { name: counterpartName, amount: yen(settlement.amount) })}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("warikan.doneBy", {
            name: nameOf(settlement.done.markedBy),
            date: formatMonthDay(settlement.done.markedAt),
          })}
        </Typography>
        {doneCheckbox}
      </Box>
    );
  }

  return (
    <Box sx={{ py: 1.5, borderBottom: 1, borderColor: "divider" }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography fontWeight={700}>
          {iPay
            ? t("warikan.payTo", { name: counterpartName, amount: yen(settlement.amount) })
            : t("warikan.receiveFrom", { name: counterpartName, amount: yen(settlement.amount) })}
        </Typography>
        {/* コピーは向こうのアプリで金額を打つための道具なので、支払う側だけ（§3.6.4） */}
        {iPay && <CopyAmountButton amount={settlement.amount} />}
      </Stack>

      {iPay ? (
        <>
          {counterpartDeleted ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {t("warikan.counterpartDeleted")}
            </Typography>
          ) : (
            <Stack spacing={1} sx={{ mt: 1 }}>
              {theirPayouts.length > 0 ? (
                theirPayouts.map((m) => <PayoutMethodView key={m.id} method={m} />)
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {t("warikan.noPayoutMethod")}
                </Typography>
              )}
            </Stack>
          )}
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ mt: 0.5 }}>
            {breakdownButton}
            {doneCheckbox}
          </Stack>
        </>
      ) : (
        <>
          {counterpartDeleted && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {t("warikan.counterpartDeleted")}
            </Typography>
          )}
          {!counterpartDeleted && myPayouts.length === 0 && (
            <Box sx={{ mt: 1 }}>
              <Button size="small" href="#warikan-payout">
                {t("warikan.registerPayout")}
              </Button>
            </Box>
          )}
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ mt: 1 }}>
            {breakdownButton}
            {doneCheckbox}
          </Stack>
        </>
      )}

      <Collapse in={openBreakdown}>
        <Stack spacing={0.25} sx={{ pl: 1 }}>
          {settlement.breakdown.map((item) => (
            <Stack
              key={item.expenseId}
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
    </Box>
  );
}
