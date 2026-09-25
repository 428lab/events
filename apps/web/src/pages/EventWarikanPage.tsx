import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Collapse,
  Link,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import AddIcon from "@mui/icons-material/Add";
import { Link as RouterLink, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Event, Settlement, WarikanExpense, WarikanLedger } from "@eventer/shared";
import { useEvent } from "../api/hooks.js";
import { useWarikan } from "../api/warikanHooks.js";
import { EventBreadcrumbs } from "../components/EventBreadcrumbs.js";
import { WarikanExpenseForm } from "../components/WarikanExpenseForm.js";
import { WarikanPayoutMethods } from "../components/WarikanPayoutMethods.js";
import {
  WarikanSettlementRow,
  mySettlements,
  useMemberName,
  useYen,
} from "../components/WarikanSettlementRow.js";
import { formatMonthDay } from "../lib/format.js";

/**
 * 割り勘のページ (#556 §3.9)。見られるのは確定メンバーと帳簿の当事者（門はサーバー）。
 *
 * 並び: 免責 → あなたの精算 → 立替の一覧 → 全員の収支 → 自分の受け取り先。
 * このアプリはお金を預からない。立替と負担から精算額を出すだけで、支払いは他のアプリで行う。
 */
export function EventWarikanPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const { data: eventData } = useEvent(id);
  const { data: ledger, isError, isLoading } = useWarikan(id, Boolean(eventData));

  return (
    <Stack spacing={2}>
      {eventData && (
        <EventBreadcrumbs eventId={id} eventTitle={eventData.event.title} current={t("warikan.title")} />
      )}
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="h5" fontWeight={700} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <ReceiptLongIcon />
          {t("warikan.title")}
        </Typography>
        <Button size="small" startIcon={<ArrowBackIcon />} component={RouterLink} to={`/events/${id}`}>
          {t("staffOps.backToEventLink")}
        </Button>
      </Stack>

      <Disclaimer />

      {isError && <Alert severity="info">{t("eventSocial.screenMembersOnly")}</Alert>}
      {isLoading && <Typography>{t("common.loading")}</Typography>}
      {ledger && eventData && (
        <LedgerView eventId={id} ledger={ledger} event={eventData.event} />
      )}
    </Stack>
  );
}

/** 免責バナー（常に表示・閉じられない。1行に畳み、「詳しく」で §3.1 の要約を開く） */
function Disclaimer() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Alert severity="info">
      {t("warikan.disclaimer")}{" "}
      <Link component="button" variant="body2" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {t("warikan.disclaimerMore")}
      </Link>
      <Collapse in={open}>
        <Typography variant="body2" sx={{ mt: 1 }}>
          {t("warikan.disclaimerDetail")}
        </Typography>
      </Collapse>
    </Alert>
  );
}

function LedgerView({
  eventId,
  ledger,
  event,
}: {
  eventId: string;
  ledger: WarikanLedger;
  event: Event;
}) {
  const { t } = useTranslation();
  const yen = useYen();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WarikanExpense | null>(null);
  const rows = mySettlements(ledger);
  const me = ledger.me.userId;
  // 自分が支払う行 → 受け取る行の2グループ（自分が動く行を先に）
  const groups: {
    key: string;
    label: "warikan.groupPay" | "warikan.groupReceive";
    rows: Settlement[];
  }[] = [
    { key: "pay", label: "warikan.groupPay", rows: rows.filter((s) => s.fromUserId === me) },
    { key: "receive", label: "warikan.groupReceive", rows: rows.filter((s) => s.toUserId === me) },
  ];
  // 帳簿に自分が登場していて、いまの行が無い＝全部済んだ（登場していなければ関係なし）
  const hadDealings = ledger.balances.some((b) => b.userId === me);

  return (
    <>
      {/* あなたの精算 */}
      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" fontWeight={700}>
            {t("warikan.mySettlements")}
          </Typography>
          {rows.length === 0 ? (
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              {hadDealings ? t("warikan.allSettled") : t("warikan.noSettlements")}
            </Typography>
          ) : (
            groups
              .filter((g) => g.rows.length > 0)
              .map((g) => (
                <Box key={g.key} sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" fontWeight={700} color="text.secondary">
                    {t(g.label, {
                      n: g.rows.length,
                      amount: yen(g.rows.reduce((sum, s) => sum + s.amount, 0)),
                    })}
                  </Typography>
                  {g.rows.map((s) => (
                    <WarikanSettlementRow
                      key={`${s.fromUserId}:${s.toUserId}`}
                      ledger={ledger}
                      settlement={s}
                    />
                  ))}
                </Box>
              ))
          )}
        </CardContent>
      </Card>

      <ExpenseList
        ledger={ledger}
        onAdd={() => {
          setEditing(null);
          setFormOpen(true);
        }}
        onEdit={(e) => {
          setEditing(e);
          setFormOpen(true);
        }}
      />

      <BalanceTable ledger={ledger} />

      <WarikanPayoutMethods eventId={eventId} ledger={ledger} />

      {formOpen && (
        <WarikanExpenseForm
          key={editing?.id ?? "new"}
          eventId={eventId}
          event={event}
          ledger={ledger}
          expense={editing}
          open={formOpen}
          onClose={() => setFormOpen(false)}
        />
      )}
    </>
  );
}

/** 立替の一覧。行を開くと負担者と配分額 */
function ExpenseList({
  ledger,
  onAdd,
  onEdit,
}: {
  ledger: WarikanLedger;
  onAdd: () => void;
  onEdit: (e: WarikanExpense) => void;
}) {
  const { t } = useTranslation();
  const yen = useYen();
  const nameOf = useMemberName(ledger);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="h6" fontWeight={700}>
            {t("warikan.expenses")}
          </Typography>
          {/* observer には追加ボタンを出さない */}
          {ledger.me.canAddExpense && (
            <Button
              size="medium"
              variant="contained"
              sx={{ minHeight: 44 }}
              startIcon={<AddIcon />}
              onClick={onAdd}
            >
              {t("warikan.addExpense")}
            </Button>
          )}
        </Stack>
        {ledger.expenses.length === 0 && (
          <Typography color="text.secondary">{t("warikan.noExpenses")}</Typography>
        )}
        {ledger.expenses.map((e) => {
          const payerShare = e.shares.find((s) => s.userId === e.payerUserId);
          return (
            <Box key={e.id} sx={{ py: 1, borderBottom: 1, borderColor: "divider" }}>
              <Box
                role="button"
                tabIndex={0}
                onClick={() => setOpen(open === e.id ? null : e.id)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") setOpen(open === e.id ? null : e.id);
                }}
                aria-expanded={open === e.id}
                sx={{ cursor: "pointer" }}
              >
                <Stack direction="row" justifyContent="space-between" spacing={1}>
                  <Typography fontWeight={700}>{e.title}</Typography>
                  <Typography fontWeight={700}>{yen(e.amount)}</Typography>
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {[
                    t("warikan.paidBy", { name: nameOf(e.payerUserId) }),
                    t(e.shares.length === 1 ? "warikan.shareCountOne" : "warikan.shareCount", {
                      n: e.shares.length,
                    }),
                    e.spentOn && formatSpentOn(e.spentOn),
                    t("warikan.enteredBy", { name: nameOf(e.createdBy) }),
                  ]
                    .filter(Boolean)
                    .join(t("common.dotSeparator"))}
                </Typography>
              </Box>
              <Collapse in={open === e.id}>
                <Stack spacing={0.25} sx={{ pl: 1, pt: 1 }}>
                  {e.shares.map((s) => (
                    <Stack key={s.userId} direction="row" justifyContent="space-between" spacing={2}>
                      <Typography variant="body2">
                        {nameOf(s.userId)}
                        {s.weight !== 1 && ` ×${s.weight}`}
                      </Typography>
                      <Typography variant="body2">
                        {yen(s.amount)}
                        {s.userId === e.payerUserId && e.remainder > 0 && payerShare && (
                          <Typography component="span" variant="caption" color="text.secondary">
                            {" "}
                            {t("warikan.includesRemainder", { amount: yen(e.remainder) })}
                          </Typography>
                        )}
                      </Typography>
                    </Stack>
                  ))}
                  {e.absorbedByPayer > 0 && (
                    <Typography variant="caption" color="text.secondary">
                      {t("warikan.payerAbsorbs", { amount: yen(e.absorbedByPayer) })}
                    </Typography>
                  )}
                  {e.note && (
                    <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "pre-wrap" }}>
                      {e.note}
                    </Typography>
                  )}
                  {e.canEdit && (
                    <Box>
                      <Button size="small" onClick={() => onEdit(e)}>
                        {t("common.edit")}
                      </Button>
                    </Box>
                  )}
                </Stack>
              </Collapse>
            </Box>
          );
        })}
      </CardContent>
    </Card>
  );
}

/** 立替の日付（'YYYY-MM-DD'）を他の画面と同じ月日の表記に。端末のローカル日付として読む */
function formatSpentOn(spentOn: string): string {
  const [y, m, d] = spentOn.split("-").map(Number);
  return formatMonthDay(new Date(y, m - 1, d).getTime());
}

/** 全員の収支（立て替えた − 負担 ＝ 差引）。差引の正負は語で表す */
const stickyName = { position: "sticky", left: 0, zIndex: 1, bgcolor: "background.paper" } as const;

function BalanceTable({ ledger }: { ledger: WarikanLedger }) {
  const { t } = useTranslation();
  const yen = useYen();
  const nameOf = useMemberName(ledger);
  if (ledger.balances.length === 0) return null;
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" fontWeight={700}>
          {t("warikan.balances")}
        </Typography>
        {/* 4列なので 375px 幅でも収まる。それより狭い端末だけ横スクロールになるので、
            セルは折り返さず名前列を左に固定しておく（支払記録の撤去で列が減った） */}
        <TableContainer>
          <Table size="small" sx={{ "& .MuiTableCell-root": { whiteSpace: "nowrap" } }}>
            <TableHead>
              <TableRow>
                <TableCell sx={stickyName}>{t("warikan.colName")}</TableCell>
                <TableCell align="right">{t("warikan.colPaid")}</TableCell>
                <TableCell align="right">{t("warikan.colOwed")}</TableCell>
                <TableCell align="right">{t("warikan.colNet")}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {ledger.balances.map((b) => (
                <TableRow key={b.userId}>
                  <TableCell sx={stickyName}>{nameOf(b.userId)}</TableCell>
                  <TableCell align="right">{yen(b.paid)}</TableCell>
                  <TableCell align="right">{yen(b.owed)}</TableCell>
                  <TableCell align="right">
                    {b.net > 0
                      ? t("warikan.netReceive", { amount: yen(b.net) })
                      : b.net < 0
                        ? t("warikan.netPay", { amount: yen(-b.net) })
                        : t("warikan.netZero")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  );
}
