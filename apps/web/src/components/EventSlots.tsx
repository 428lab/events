import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  Typography,
} from "@mui/material";
import type { ParticipationSlot, User } from "@eventer/shared";
import { useJoinEvent } from "../api/hooks.js";
import { formatDateTime } from "../lib/format.js";

/** 参加枠の一覧表示。未参加のログインユーザーには枠ごとの申込ボタンを出す。 */
export function EventSlots({
  eventId,
  slots,
  me,
  isMember,
  ended = false,
}: {
  eventId: string;
  slots: ParticipationSlot[];
  me: User | null;
  isMember: boolean;
  /** 終了済みイベントでは申込ボタンを出さない */
  ended?: boolean;
}) {
  const join = useJoinEvent();

  return (
    <Stack spacing={1.5}>
      <Typography variant="h6">参加枠</Typography>
      {slots.map((s) => {
        const full =
          s.selectionType === "first_come" && s.confirmedCount >= s.capacity;
        const label =
          s.selectionType === "lottery"
            ? "抽選に申し込む"
            : full
              ? "キャンセル待ちで申込"
              : "参加する";
        return (
          <Card key={s.id} variant="outlined">
            <CardContent
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 2,
              }}
            >
              <Box>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography fontWeight={600}>{s.name}</Typography>
                  <Chip
                    size="small"
                    label={s.selectionType === "lottery" ? "抽選" : "先着順"}
                    color={s.selectionType === "lottery" ? "secondary" : "default"}
                  />
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  確定 {s.confirmedCount} / 定員 {s.capacity}
                  {s.selectionType === "lottery" && s.appliedCount > 0
                    ? ` ・ 抽選申込 ${s.appliedCount}`
                    : ""}
                  {s.waitlistCount > 0 ? ` ・ キャンセル待ち ${s.waitlistCount}` : ""}
                </Typography>
                {s.selectionType === "lottery" && s.drawAt && (
                  <Typography variant="caption" color="text.secondary">
                    抽選日時: {formatDateTime(s.drawAt)}
                  </Typography>
                )}
              </Box>
              {me && !isMember && !ended && (
                <Button
                  variant="contained"
                  size="small"
                  disabled={join.isPending}
                  onClick={() => join.mutate({ id: eventId, slotId: s.id })}
                >
                  {label}
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}
    </Stack>
  );
}
