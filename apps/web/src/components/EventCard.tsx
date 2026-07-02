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
import type { Event, EventRole } from "@eventer/shared";
import { eventImageUrl } from "../api/hooks.js";
import { formatDateRange, roleLabel, venueLabel } from "../lib/format.js";

/** イベントごとに決定的に選ぶ落ち着いた配色（画像なし時のタイトルカード用） */
const PALETTE = [
  { bg: "#1B3A3A", fg: "#5EEAD4" },
  { bg: "#3A2A18", fg: "#FDBA74" },
  { bg: "#3A1E26", fg: "#FDA4AF" },
  { bg: "#2A2440", fg: "#C4B5FD" },
  { bg: "#16304A", fg: "#7DD3FC" },
  { bg: "#213A20", fg: "#BEF264" },
];

function pickColor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** イベント一覧で共通利用するカード（左サムネ＋右情報、任意でロール/状態チップ）。 */
export function EventCard({
  event,
  role,
}: {
  event: Event;
  role?: EventRole;
}) {
  const img = eventImageUrl(event);
  const color = pickColor(event.id);

  return (
    <Card>
      <CardActionArea
        component={RouterLink}
        to={`/events/${event.id}`}
        sx={{
          display: "flex",
          // モバイルは縦積み（画像が上に全幅）、PCは横並び
          flexDirection: { xs: "column", sm: "row" },
          alignItems: "stretch",
        }}
      >
        <Box
          sx={{
            flexShrink: 0,
            width: { xs: "100%", sm: 200 },
            aspectRatio: "1200 / 630",
            ...(img
              ? {
                  backgroundImage: `url(${img})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }
              : {
                  bgcolor: color.bg,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  p: { xs: 1, sm: 1.5 },
                }),
          }}
        >
          {!img && (
            <>
              <Typography
                sx={{
                  color: "#F1F5F9",
                  fontWeight: 700,
                  fontSize: { xs: 20, sm: 14 },
                  lineHeight: 1.3,
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {event.title}
              </Typography>
              <Typography
                sx={{
                  color: color.fg,
                  fontSize: { xs: 8, sm: 10 },
                  fontWeight: 600,
                  opacity: 0.9,
                }}
              >
                events lab
              </Typography>
            </>
          )}
        </Box>
        <CardContent
          sx={{
            flex: 1,
            minWidth: 0,
            p: { xs: 1.25, sm: 2 },
            "&:last-child": { pb: { xs: 1.25, sm: 2 } },
          }}
        >
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            justifyContent="space-between"
          >
            <Typography
              variant="h6"
              sx={{
                fontSize: { xs: "0.95rem", sm: "1.25rem" },
                lineHeight: 1.25,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {event.title}
            </Typography>
            {role && <Chip size="small" label={roleLabel[role]} sx={{ flexShrink: 0 }} />}
          </Stack>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              mt: 0.25,
              fontSize: { xs: "0.72rem", sm: "0.875rem" },
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {event.scheduling
              ? "📅 日程調整中"
              : formatDateRange(event.startsAt, event.endsAt)}{" "}
            ・ {venueLabel[event.venueType]} ・ 参加 {event.participantCount} 人
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}
