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
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import type { Event, EventRole } from "@eventer/shared";
import { eventImageUrl } from "../api/hooks.js";
import {
  formatDateRange,
  participantCountLabel,
  roleLabel,
  venueLabel,
} from "../lib/format.js";
import { useCommunities } from "../api/communityHooks.js";
import { DraftChip, isDraftEvent } from "./DraftChip.js";
import { Avatar } from "@mui/material";

/** イベントごとに決定的に選ぶ落ち着いた配色（画像なし時のタイトルカード用） */
const PALETTE = [
  { bg: "#1B3A3A", fg: "#5EEAD4" },
  { bg: "#3A2A18", fg: "#FDBA74" },
  { bg: "#3A1E26", fg: "#FDA4AF" },
  { bg: "#2A2440", fg: "#C4B5FD" },
  { bg: "#16304A", fg: "#7DD3FC" },
  { bg: "#213A20", fg: "#BEF264" },
];

/** イベント id から画像なし時の配色を決める。カード以外（年表のサムネイル等）でも
 * 同じイベントが同じ色で出るよう、配色の決め方はここに1つだけ置く */
export function eventColor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** イベント一覧で共通利用するカード（左サムネ＋右情報、任意でロール/状態チップ）。
 * compact: 2列グリッド用の縦型タイル（上に画像・下に最小限の情報。subtitle/説明は省略）。 */
export function EventCard({
  event,
  role,
  compact = false,
}: {
  event: Event;
  role?: EventRole;
  compact?: boolean;
}) {
  const img = eventImageUrl(event);
  const color = eventColor(event.id);
  // 公開前は一覧のどこに出ても1枚で分かるようにする (#348)
  const draft = isDraftEvent(event);
  // 一覧全体で1クエリ（react-queryキャッシュ共有）。コミュニティ名とアイコンを解決
  const { data: communities } = useCommunities();
  const community = event.communityId
    ? communities?.find((cm) => cm.id === event.communityId)
    : undefined;

  if (compact) {
    return (
      <Card sx={{ height: "100%" }}>
        <CardActionArea
          component={RouterLink}
          to={`/events/${event.id}`}
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "stretch",
            height: "100%",
          }}
        >
          <Box
            sx={{
              width: "100%",
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
                    p: 1,
                  }),
            }}
          >
            {!img && (
              <>
                <Typography
                  sx={{
                    color: "#F1F5F9",
                    fontWeight: 700,
                    fontSize: 13,
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
                    fontSize: 8,
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
              width: "100%",
              minWidth: 0,
              p: 1,
              "&:last-child": { pb: 1 },
            }}
          >
            {community && (
              <Stack
                direction="row"
                spacing={0.5}
                alignItems="center"
                sx={{ mb: 0.25 }}
              >
                <Avatar
                  src={community.iconUrl ?? undefined}
                  variant="rounded"
                  sx={{ width: 22, height: 22, fontSize: 12, borderRadius: "5px" }}
                >
                  {community.name.charAt(0)}
                </Avatar>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  noWrap
                  sx={{ minWidth: 0, fontSize: "0.65rem" }}
                >
                  {community.name}
                </Typography>
              </Stack>
            )}
            <Stack
              direction="row"
              spacing={0.5}
              alignItems="flex-start"
              justifyContent="space-between"
            >
              <Typography
                sx={{
                  fontWeight: 600,
                  fontSize: "0.85rem",
                  lineHeight: 1.3,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {event.title}
              </Typography>
              {(draft || role) && (
                <Stack
                  direction="row"
                  spacing={0.5}
                  flexWrap="wrap"
                  justifyContent="flex-end"
                  useFlexGap
                  sx={{ flexShrink: 0 }}
                >
                  {draft && <DraftChip compact />}
                  {role && (
                    <Chip
                      size="small"
                      label={roleLabel(role)}
                      sx={{ flexShrink: 0, height: 18, fontSize: "0.6rem" }}
                    />
                  )}
                </Stack>
              )}
            </Stack>
            <Typography
              variant="caption"
              color="text.secondary"
              noWrap
              sx={{ display: "block", mt: 0.25 }}
            >
              {event.scheduling ? (
                <>
                  <CalendarMonthIcon
                    fontSize="inherit"
                    sx={{ verticalAlign: "text-bottom", mr: 0.25 }}
                  />
                  日程調整中
                </>
              ) : (
                formatDateRange(event.startsAt, event.endsAt)
              )}
            </Typography>
            {/* 人数は行を分ける。日時と同じ行に詰めるとカードの幅に収まらず、
                noWrap で人数側だけが切れて見えなくなる */}
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block" }}
            >
              {participantCountLabel(event)}
            </Typography>
          </CardContent>
        </CardActionArea>
      </Card>
    );
  }

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
          {community && (
            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 0.25 }}>
              <Avatar
                src={community.iconUrl ?? undefined}
                variant="rounded"
                sx={{ width: 22, height: 22, fontSize: 12, borderRadius: "5px" }}
              >
                {community.name.charAt(0)}
              </Avatar>
              <Typography
                variant="caption"
                color="text.secondary"
                noWrap
                sx={{ minWidth: 0 }}
              >
                {community.name}
              </Typography>
            </Stack>
          )}
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
            {(draft || role) && (
              <Stack
                direction="row"
                spacing={0.5}
                flexWrap="wrap"
                justifyContent="flex-end"
                useFlexGap
                sx={{ flexShrink: 0 }}
              >
                {draft && <DraftChip />}
                {role && <Chip size="small" label={roleLabel(role)} />}
              </Stack>
            )}
          </Stack>
          {event.subtitle && (
            <Typography
              variant="body2"
              color="text.secondary"
              noWrap
              sx={{ mt: 0.25, fontSize: { xs: "0.75rem", sm: "0.85rem" } }}
            >
              {event.subtitle}
            </Typography>
          )}
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
            {event.scheduling ? (
              <>
                <CalendarMonthIcon
                  fontSize="inherit"
                  sx={{ verticalAlign: "text-bottom", mr: 0.25 }}
                />
                日程調整中
              </>
            ) : (
              formatDateRange(event.startsAt, event.endsAt)
            )}{" "}
            ・ {venueLabel(event.venueType)} ・ {participantCountLabel(event)}
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}
