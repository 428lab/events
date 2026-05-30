import { useState } from "react";
import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  Pagination,
  Stack,
  Typography,
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { eventImageUrl, usePublicEvents } from "../api/hooks.js";
import { formatDateRange, venueLabel } from "../lib/format.js";

export function PublicEventsPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = usePublicEvents(page);
  const limit = data?.limit ?? 12;
  const pageCount = data ? Math.max(1, Math.ceil(data.total / limit)) : 1;

  return (
    <Stack spacing={3}>
      <Typography variant="h5" fontWeight={700}>
        開催前のイベント
      </Typography>

      {isLoading || !data ? (
        <Typography>読み込み中…</Typography>
      ) : data.events.length === 0 ? (
        <Typography color="text.secondary">
          開催前の公開イベントはありません。
        </Typography>
      ) : (
        <>
          <Stack spacing={2}>
            {data.events.map((e) => (
              <Card key={e.id} variant="outlined">
                <CardActionArea component={RouterLink} to={`/events/${e.id}`}>
                  {eventImageUrl(e) && (
                    <Box
                      component="img"
                      src={eventImageUrl(e)!}
                      alt={e.title}
                      sx={{
                        width: "100%",
                        aspectRatio: "1200 / 630",
                        objectFit: "cover",
                        display: "block",
                      }}
                    />
                  )}
                  <CardContent>
                    <Typography variant="h6">{e.title}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {formatDateRange(e.startsAt, e.endsAt)} ・{" "}
                      {venueLabel[e.venueType]}
                    </Typography>
                  </CardContent>
                </CardActionArea>
              </Card>
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
