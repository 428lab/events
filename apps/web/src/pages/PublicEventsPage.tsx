import { Box, Button, Stack, Typography, useMediaQuery } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Link as RouterLink } from "react-router-dom";
import {
  usePublicEvents,
  usePublicPastEventsInfinite,
} from "../api/hooks.js";
import { EventCard } from "../components/EventCard.js";
import { EventSearchPanel } from "../components/EventSearchPanel.js";

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
        <Box>
          <Typography variant="h5" fontWeight={700} gutterBottom>
            開催中・開催予定のイベント
          </Typography>
          {upcoming.isLoading ? (
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
      </Stack>
    </EventSearchPanel>
  );
}
