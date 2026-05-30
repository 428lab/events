import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Stack,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { Link as RouterLink } from "react-router-dom";
import { eventImageUrl, useEvents } from "../api/hooks.js";
import { formatDateRange, venueLabel } from "../lib/format.js";

export function EventsPage() {
  const { data: events, isLoading } = useEvents();

  return (
    <Stack spacing={3}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h5" fontWeight={700}>
          公開中のイベント
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          component={RouterLink}
          to="/events/new"
        >
          イベント作成
        </Button>
      </Stack>

      {isLoading || !events ? (
        <Typography>読み込み中…</Typography>
      ) : events.length === 0 ? (
        <Box>
          <Typography color="text.secondary">
            公開中のイベントはありません。作成してみましょう。
          </Typography>
        </Box>
      ) : (
        <Stack spacing={2}>
          {events.map((e) => (
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
                    {venueLabel[e.venueType]} ・ 参加 {e.participantCount} 人
                  </Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
