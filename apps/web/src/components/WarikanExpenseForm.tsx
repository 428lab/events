import { useMemo, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import { useTranslation } from "react-i18next";
import type { Event, WarikanExpense, WarikanLedger, WarikanMember } from "@eventer/shared";
import { WARIKAN_WEIGHT_MAX, expenseInput, presetShareUserIds } from "@eventer/shared";
import { useCreateExpense, useDeleteExpense, useUpdateExpense } from "../api/warikanHooks.js";
import { errorMessage } from "../lib/errorMessage.js";
import { useMemberName, useWarikanErrors, useYen } from "./WarikanSettlementRow.js";

/** 「内容」のチップ。押すとタイトルに入る（自由入力も可） */
const TITLE_CHIPS = ["chipVenue", "chipParty", "chipSupplies", "chipTransport"] as const;

/** イベント開始日の JST の日付（'YYYY-MM-DD'）。日程未定なら null */
function eventStartDate(event: Event): string | null {
  if (event.scheduling || !event.startsAt) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(event.startsAt);
}

/**
 * 立替の追加・編集フォーム (#556 §3.9)。スマホでは全画面。
 *
 * プリセット（全員／出席した人）は**初期チェックを決めるだけ**で、その後は個別に外せる。
 * 新規は「全員」をチェックした状態で開く。
 * 編集で開いたときはプリセットを選んだ状態にしない（保存されているのは負担者の明示リスト）。
 * 既存の負担者・立替者は、取消した人や退会済みユーザーでもそのまま残せる（§3.7.3）。
 */
export function WarikanExpenseForm({
  eventId,
  event,
  ledger,
  expense,
  open,
  onClose,
}: {
  eventId: string;
  event: Event;
  ledger: WarikanLedger;
  /** 編集する立替。無ければ新規 */
  expense?: WarikanExpense | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const yen = useYen();
  const nameOf = useMemberName(ledger);
  const overrides = useWarikanErrors();
  const create = useCreateExpense(eventId);
  const update = useUpdateExpense(eventId);
  const remove = useDeleteExpense(eventId);
  const me = ledger.me.userId;

  const initial = () => ({
    amount: expense ? String(expense.amount) : "",
    title: expense?.title ?? "",
    payer: expense?.payerUserId ?? me,
    note: expense?.note ?? "",
    spentOn: expense ? (expense.spentOn ?? "") : (eventStartDate(event) ?? ""),
    // 新規は「全員」にチェックした状態で開く（最頻のケース。後から個別に外せる）
    weights: new Map<string, number>(
      expense
        ? expense.shares.map((s) => [s.userId, s.weight])
        : presetShareUserIds(ledger.members, "all").map((id) => [id, 1]),
    ),
  });
  const [form, setForm] = useState(initial);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // 選べる人: 新しく指定できる人（selectable）＋ 編集中の立替に既にいる人
  const existing = useMemo(
    () => new Set(expense ? [expense.payerUserId, ...expense.shares.map((s) => s.userId)] : []),
    [expense],
  );
  const candidates = ledger.members.filter((m) => m.selectable || existing.has(m.userId));

  // 払った人の並び: 自分 → この帳簿で立替を入れたことがある人 → その他
  const payerOptions = useMemo(() => {
    const payers = new Set(ledger.expenses.map((e) => e.payerUserId));
    const rank = (m: WarikanMember) => (m.userId === me ? 0 : payers.has(m.userId) ? 1 : 2);
    return [...candidates].sort((a, b) => rank(a) - rank(b));
  }, [candidates, ledger.expenses, me]);

  const checked = [...form.weights.keys()];
  const amount = Number(form.amount);
  const perPerson = checked.length > 0 && amount > 0 ? Math.round(amount / checked.length) : 0;

  const setWeights = (weights: Map<string, number>) => setForm((f) => ({ ...f, weights }));
  const applyPreset = (preset: "all" | "attended") => {
    setWeights(new Map(presetShareUserIds(ledger.members, preset).map((id) => [id, 1])));
  };
  const toggle = (userId: string) => {
    const next = new Map(form.weights);
    if (next.has(userId)) next.delete(userId);
    else next.set(userId, 1);
    setWeights(next);
  };
  const setWeight = (userId: string, raw: string) => {
    const n = Number(raw.replace(/[^0-9]/g, ""));
    const next = new Map(form.weights);
    next.set(userId, Math.max(1, Math.min(WARIKAN_WEIGHT_MAX, n || 1)));
    setWeights(next);
  };

  const submit = () => {
    const parsed = expenseInput.safeParse({
      payerUserId: form.payer,
      amount,
      title: form.title,
      note: form.note,
      spentOn: form.spentOn || null,
      shares: checked.map((userId) => ({ userId, weight: form.weights.get(userId) ?? 1 })),
    });
    if (!parsed.success) {
      setError(checked.length === 0 ? t("warikan.noSelectable") : t("warikan.errorInvalidInput"));
      return;
    }
    setError(null);
    const onError = (e: unknown) => setError(errorMessage(e, overrides));
    if (expense) {
      update.mutate({ id: expense.id, input: parsed.data }, { onSuccess: onClose, onError });
    } else {
      create.mutate(parsed.data, { onSuccess: () => setSaved(true), onError });
    }
  };

  const again = () => {
    setForm(initial());
    setSaved(false);
    setError(null);
  };

  const busy = create.isPending || update.isPending || remove.isPending;

  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen} fullWidth maxWidth="sm">
      <DialogTitle>{expense ? t("warikan.formEdit") : t("warikan.formNew")}</DialogTitle>
      <DialogContent>
        {saved ? (
          <Alert severity="success">{t("warikan.saved")}</Alert>
        ) : (
          <Stack spacing={2} sx={{ pt: 1 }}>
            {/* 1. 金額（開いたらここにカーソル） */}
            <TextField
              autoFocus
              label={t("warikan.amount")}
              value={form.amount}
              onChange={(e) =>
                setForm((f) => ({ ...f, amount: e.target.value.replace(/[^0-9]/g, "") }))
              }
              inputProps={{ inputMode: "numeric", pattern: "[0-9]*" }}
            />

            {/* 2. 内容 */}
            <Box>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                {TITLE_CHIPS.map((key) => (
                  <Chip
                    key={key}
                    label={t(`warikan.${key}`)}
                    onClick={() => setForm((f) => ({ ...f, title: t(`warikan.${key}`) }))}
                    variant={form.title === t(`warikan.${key}`) ? "filled" : "outlined"}
                  />
                ))}
              </Stack>
              <TextField
                fullWidth
                label={t("warikan.content")}
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                inputProps={{ maxLength: 100 }}
              />
            </Box>

            {/* 3. 払った人 */}
            <Autocomplete
              options={payerOptions}
              value={payerOptions.find((m) => m.userId === form.payer)}
              onChange={(_, m) => m && setForm((f) => ({ ...f, payer: m.userId }))}
              getOptionLabel={(m) =>
                m.userId === me
                  ? `${t("warikan.me")}${t("common.parenName", { name: nameOf(m.userId) })}`
                  : nameOf(m.userId)
              }
              isOptionEqualToValue={(a, b) => a.userId === b.userId}
              disableClearable
              renderInput={(params) => (
                <TextField
                  {...params}
                  label={t("warikan.payer")}
                  placeholder={t("warikan.payerSearch")}
                />
              )}
            />

            {/* 4. 割る人 */}
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                {t("warikan.splitWith")}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                <Button size="small" variant="outlined" onClick={() => applyPreset("all")}>
                  {t("warikan.presetAll")}
                </Button>
                {event.attendanceCheck && (
                  <Button size="small" variant="outlined" onClick={() => applyPreset("attended")}>
                    {t("warikan.presetAttended")}
                  </Button>
                )}
              </Stack>
              <Stack>
                {candidates.map((m) => (
                  <FormControlLabel
                    key={m.userId}
                    control={
                      <Checkbox
                        checked={form.weights.has(m.userId)}
                        onChange={() => toggle(m.userId)}
                      />
                    }
                    label={nameOf(m.userId)}
                  />
                ))}
              </Stack>
              {/* 金額が未入力のうちは「約 0円」を出さない */}
              {amount > 0 && (
                <Typography variant="body2" color="text.secondary">
                  {t(checked.length === 1 ? "warikan.perPersonOne" : "warikan.perPerson", {
                    n: checked.length,
                    amount: yen(perPerson),
                  })}
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary">
                {t("warikan.remainderRule")}
              </Typography>
            </Box>

            {/* 5. 詳細（畳む） */}
            <Box>
              <Button
                size="small"
                endIcon={detailsOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                onClick={() => setDetailsOpen((v) => !v)}
                aria-expanded={detailsOpen}
              >
                {t("warikan.details")}
              </Button>
              <Collapse in={detailsOpen}>
                <Stack spacing={2} sx={{ pt: 1 }}>
                  <TextField
                    type="date"
                    label={t("warikan.spentOn")}
                    value={form.spentOn}
                    onChange={(e) => setForm((f) => ({ ...f, spentOn: e.target.value }))}
                    InputLabelProps={{ shrink: true }}
                  />
                  <TextField
                    label={t("warikan.note")}
                    value={form.note}
                    onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                    placeholder={t("warikan.notePlaceholder")}
                    helperText={t("warikan.noteHelp")}
                    multiline
                    inputProps={{ maxLength: 500 }}
                  />
                  <Box>
                    <Typography variant="subtitle2">{t("warikan.weight")}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                      {t("warikan.weightHelp")}
                    </Typography>
                    <Stack spacing={1}>
                      {checked.map((userId) => (
                        <Stack key={userId} direction="row" spacing={1} alignItems="center">
                          <Typography variant="body2" sx={{ flex: 1 }}>
                            {nameOf(userId)}
                          </Typography>
                          <TextField
                            size="small"
                            value={String(form.weights.get(userId) ?? 1)}
                            onChange={(e) => setWeight(userId, e.target.value)}
                            inputProps={{
                              inputMode: "numeric",
                              pattern: "[0-9]*",
                              "aria-label": `${t("warikan.weight")} ${nameOf(userId)}`,
                            }}
                            sx={{ width: 80 }}
                          />
                        </Stack>
                      ))}
                    </Stack>
                  </Box>
                </Stack>
              </Collapse>
            </Box>
          </Stack>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        {saved ? (
          <>
            <Button onClick={again}>{t("warikan.addAnother")}</Button>
            <Button variant="contained" onClick={onClose}>
              {t("common.close")}
            </Button>
          </>
        ) : (
          <>
            {expense?.canEdit && (
              <Button
                color="error"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(t("warikan.deleteExpenseConfirm"))) return;
                  remove.mutate(expense.id, {
                    onSuccess: onClose,
                    onError: (e) => setError(errorMessage(e, overrides)),
                  });
                }}
                sx={{ mr: "auto" }}
              >
                {t("common.delete")}
              </Button>
            )}
            <Button onClick={onClose}>{t("common.cancel")}</Button>
            <Button variant="contained" onClick={submit} disabled={busy}>
              {t("common.save")}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
