import {
  Box,
  Button,
  IconButton,
  Link,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import RssFeedIcon from "@mui/icons-material/RssFeed";
import AddIcon from "@mui/icons-material/Add";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { EventsBrowser } from "../components/EventsBrowser.js";
import { EggTabs } from "../components/EggTabs.js";
import { useMe } from "../api/hooks.js";

/** イベント一覧のフィード購読導線（RSS / JSON Feed / iCalendar）。
 * /feed/* は SPA ルートではなくワーカーが直接返すので通常の <a>（Link href）で開く。 */
function FeedLinks() {
  const { t } = useTranslation();
  return (
    <Box sx={{ pt: 3, borderTop: 1, borderColor: "divider" }}>
      <Stack
        direction="row"
        spacing={1.5}
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
      >
        <RssFeedIcon fontSize="small" sx={{ color: "text.secondary" }} />
        <Typography variant="body2" color="text.secondary">
          {t("events.feedSubscribe")}
        </Typography>
        <Link href="/feed/events.rss" target="_blank" rel="noopener" variant="body2">
          RSS
        </Link>
        <Link href="/feed/events.json" target="_blank" rel="noopener" variant="body2">
          JSON Feed
        </Link>
        <Tooltip title={t("events.feedIcsHint")}>
          <Link href="/feed/events.ics" target="_blank" rel="noopener" variant="body2">
            {t("events.feedIcs")}
          </Link>
        </Tooltip>
        <Tooltip title={t("events.feedLlmsHint")}>
          <Link href="/llms.txt" target="_blank" rel="noopener" variant="body2">
            {t("events.feedLlms")}
          </Link>
        </Tooltip>
      </Stack>
    </Box>
  );
}

export function PublicEventsPage() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  return (
    <Box>
      <EggTabs value="events" />
      <Stack spacing={4}>
        {/* 開催予定/日程調整中/過去タブ・絞り込み・10件ページング (#234) */}
        <EventsBrowser
          actions={
            me ? (
              <>
                {/* モバイルはアイコンのみ、sm以上は文字付き */}
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  component={RouterLink}
                  to="/events/new"
                  sx={{ display: { xs: "none", sm: "inline-flex" } }}
                >
                  {t("events.create")}
                </Button>
                <Tooltip title={t("events.create")}>
                  <IconButton
                    color="primary"
                    component={RouterLink}
                    to="/events/new"
                    aria-label={t("events.create")}
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
            ) : undefined
          }
        />
        <FeedLinks />
      </Stack>
    </Box>
  );
}
