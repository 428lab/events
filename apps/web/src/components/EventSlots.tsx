import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import type { ParticipationSlot, User } from "@eventer/shared";
import { formatDateTime } from "../lib/format.js";

/** 参加枠の一覧表示。未参加のログインユーザーには枠ごとの申込ボタンを出す。
 * 参加操作は親（EventDetailPage）が持つ。事前アンケート (#152) を挟むため。 */
export function EventSlots({
  slots,
  me,
  isMember,
  ended = false,
  closed = false,
  joinPending,
  onJoin,
}: {
  slots: ParticipationSlot[];
  me: User | null;
  isMember: boolean;
  /** 終了済みイベントでは申込ボタンを出さない */
  ended?: boolean;
  /** 募集締切を過ぎた (#269)。申込ボタンの代わりに締切済みの表示を出す */
  closed?: boolean;
  joinPending: boolean;
  onJoin: (slotId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Stack spacing={1.5}>
      <Typography variant="h6">{t("eventForm.slotsHeading")}</Typography>
      {slots.map((s) => {
        const full =
          s.selectionType === "first_come" && s.confirmedCount >= s.capacity;
        const label = t(
          s.selectionType === "lottery"
            ? "eventForm.slotJoinLottery"
            : full
              ? "eventForm.slotJoinWaitlist"
              : "eventForm.slotJoin",
        );
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
                    label={t(
                      s.selectionType === "lottery"
                        ? "eventForm.slotTypeLottery"
                        : "eventForm.slotTypeFirstCome",
                    )}
                    color={s.selectionType === "lottery" ? "secondary" : "default"}
                  />
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {t("eventForm.slotConfirmedCapacity", {
                    n: s.confirmedCount,
                    total: s.capacity,
                  })}
                  {s.selectionType === "lottery" && s.appliedCount > 0
                    ? t("common.dotSeparator") +
                      t("eventForm.slotAppliedCount", { n: s.appliedCount })
                    : ""}
                  {s.waitlistCount > 0
                    ? t("common.dotSeparator") +
                      t("eventForm.slotWaitlistCount", { n: s.waitlistCount })
                    : ""}
                </Typography>
                {s.selectionType === "lottery" && s.drawAt && (
                  <Typography variant="caption" color="text.secondary">
                    {t("eventForm.slotDrawAtLabel", {
                      date: formatDateTime(s.drawAt),
                    })}
                  </Typography>
                )}
              </Box>
              {me &&
                !isMember &&
                !ended &&
                (closed ? (
                  <Chip
                    size="small"
                    variant="outlined"
                    label={t("eventDetail.closedChip")}
                  />
                ) : (
                  <Button
                    variant="contained"
                    size="small"
                    disabled={joinPending}
                    onClick={() => onJoin(s.id)}
                  >
                    {label}
                  </Button>
                ))}
            </CardContent>
          </Card>
        );
      })}
    </Stack>
  );
}
