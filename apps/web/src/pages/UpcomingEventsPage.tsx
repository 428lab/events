import { useEffect, useRef } from "react";
import {
  Alert,
  Box,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import { useSearchParams } from "react-router-dom";
import { useEventSearchInfinite } from "../api/hooks.js";
import { EventList, ListColumnsToggle } from "../components/EventList.js";
import { EventSearchPanel } from "../components/EventSearchPanel.js";
import { EggTabs } from "../components/EggTabs.js";

export function UpcomingEventsPage() {
  const [params] = useSearchParams();
  const afterStr = params.get("after");
  const after = afterStr ? Number(afterStr) : undefined;
  const query = useEventSearchInfinite({ after, sort: "soon" }, true);
  const events = query.data?.pages.flatMap((p) => p.events) ?? [];
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          query.hasNextPage &&
          !query.isFetchingNextPage
        ) {
          query.fetchNextPage();
        }
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [query.hasNextPage, query.isFetchingNextPage, query.fetchNextPage]);

  return (
    <Box>
      <EggTabs value="events" />
      <EventSearchPanel>
        <Stack spacing={3}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
          >
            <Typography variant="h5" fontWeight={700}>
              開催予定のイベント
            </Typography>
            <ListColumnsToggle />
          </Stack>
          {query.isError ? (
            <Alert severity="error">
              イベントを読み込めませんでした。時間をおいて再読み込みしてください。
            </Alert>
          ) : query.isLoading ? (
            <Typography>読み込み中…</Typography>
          ) : events.length === 0 ? (
            <Typography color="text.secondary">イベントはありません。</Typography>
          ) : (
            <EventList events={events} />
          )}
          <Box
            ref={sentinel}
            sx={{ display: "flex", justifyContent: "center", py: 2 }}
          >
            {query.isFetchingNextPage && <CircularProgress size={28} />}
            {!query.hasNextPage && events.length > 0 && (
              <Typography variant="caption" color="text.secondary">
                これ以上ありません
              </Typography>
            )}
          </Box>
        </Stack>
      </EventSearchPanel>
    </Box>
  );
}
