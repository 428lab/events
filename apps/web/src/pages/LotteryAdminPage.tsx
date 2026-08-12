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
import { useTranslation } from "react-i18next";
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
import { i18next } from "../i18n/index.js";
import { formatDateTime } from "../lib/format.js";

/** 参加状態の見せ方。同じ confirmed でも、抽選枠なら「当選」、先着枠なら
 * 「参加確定」と読むほうが自然なので枠の方式で言い分ける (#286)。
 *
 * 表が持つのは**翻訳キーと色**だけ。文言そのものは辞書にある
 * （「キャンセル待ち」「落選」はイベント詳細と同じ文言なのでそちらを引く） */
type StatusLabelKey =
  | "staffOps.statusWon"
  | "staffOps.statusFirstComeConfirmed"
  | "staffOps.statusApplying"
  | "eventDetail.statusWaitlist"
  | "eventDetail.statusLost";

const STATUS_META: Record<
  string,
  {
    labelKey: StatusLabelKey;
    firstComeLabelKey?: StatusLabelKey;
    color: "success" | "warning" | "error" | "default";
  }
> = {
  confirmed: {
    labelKey: "staffOps.statusWon",
    firstComeLabelKey: "staffOps.statusFirstComeConfirmed",
    color: "success",
  },
  applied: { labelKey: "staffOps.statusApplying", color: "warning" },
  waitlist: { labelKey: "eventDetail.statusWaitlist", color: "default" },
  lost: { labelKey: "eventDetail.statusLost", color: "error" },
};

function statusLabel(status: string, slot: ParticipationSlot): string {
  const meta = STATUS_META[status];
  // 表に無い状態はサーバーの値をそのまま出す（増えても画面は壊れない）
  if (!meta) return status;
  return i18next.t(
    slot.selectionType === "first_come"
      ? (meta.firstComeLabelKey ?? meta.labelKey)
      : meta.labelKey,
  );
}

function memberName(m: EventMemberWithUser): string {
  return m.user.globalName ?? m.user.username;
}

export function LotteryAdminPage() {
  const { t } = useTranslation();
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
    return <Typography>{t("common.loading")}</Typography>;
  }
  const isStaff = eventData.myRole === "staff" || isAdmin;
  if (!isStaff) {
    return <Alert severity="info">{t("staffOps.slotAdminStaffOnly")}</Alert>;
  }

  /** 先着枠で定員を超える確定は拒否せず、超えることを伝えてから通す (#286)。
   * 当日キャンセルの繰り上げや、その場で1人増やす判断を画面側で塞がない */
  const confirmOverCapacity = (slot: ParticipationSlot, m: EventMemberWithUser): boolean =>
    m.status === "confirmed" ||
    slot.confirmedCount < slot.capacity ||
    window.confirm(
      t("staffOps.slotOverCapacityConfirm", {
        slot: slot.name,
        capacity: slot.capacity,
        confirmed: slot.confirmedCount,
        name: memberName(m),
      }),
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
            t("staffOps.slotStatusChangeFailed", { name: memberName(m) }),
          ),
      },
    );
  };

  return (
    <Stack spacing={3}>
      <EventBreadcrumbs
        eventId={id}
        eventTitle={eventData.event.title}
        current={t("staffOps.slotAdminTitle")}
      />
      <Typography variant="h5" fontWeight={700}>
        {t("staffOps.slotAdminTitle")}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t("staffOps.slotAdminIntro")}
      </Typography>

      {slots.length === 0 ? (
        <Typography color="text.secondary">{t("staffOps.slotNone")}</Typography>
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
          // 枠の要約。並べる項目は言語で増減しないので、区切りだけ辞書から取る
          const summaryParts: string[] = [
            t(
              firstCome
                ? "staffOps.slotConfirmedOfCapacity"
                : "staffOps.slotWonOfCapacity",
              { n: slot.confirmedCount, capacity: slot.capacity },
            ),
            t(
              applicants.length === 1
                ? "staffOps.slotApplicantCount"
                : "staffOps.slotApplicantsCount",
              { n: applicants.length },
            ),
          ];
          if (firstCome) {
            summaryParts.push(
              t("staffOps.slotWaitlistCount", { n: slot.waitlistCount }),
            );
          } else if (slot.drawAt) {
            summaryParts.push(
              t("staffOps.slotDrawAt", { date: formatDateTime(slot.drawAt) }),
            );
          }
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
                        label={t(
                          firstCome
                            ? "eventForm.slotTypeFirstCome"
                            : "eventForm.slotTypeLottery",
                        )}
                      />
                      {/* 超えたことが一覧で分かるようにする（繰り上げで超えられる） */}
                      {overCapacity && (
                        <Chip
                          size="small"
                          color="warning"
                          label={t("staffOps.slotOverCapacity")}
                        />
                      )}
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {summaryParts.join(t("common.dotSeparator"))}
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
                      {t("staffOps.slotDraw", {
                        applied: slot.appliedCount,
                        capacity: slot.capacity,
                      })}
                    </Button>
                  )}
                </Stack>
                <Divider sx={{ mb: 1 }} />

                {applicants.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    {t("staffOps.slotNoApplicants")}
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
                            {t(
                              firstCome
                                ? "staffOps.statusFirstComeConfirmed"
                                : "staffOps.statusWon",
                            )}
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
                            {t(
                              firstCome
                                ? "eventDetail.statusWaitlist"
                                : "eventDetail.statusLost",
                            )}
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
