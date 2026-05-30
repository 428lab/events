import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Stack,
  Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Link as RouterLink } from "react-router-dom";
import type { Event, EventRole } from "@eventer/shared";
import { eventImageUrl } from "../api/hooks.js";
import { formatDateRange, roleLabel, venueLabel } from "../lib/format.js";

/** イベント一覧で共通利用するカード（左サムネ＋右情報、任意でロール/状態チップ）。 */
export function EventCard({
  event,
  role,
}: {
  event: Event;
  role?: EventRole;
}) {
  const theme = useTheme();
  const img = eventImageUrl(event);
  const placeholderBg = `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`;

  return (
    <Card>
      <CardActionArea
        component={RouterLink}
        to={`/events/${event.id}`}
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
              {event.title.charAt(0)}
            </Typography>
          )}
        </Box>
        <CardContent sx={{ flex: 1 }}>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            justifyContent="space-between"
          >
            <Typography variant="h6">{event.title}</Typography>
            {role && <Chip size="small" label={roleLabel[role]} />}
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
