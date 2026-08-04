import {
  Alert,
  Box,
  CircularProgress,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { Link as RouterLink, useParams } from "react-router-dom";
import { useEvent, useEventMembers, useMe } from "../api/hooks.js";
import { EventChat } from "../components/EventChat.js";

/**
 * イベントチャット専用ページ (#215)。イベントページ内のカードより
 * 縦に広く使える。プレゼン中の別画面表示などにも使う。
 */
export function EventChatPage() {
  const { id = "" } = useParams();
  const { data: me } = useMe();
  const { data, isLoading, isError } = useEvent(id);
  const { data: members } = useEventMembers(id, true);

  if (isLoading) {
    return (
      <Box sx={{ display: "grid", placeItems: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (isError || !data?.event) {
    return <Alert severity="error">イベントが見つかりません。</Alert>;
  }
  const event = data.event;
  const myRole = data.myRole;
  // EventDetailPage の canComment と同じ判定（確定メンバーのみ）
  const myMembership = members?.find((m) => me && m.userId === me.id);
  const canChat = myMembership
    ? myMembership.status === "confirmed"
    : Boolean(myRole);
  const chatAvailable =
    canChat &&
    event.chatEnabled &&
    !event.scheduling &&
    event.startsAt > 0 &&
    event.status === "published";

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        // Layout の Container(py:4)＋AppBar を差し引いて縦いっぱいに使う
        height: "calc(100vh - 180px)",
        minHeight: 360,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Tooltip title="イベントページへ戻る">
          <IconButton
            size="small"
            component={RouterLink}
            to={`/events/${id}`}
            aria-label="イベントページへ戻る"
          >
            <ArrowBackIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Typography variant="h6" noWrap sx={{ minWidth: 0 }}>
          {event.title}
        </Typography>
      </Stack>
      {chatAvailable ? (
        <EventChat
          eventId={id}
          event={event}
          myRole={myRole}
          canChat={canChat}
          variant="page"
        />
      ) : (
        <Alert severity="info">
          このイベントのチャットは利用できません（参加確定メンバーのみ・チャット有効なイベントのみ）。
        </Alert>
      )}
    </Box>
  );
}
