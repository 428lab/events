import { Button, Card, CardContent, Stack, Typography } from "@mui/material";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useWarikan } from "../api/warikanHooks.js";
import { myPendingSettlements, useMemberName, useYen } from "./WarikanSettlementRow.js";

/** カードに出す行の上限。それより多い分は「ほか n 件」にまとめる */
const MAX_ROWS = 2;

/**
 * イベント詳細の割り勘カード (#556 §3.9)。
 *
 * **自分の精算の行のうち「済み」でないものがあるときだけ**出す。督促の通知を作らないので、
 * ここが自分の貸し借りに気づく唯一の場所になる。全部「済み」なら出さない（済みの行はページで見る）。
 * 差引ではなく相手ごとの行で、やることを語（支払う／受け取る）で出す。
 * 呼び出し側はログイン中なら描く。帳簿の GET が 404（帳簿を見られない人）なら黙って何も出さない。
 */
export function WarikanSummaryCard({ eventId }: { eventId: string }) {
  const { t } = useTranslation();
  const yen = useYen();
  const { data: ledger } = useWarikan(eventId, true);
  const nameOf = useMemberName(ledger);
  if (!ledger) return null;
  const rows = myPendingSettlements(ledger);
  if (rows.length === 0) return null;

  const me = ledger.me.userId;
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography
          variant="h6"
          fontWeight={700}
          sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 1 }}
        >
          <ReceiptLongIcon fontSize="small" />
          {t("warikan.title")}
        </Typography>
        <Stack spacing={0.5}>
          {rows.slice(0, MAX_ROWS).map((s) => (
            <Typography key={`${s.fromUserId}:${s.toUserId}`}>
              {s.fromUserId === me
                ? t("warikan.payToAction", { name: nameOf(s.toUserId), amount: yen(s.amount) })
                : t("warikan.receiveFromAction", {
                    name: nameOf(s.fromUserId),
                    amount: yen(s.amount),
                  })}
            </Typography>
          ))}
          {rows.length > MAX_ROWS && (
            <Typography variant="body2" color="text.secondary">
              {t("warikan.moreRows", { n: rows.length - MAX_ROWS })}
            </Typography>
          )}
        </Stack>
        <Button
          size="small"
          sx={{ mt: 1 }}
          component={RouterLink}
          to={`/events/${eventId}/warikan`}
        >
          {t("warikan.openPage")}
        </Button>
      </CardContent>
    </Card>
  );
}
