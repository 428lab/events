import { useEffect, useRef } from "react";
import {
  Box,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import { useSearchParams } from "react-router-dom";
import { useEventSearchInfinite } from "../api/hooks.js";
import { EventCard } from "../components/EventCard.js";

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
    <Stack spacing={3}>
      <Typography variant="h5" fontWeight={700}>
        開催予定のイベント
      </Typography>
      {query.isLoading ? (
        <Typography>読み込み中…</Typography>
      ) : events.length === 0 ? (
        <Typography color="text.secondary">イベントはありません。</Typography>
      ) : (
        <Stack spacing={2}>
          {events.map((e) => (
            <EventCard key={e.id} event={e} />
          ))}
        </Stack>
      )}
      <Box ref={sentinel} sx={{ display: "flex", justifyContent: "center", py: 2 }}>
        {query.isFetchingNextPage && <CircularProgress size={28} />}
        {!query.hasNextPage && events.length > 0 && (
          <Typography variant="caption" color="text.secondary">
            これ以上ありません
          </Typography>
        )}
      </Box>
    </Stack>
  );
}
