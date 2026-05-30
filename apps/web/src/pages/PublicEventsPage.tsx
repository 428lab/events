import { useState } from "react";
import { Box, Pagination, Stack, Typography } from "@mui/material";
import { usePublicEvents } from "../api/hooks.js";
import { EventCard } from "../components/EventCard.js";

export function PublicEventsPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = usePublicEvents(page);
  const limit = data?.limit ?? 12;
  const pageCount = data ? Math.max(1, Math.ceil(data.total / limit)) : 1;

  return (
    <Stack spacing={3}>
      <Typography variant="h5" fontWeight={700}>
        開催中・開催予定のイベント
      </Typography>

      {isLoading || !data ? (
        <Typography>読み込み中…</Typography>
      ) : data.events.length === 0 ? (
        <Typography color="text.secondary">
          公開中のイベントはありません。
        </Typography>
      ) : (
        <>
          <Stack spacing={2}>
            {data.events.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </Stack>
          {pageCount > 1 && (
            <Box sx={{ display: "flex", justifyContent: "center" }}>
              <Pagination
                count={pageCount}
                page={page}
                onChange={(_e, p) => setPage(p)}
                color="primary"
              />
            </Box>
          )}
        </>
      )}
    </Stack>
  );
}
