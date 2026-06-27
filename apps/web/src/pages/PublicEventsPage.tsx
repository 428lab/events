import { useState } from "react";
import { Box, Button, Pagination, Stack, Typography } from "@mui/material";
import {
  usePublicEvents,
  usePublicPastEventsInfinite,
  type PublicEventsPage as PublicEventsData,
} from "../api/hooks.js";
import { EventCard } from "../components/EventCard.js";
import { EventSearchPanel } from "../components/EventSearchPanel.js";

function EventSection({
  title,
  data,
  isLoading,
  page,
  onPage,
  emptyText,
}: {
  title: string;
  data: PublicEventsData | undefined;
  isLoading: boolean;
  page: number;
  onPage: (p: number) => void;
  emptyText: string;
}) {
  const limit = data?.limit ?? 12;
  const pageCount = data ? Math.max(1, Math.ceil(data.total / limit)) : 1;

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        {title}
      </Typography>
      {isLoading || !data ? (
        <Typography>読み込み中…</Typography>
      ) : data.events.length === 0 ? (
        <Typography color="text.secondary">{emptyText}</Typography>
      ) : (
        <>
          <Stack spacing={2}>
            {data.events.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </Stack>
          {pageCount > 1 && (
            <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
              <Pagination
                count={pageCount}
                page={page}
                onChange={(_e, p) => onPage(p)}
                color="primary"
              />
            </Box>
          )}
        </>
      )}
    </Box>
  );
}

export function PublicEventsPage() {
  const [page, setPage] = useState(1);
  const upcoming = usePublicEvents(page);
  const past = usePublicPastEventsInfinite();
  const pastEvents = past.data?.pages.flatMap((p) => p.events) ?? [];
  const pastTotal = past.data?.pages[0]?.total ?? 0;

  return (
    <EventSearchPanel>
      <Stack spacing={5}>
        <EventSection
          title="開催中・開催予定のイベント"
          data={upcoming.data}
          isLoading={upcoming.isLoading}
          page={page}
          onPage={setPage}
          emptyText="公開中のイベントはありません。"
        />
        {pastTotal > 0 && (
          <Box>
            <Typography variant="h5" fontWeight={700} gutterBottom>
              過去のイベント
            </Typography>
            <Stack spacing={2}>
              {pastEvents.map((e) => (
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
                    : `もっと見る（残り ${pastTotal - pastEvents.length} 件）`}
                </Button>
              </Box>
            )}
          </Box>
        )}
      </Stack>
    </EventSearchPanel>
  );
}
