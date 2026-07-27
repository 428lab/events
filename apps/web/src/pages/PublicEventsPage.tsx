import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Link,
  Pagination,
  Stack,
  Tooltip,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import RssFeedIcon from "@mui/icons-material/RssFeed";
import { Link as RouterLink } from "react-router-dom";
import {
  usePublicEvents,
  usePublicPastEventsInfinite,
  usePublicSchedulingEvents,
} from "../api/hooks.js";
import { EventCard } from "../components/EventCard.js";
import { EventSearchPanel } from "../components/EventSearchPanel.js";

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
      </Stack>
    </Box>
  );
}

function PastEvents() {
  const past = usePublicPastEventsInfinite();
  const events = past.data?.pages.flatMap((p) => p.events) ?? [];
  const total = past.data?.pages[0]?.total ?? 0;
  if (total === 0) return null;
  return (
    <Box>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        過去のイベント
      </Typography>
      <Stack spacing={2}>
        {events.map((e) => (
          <EventCard key={e.id} event={e} />
        ))}
      </Stack>
      {past.hasNextPage && (
        <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
          <Button
            variant="outlined"
            onClick={() => past.fetchNextPage()}
            disabled={past.isFetchingNextPage}
          >
            {past.isFetchingNextPage
              ? "読み込み中…"
              : `もっと見る（残り ${total - events.length} 件）`}
          </Button>
        </Box>
      )}
    </Box>
  );
}

function SchedulingEvents() {
  const [page, setPage] = useState(1);
  const q = usePublicSchedulingEvents(page);
  const total = q.data?.total ?? 0;
  const limit = q.data?.limit ?? 12;
  const pageCount = Math.max(1, Math.ceil(total / limit));
  if (q.isLoading || total === 0) return null;
  return (
    <Box>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        📅 日程調整中のイベント
      </Typography>
      <Stack spacing={2}>
        {(q.data?.events ?? []).map((e) => (
          <EventCard key={e.id} event={e} />
        ))}
      </Stack>
      {pageCount > 1 && (
        <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
          <Pagination
            count={pageCount}
            page={page}
            onChange={(_e, p) => setPage(p)}
            color="primary"
          />
        </Box>
      )}
    </Box>
  );
}

export function PublicEventsPage() {
  const theme = useTheme();
  const isPc = useMediaQuery(theme.breakpoints.up("sm"));
  const count = isPc ? 5 : 3;
  const upcoming = usePublicEvents(1, count);
  const events = upcoming.data?.events ?? [];
  const total = upcoming.data?.total ?? 0;
  const lastStartsAt = events.length
    ? events[events.length - 1].startsAt
    : undefined;

  return (
    <EventSearchPanel>
      <Stack spacing={5}>
        <SchedulingEvents />
        <Box>
          <Typography variant="h5" fontWeight={700} gutterBottom>
            開催中・開催予定のイベント
          </Typography>
          {upcoming.isError ? (
            <Alert severity="error">
              イベントを読み込めませんでした。時間をおいて再読み込みしてください。
            </Alert>
          ) : upcoming.isLoading ? (
            <Typography>読み込み中…</Typography>
          ) : events.length === 0 ? (
            <Typography color="text.secondary">
              開催予定のイベントはありません。
            </Typography>
          ) : (
            <>
              <Stack spacing={2}>
                {events.map((e) => (
                  <EventCard key={e.id} event={e} />
                ))}
              </Stack>
              {total > events.length && lastStartsAt != null && (
                <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
                  <Button
                    component={RouterLink}
                    to={`/events/upcoming?after=${lastStartsAt}`}
                    variant="outlined"
                  >
                    続きを見る（全 {total} 件）
                  </Button>
                </Box>
              )}
            </>
          )}
        </Box>

        {/* 過去イベントは開催中/未来のイベントが無いときだけ表示 */}
        {!upcoming.isLoading && total === 0 && <PastEvents />}

        <FeedLinks />
      </Stack>
    </EventSearchPanel>
  );
}
