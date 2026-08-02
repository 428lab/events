import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { Link as RouterLink } from "react-router-dom";
import { useEvents } from "../api/hooks.js";
import { EventList, ListColumnsToggle } from "../components/EventList.js";
import { EventSearchPanel } from "../components/EventSearchPanel.js";
import { EggTabs } from "../components/EggTabs.js";

export function EventsPage() {
  const { data: events, isLoading, isError } = useEvents();

  return (
    <Stack spacing={3}>
      <EggTabs value="events" sx={{ mb: 0 }} />
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h5" fontWeight={700}>
          公開中のイベント
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <ListColumnsToggle />
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            component={RouterLink}
            to="/events/new"
          >
            イベント作成
          </Button>
        </Stack>
      </Stack>

      <EventSearchPanel>
        {isError ? (
          <Alert severity="error">
            イベントを読み込めませんでした。時間をおいて再読み込みしてください。
          </Alert>
        ) : isLoading || !events ? (
          <Typography>読み込み中…</Typography>
        ) : events.length === 0 ? (
          <Box>
            <Typography color="text.secondary">
              公開中のイベントはありません。作成してみましょう。
            </Typography>
          </Box>
        ) : (
          <EventList events={events} />
        )}
      </EventSearchPanel>
    </Stack>
  );
}
