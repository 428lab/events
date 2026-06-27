import { Box, Button, Stack, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { Link as RouterLink } from "react-router-dom";
import { useEvents } from "../api/hooks.js";
import { EventCard } from "../components/EventCard.js";
import { EventSearchPanel } from "../components/EventSearchPanel.js";

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

      <EventSearchPanel>
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
              <EventCard key={e.id} event={e} />
            ))}
          </Stack>
        )}
      </EventSearchPanel>
    </Stack>
  );
}
