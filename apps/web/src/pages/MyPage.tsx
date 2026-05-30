import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Stack,
  Typography,
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import type { MyEventSummary } from "@eventer/shared";
import { useMyPage } from "../api/hooks.js";
import { formatDateRange, roleLabel, venueLabel } from "../lib/format.js";

function EventCard({ event }: { event: MyEventSummary }) {
  return (
    <Card variant="outlined">
      <CardActionArea component={RouterLink} to={`/events/${event.id}`}>
        <CardContent>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
          >
            <Typography variant="h6">{event.title}</Typography>
            <Chip size="small" label={roleLabel[event.myRole]} />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {formatDateRange(event.startsAt, event.endsAt)} ・{" "}
            {venueLabel[event.venueType]} ・ 参加 {event.participantCount} 人
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

export function MyPage() {
  const { data, isLoading } = useMyPage();
  if (isLoading || !data) return <Typography>読み込み中…</Typography>;

  return (
    <Stack spacing={4}>
      <Box>
        <Typography variant="h5" gutterBottom fontWeight={700}>
          開催中・予定のイベント
        </Typography>
        {data.ongoing.length === 0 ? (
          <Typography color="text.secondary">参加中のイベントはありません</Typography>
        ) : (
          <Stack spacing={2}>
            {data.ongoing.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </Stack>
        )}
      </Box>
      <Box>
        <Typography variant="h5" gutterBottom fontWeight={700}>
          過去に参加したイベント
        </Typography>
        {data.past.length === 0 ? (
          <Typography color="text.secondary">まだありません</Typography>
        ) : (
          <Stack spacing={2}>
            {data.past.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </Stack>
        )}
      </Box>
    </Stack>
  );
}
