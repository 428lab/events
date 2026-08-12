import { Box, Card, CardActionArea, Chip, Stack, Typography } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import FavoriteIcon from "@mui/icons-material/Favorite";
import CampaignIcon from "@mui/icons-material/Campaign";
import CelebrationIcon from "@mui/icons-material/Celebration";
import EggIcon from "@mui/icons-material/Egg";
import type { EventRequest } from "@eventer/shared";
import { venueLabel } from "../lib/format.js";

/** イベントのたまご一覧カード。 */
export function RequestCard({ request }: { request: EventRequest }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardActionArea
        component={RouterLink}
        to={`/requests/${request.id}`}
        sx={{ p: 2 }}
      >
        <Stack direction="row" spacing={1.5} alignItems="flex-start">
          <Box sx={{ lineHeight: 1 }}>
            <EggIcon sx={{ fontSize: 28 }} />
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography fontWeight={700} sx={{ wordBreak: "break-word" }}>
                {request.title}
              </Typography>
              {request.status === "closed" && (
                <Chip size="small" label={t("egg.closed")} color="default" />
              )}
              {request.venueTypePref && (
                <Chip size="small" variant="outlined" label={venueLabel(request.venueTypePref)} />
              )}
              {request.membersOnly && (
                <Chip size="small" variant="outlined" label={t("egg.membersOnly")} />
              )}
            </Stack>
            {request.description && (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{
                  mt: 0.5,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {request.description}
              </Typography>
            )}
            <Stack direction="row" spacing={2} sx={{ mt: 1 }} alignItems="center">
              <Stack direction="row" spacing={0.5} alignItems="center">
                <FavoriteIcon sx={{ fontSize: 16, color: "error.main" }} />
                <Typography variant="body2">
                  {t("egg.attendCount", { n: request.attendCount })}
                </Typography>
              </Stack>
              <Stack direction="row" spacing={0.5} alignItems="center">
                <CampaignIcon
                  sx={{
                    fontSize: 16,
                    color: (theme) =>
                      theme.palette.mode === "light"
                        ? theme.palette.warning.dark
                        : theme.palette.warning.main,
                  }}
                />
                <Typography variant="body2">
                  {t("egg.hostCount", { n: request.hostCount })}
                </Typography>
              </Stack>
              {request.eventCount > 0 && (
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <CelebrationIcon sx={{ fontSize: 16, color: "success.main" }} />
                  <Typography variant="body2" color="success.main" fontWeight={600}>
                    {t(
                      request.eventCount === 1
                        ? "egg.hatchedCountOne"
                        : "egg.hatchedCount",
                      { n: request.eventCount },
                    )}
                  </Typography>
                </Stack>
              )}
            </Stack>
          </Box>
        </Stack>
      </CardActionArea>
    </Card>
  );
}
