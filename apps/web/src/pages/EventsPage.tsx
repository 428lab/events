import { Button, IconButton, Stack, Tooltip } from "@mui/material";
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
          <>
            {/* モバイルはアイコンのみ、sm以上は文字付き */}
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              component={RouterLink}
              to="/events/new"
              sx={{ display: { xs: "none", sm: "inline-flex" } }}
            >
              イベント作成
            </Button>
            <Tooltip title="イベント作成">
              <IconButton
                color="primary"
                component={RouterLink}
                to="/events/new"
                aria-label="イベント作成"
                sx={{
                  display: { xs: "inline-flex", sm: "none" },
                  bgcolor: "primary.main",
                  color: "primary.contrastText",
                  "&:hover": { bgcolor: "primary.dark" },
                }}
              >
                <AddIcon />
              </IconButton>
            </Tooltip>
          </>
        }
      />
    </Stack>
  );
}
