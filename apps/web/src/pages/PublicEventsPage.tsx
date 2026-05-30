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
import { useTheme } from "@mui/material/styles";
import { Link as RouterLink } from "react-router-dom";
import { eventImageUrl, usePublicEvents } from "../api/hooks.js";
import { formatDateRange, venueLabel } from "../lib/format.js";

export function PublicEventsPage() {
  const theme = useTheme();
  const placeholderBg = `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`;
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
            {data.events.map((e) => {
              const img = eventImageUrl(e);
              return (
                <Card key={e.id} variant="outlined">
                  <CardActionArea
                    component={RouterLink}
                    to={`/events/${e.id}`}
                    sx={{ display: "flex", alignItems: "stretch" }}
                  >
                    <Box
                      sx={{
                        flexShrink: 0,
                        width: { xs: 120, sm: 200 },
                        aspectRatio: "1200 / 630",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#fff",
                        background: img ? undefined : placeholderBg,
                        ...(img && {
                          backgroundImage: `url(${img})`,
                          backgroundSize: "cover",
                          backgroundPosition: "center",
                        }),
                      }}
                    >
                      {!img && (
                        <Typography variant="h4" fontWeight={800} sx={{ opacity: 0.9 }}>
                          {e.title.charAt(0)}
                        </Typography>
                      )}
                    </Box>
                    <CardContent sx={{ flex: 1 }}>
                      <Typography variant="h6">{e.title}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {formatDateRange(e.startsAt, e.endsAt)} ・{" "}
                        {venueLabel[e.venueType]} ・ 参加 {e.participantCount} 人
                      </Typography>
                    </CardContent>
                  </CardActionArea>
                </Card>
              );
            })}
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
