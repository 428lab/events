import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Snackbar,
  Stack,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { useParams } from "react-router-dom";
import type { EventMemberWithUser, ParticipationSlot } from "@eventer/shared";
import {
  useEvent,
  useEventMembers,
  useEventSlots,
  useIsAdmin,
  useDrawSlot,
  useSetMemberSlotStatus,
} from "../api/hooks.js";
import { EventBreadcrumbs } from "../components/EventBreadcrumbs.js";
import { UserLink } from "../components/UserLink.js";
import { formatDateTime } from "../lib/format.js";

/** 参加状態の見せ方。同じ confirmed でも、抽選枠なら「当選」、先着枠なら
 * 「参加確定」と読むほうが自然なので枠の方式で言い分ける (#286) */
const STATUS_META: Record<
  string,
  { label: string; firstComeLabel?: string; color: "success" | "warning" | "error" | "default" }
> = {
  confirmed: { label: "当選", firstComeLabel: "参加確定", color: "success" },
  applied: { label: "申込中", color: "warning" },
  waitlist: { label: "キャンセル待ち", color: "default" },
  lost: { label: "落選", color: "error" },
};

function statusLabel(status: string, slot: ParticipationSlot): string {
  const meta = STATUS_META[status];
  if (!meta) return status;
  return slot.selectionType === "first_come"
    ? (meta.firstComeLabel ?? meta.label)
    : meta.label;
}

function memberName(m: EventMemberWithUser): string {
  return m.user.globalName ?? m.user.username;
}

export function LotteryAdminPage() {
  const { id = "" } = useParams();
  const { data: eventData } = useEvent(id);
  const isAdmin = useIsAdmin();
  const { data: slots } = useEventSlots(id);
  const { data: members } = useEventMembers(id, true);
  const setStatus = useSetMemberSlotStatus(id);
  const draw = useDrawSlot(id);
  // 断られたときに黙って何も起きないように見せない（他のstaffが先に操作した等）
  const [error, setError] = useState("");

  if (!eventData || !slots || !members) {
    return <Typography>読み込み中…</Typography>;
  }
  const isStaff = eventData.myRole === "staff" || isAdmin;
  if (!isStaff) {
    return <Alert severity="info">申込者の管理はスタッフ専用です。</Alert>;
  }

  /** 先着枠で定員を超える確定は拒否せず、超えることを伝えてから通す (#286)。
   * 当日キャンセルの繰り上げや、その場で1人増やす判断を画面側で塞がない */
  const confirmOverCapacity = (slot: ParticipationSlot, m: EventMemberWithUser): boolean =>
    m.status === "confirmed" ||
    slot.confirmedCount < slot.capacity ||
    window.confirm(
      `${slot.name}は定員 ${slot.capacity} 人に対して既に ${slot.confirmedCount} 人が確定しています。${memberName(m)} さんを確定にすると定員を超えます。よろしいですか？`,
    );

  const changeStatus = (
    slot: ParticipationSlot,
    m: EventMemberWithUser,
    status: "confirmed" | "waitlist" | "lost",
  ) => {
    if (status === "confirmed" && !confirmOverCapacity(slot, m)) return;
    setStatus.mutate(
      { slotId: slot.id, userId: m.userId, status },
      {
        onError: () =>
          setError(
            `${memberName(m)} さんの参加状態を変更できませんでした。画面を開いたまま状態が変わった可能性があります`,
          ),
      },
    );
  };

  return (
    <Stack spacing={3}>
      <EventBreadcrumbs
        eventId={id}
        eventTitle={eventData.event.title}
        current="申込者の管理"
      />
      <Typography variant="h5" fontWeight={700}>
        申込者の管理
      </Typography>
      <Typography variant="body2" color="text.secondary">
        参加枠ごとの申込者です。参加確定・キャンセル待ち・落選をここで切り替えられます。
        当日キャンセルが出たときにキャンセル待ちの人を確定にするのもこの画面です。
      </Typography>

      {slots.length === 0 ? (
        <Typography color="text.secondary">参加枠がありません。</Typography>
      ) : (
        slots.map((slot) => {
          const firstCome = slot.selectionType === "first_come";
          const applicants = members
            .filter((m) => m.slotId === slot.id)
            .sort((a, b) => {
              const order = ["confirmed", "applied", "waitlist", "lost"];
              return order.indexOf(a.status) - order.indexOf(b.status);
            });
          const overCapacity = slot.confirmedCount > slot.capacity;
          return (
            <Card key={slot.id} variant="outlined">
              <CardContent>
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="center"
                  flexWrap="wrap"
                  useFlexGap
                  sx={{ mb: 1 }}
                >
                  <Box>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Typography variant="h6">{slot.name}</Typography>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={firstCome ? "先着順" : "抽選"}
                      />
                      {/* 超えたことが一覧で分かるようにする（繰り上げで超えられる） */}
                      {overCapacity && (
                        <Chip size="small" color="warning" label="定員超過" />
                      )}
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {firstCome ? "確定" : "当選"} {slot.confirmedCount} / 定員{" "}
                      {slot.capacity} ・ 申込 {applicants.length} 人
                      {firstCome
                        ? ` ・ キャンセル待ち ${slot.waitlistCount} 人`
                        : slot.drawAt
                          ? ` ・ 抽選日時 ${formatDateTime(slot.drawAt)}`
                          : ""}
                    </Typography>
                  </Box>
                  {/* 自動抽選は抽選枠だけの操作。先着枠には出さない */}
                  {!firstCome && (
                    <Button
                      variant="contained"
                      size="small"
                      disabled={draw.isPending || slot.appliedCount === 0}
                      onClick={() => draw.mutate(slot.id)}
                    >
                      自動抽選（申込中 {slot.appliedCount} → 定員 {slot.capacity}）
                    </Button>
                  )}
                </Stack>
                <Divider sx={{ mb: 1 }} />

                {applicants.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    まだ申込者がいません。
                  </Typography>
                ) : (
                  <Stack divider={<Divider flexItem />} spacing={1}>
                    {applicants.map((m) => {
                      const meta = STATUS_META[m.status] ?? { color: "default" as const };
                      return (
                        <Stack
                          key={m.id}
                          direction="row"
                          alignItems="center"
                          flexWrap="wrap"
                          useFlexGap
                          spacing={1.5}
                          sx={{ py: 0.5 }}
                        >
                          <UserLink
                            username={m.user.username}
                            name={memberName(m)}
                            avatarUrl={m.user.avatarUrl}
                            withAvatar
                            avatarSize={32}
                            sx={{ flex: 1 }}
                          />
                          <Chip
                            size="small"
                            label={statusLabel(m.status, slot)}
                            color={meta.color}
                          />
                          <Button
                            size="small"
                            variant={m.status === "confirmed" ? "contained" : "outlined"}
                            color="success"
                            disabled={setStatus.isPending}
                            onClick={() => changeStatus(slot, m, "confirmed")}
                          >
                            {firstCome ? "参加確定" : "当選"}
                          </Button>
                          {/* 先着枠に「落選」は無い。席を空けるのはキャンセル待ちに戻す操作 */}
                          <Button
                            size="small"
                            variant={
                              m.status === (firstCome ? "waitlist" : "lost")
                                ? "contained"
                                : "outlined"
                            }
                            color={firstCome ? "warning" : "error"}
                            disabled={setStatus.isPending}
                            onClick={() =>
                              changeStatus(slot, m, firstCome ? "waitlist" : "lost")
                            }
                          >
                            {firstCome ? "キャンセル待ち" : "落選"}
                          </Button>
                        </Stack>
                      );
                    })}
                  </Stack>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
      <Snackbar
        open={Boolean(error)}
        autoHideDuration={8000}
        onClose={() => setError("")}
        message={error}
      />
    </Stack>
  );
}
