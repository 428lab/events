import { Button, Stack } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { Link as RouterLink } from "react-router-dom";
import { EventsBrowser } from "../components/EventsBrowser.js";
import { EggTabs } from "../components/EggTabs.js";

export function EventsPage() {
  return (
    <Stack spacing={3}>
      <EggTabs value="events" sx={{ mb: 0 }} />
      <EventsBrowser
        title="公開中のイベント"
        actions={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            component={RouterLink}
            to="/events/new"
          >
            イベント作成
          </Button>
        }
      />
    </Stack>
  );
}
