import { Box, Link, Stack, Tooltip, Typography } from "@mui/material";
import RssFeedIcon from "@mui/icons-material/RssFeed";
import { EventsBrowser } from "../components/EventsBrowser.js";
import { EggTabs } from "../components/EggTabs.js";

/** イベント一覧のフィード購読導線（RSS / JSON Feed / iCalendar）。
 * /feed/* は SPA ルートではなくワーカーが直接返すので通常の <a>（Link href）で開く。 */
function FeedLinks() {
  return (
    <Box sx={{ pt: 3, borderTop: 1, borderColor: "divider" }}>
      <Stack
        direction="row"
        spacing={1.5}
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
      >
        <RssFeedIcon fontSize="small" sx={{ color: "text.secondary" }} />
        <Typography variant="body2" color="text.secondary">
          イベント一覧をフィードで購読:
        </Typography>
        <Link href="/feed/events.rss" target="_blank" rel="noopener" variant="body2">
          RSS
        </Link>
        <Link href="/feed/events.json" target="_blank" rel="noopener" variant="body2">
          JSON Feed
        </Link>
        <Tooltip title="カレンダーアプリで購読できます">
          <Link href="/feed/events.ics" target="_blank" rel="noopener" variant="body2">
            カレンダー(.ics)
          </Link>
        </Tooltip>
        <Tooltip title="AIエージェント向けにフィードとクエリ仕様をまとめた llms.txt">
          <Link href="/llms.txt" target="_blank" rel="noopener" variant="body2">
            AI向け(llms.txt)
          </Link>
        </Tooltip>
      </Stack>
    </Box>
  );
}

export function PublicEventsPage() {
  return (
    <Box>
      <EggTabs value="events" />
      <Stack spacing={4}>
        {/* 開催予定/過去タブ・絞り込み・10件ページング（日程調整中は開催予定に含まれる） */}
        <EventsBrowser />
        <FeedLinks />
      </Stack>
    </Box>
  );
}
