import { IconButton, Tooltip } from "@mui/material";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import { useTranslation } from "react-i18next";
import type { Event } from "@eventer/shared";
import { googleCalendarUrl } from "../lib/googleCalendar.js";

/**
 * Google カレンダーの予定作成画面を開くボタン (#487)。
 *
 * 日程が未確定（`scheduling`）のイベントでは `googleCalendarUrl` が null を返し、
 * このボタン自体が出ない。押しても何も起きない状態を作らないため、
 * 出す・出さないの判断は URL を作れるかどうかに一本化してある。
 *
 * 置き場所は日時表示のとなり（`EventDetailPage`）。日時を見た流れで押せる位置。
 */
export function AddToCalendarButton({ event }: { event: Event }) {
  const { t } = useTranslation();
  // 本文に載せるのは短いシェアURL。カレンダーから開き直す導線になる
  const eventUrl = `${window.location.origin}/e/${event.slug}`;
  const href = googleCalendarUrl(event, eventUrl);
  if (!href) return null;

  return (
    <Tooltip title={t("eventDetail.addToGoogleCalendar")}>
      <IconButton
        component="a"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t("eventDetail.addToGoogleCalendar")}
        size="small"
      >
        <EventAvailableIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}
