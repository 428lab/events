import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import { useParams } from "react-router-dom";
import type { EventMemberWithUser } from "@eventer/shared";
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

const STATUS_META: Record<
  string,
  { label: string; color: "success" | "warning" | "error" | "default" }
> = {
  confirmed: { label: "当選", color: "success" },
  applied: { label: "申込中", color: "warning" },
  waitlist: { label: "キャンセル待ち", color: "default" },
  lost: { label: "落選", color: "error" },
};

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

  if (!eventData || !slots || !members) {
    return <Typography>読み込み中…</Typography>;
  }
  const isStaff = eventData.myRole === "staff" || isAdmin;
  if (!isStaff) {
    return <Alert severity="info">当選操作はスタッフ専用です。</Alert>;
  }

  const lotterySlots = slots.filter((s) => s.selectionType === "lottery");

  return (
    <Stack spacing={3}>
      <EventBreadcrumbs
        eventId={id}
        eventTitle={eventData.event.title}
        current="当選操作"
      />
      <Typography variant="h5" fontWeight={700}>
        当選操作・抽選結果
      </Typography>

      {lotterySlots.length === 0 ? (
        <Typography color="text.secondary">抽選方式の参加枠がありません。</Typography>
      ) : (
        lotterySlots.map((slot) => {
          const applicants = members
            .filter((m) => m.slotId === slot.id)
            .sort((a, b) => {
              const order = ["confirmed", "applied", "waitlist", "lost"];
              return order.indexOf(a.status) - order.indexOf(b.status);
            });
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
                    <Typography variant="h6">{slot.name}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      当選 {slot.confirmedCount} / 定員 {slot.capacity} ・ 申込{" "}
                      {applicants.length} 人
                      {slot.drawAt ? ` ・ 抽選日時 ${formatDateTime(slot.drawAt)}` : ""}
                    </Typography>
                  </Box>
                  <Button
                    variant="contained"
                    size="small"
                    disabled={draw.isPending || slot.appliedCount === 0}
                    onClick={() => draw.mutate(slot.id)}
                  >
                    自動抽選（申込中 {slot.appliedCount} → 定員 {slot.capacity}）
                  </Button>
                </Stack>
                <Divider sx={{ mb: 1 }} />

                {applicants.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    まだ申込者がいません。
                  </Typography>
                ) : (
                  <Stack divider={<Divider flexItem />} spacing={1}>
                    {applicants.map((m) => {
                      const meta = STATUS_META[m.status] ?? {
                        label: m.status,
                        color: "default" as const,
                      };
                      return (
                        <Stack
                          key={m.id}
                          direction="row"
                          alignItems="center"
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
                          <Chip size="small" label={meta.label} color={meta.color} />
                          <Button
                            size="small"
                            variant={m.status === "confirmed" ? "contained" : "outlined"}
                            color="success"
                            disabled={setStatus.isPending}
                            onClick={() =>
                              setStatus.mutate({
                                slotId: slot.id,
                                userId: m.userId,
                                status: "confirmed",
                              })
                            }
                          >
                            当選
                          </Button>
                          <Button
                            size="small"
                            variant={m.status === "lost" ? "contained" : "outlined"}
                            color="error"
                            disabled={setStatus.isPending}
                            onClick={() =>
                              setStatus.mutate({
                                slotId: slot.id,
                                userId: m.userId,
                                status: "lost",
                              })
                            }
                          >
                            落選
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
    </Stack>
  );
}
