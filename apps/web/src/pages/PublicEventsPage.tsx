import { useState } from "react";
import { Box, Pagination, Stack, Typography } from "@mui/material";
import {
  usePublicEvents,
  usePublicPastEvents,
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
  const [pastPage, setPastPage] = useState(1);
  const upcoming = usePublicEvents(page);
  const past = usePublicPastEvents(pastPage);

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
        {(past.data?.total ?? 0) > 0 && (
          <EventSection
            title="過去のイベント"
            data={past.data}
            isLoading={past.isLoading}
            page={pastPage}
            onPage={setPastPage}
            emptyText="過去のイベントはありません。"
          />
        )}
      </Stack>
    </EventSearchPanel>
  );
}
