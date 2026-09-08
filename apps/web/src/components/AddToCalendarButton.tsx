import { Box, Button } from "@mui/material";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import { useTranslation } from "react-i18next";
import type { Event } from "@eventer/shared";
import { googleCalendarUrl } from "../lib/googleCalendar.js";

/**
 * Google カレンダーの予定作成画面を開くボタン (#487)。
 *
 * 出す・出さないは `googleCalendarUrl` が null を返すかどうかに一本化してある
 * （公開前・日程調整中・終了済みは出ない）。押しても何も起きない状態を作らない。
 * 呼び出し側には条件を書かない。
 *
 * 余白の Box もここで持つ。外で包むと、出ないときに空の div だけが残って
 * 8px の段差になる。
 */
export function AddToCalendarButton({ event }: { event: Event }) {
  const { t } = useTranslation();
  // 本文に載せるのは短いシェア URL。カレンダーから開き直す導線になる。
  // slug が無い行（旧データ）は通常の URL に落とす
  const eventUrl = event.slug
    ? `${window.location.origin}/e/${event.slug}`
    : `${window.location.origin}/events/${event.id}`;
  const href = googleCalendarUrl(event, eventUrl);
  if (!href) return null;

  return (
    <Box sx={{ mt: 1 }}>
      <Button
        component="a"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        size="small"
        variant="outlined"
        startIcon={<EventAvailableIcon />}
      >
        {t("eventDetail.addToGoogleCalendar")}
      </Button>
    </Box>
  );
}
