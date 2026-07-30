import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import EggIcon from "@mui/icons-material/Egg";
import EggAltIcon from "@mui/icons-material/EggAlt";
import StadiumIcon from "@mui/icons-material/Stadium";
import FavoriteIcon from "@mui/icons-material/Favorite";
import FavoriteBorderIcon from "@mui/icons-material/FavoriteBorder";
import CampaignIcon from "@mui/icons-material/Campaign";
import CampaignOutlinedIcon from "@mui/icons-material/CampaignOutlined";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom";
import { useMe } from "../api/hooks.js";
import {
  useDeleteEventRequest,
  useEventRequest,
  useReactEventRequest,
  useSetEventRequestStatus,
  useSetReactorsAnonymous,
  useSetRequestVenueWanted,
  type ReactorUser,
} from "../api/requestHooks.js";
import { UserLink } from "../components/UserLink.js";
import { EventCard } from "../components/EventCard.js";
import { ShareButton } from "../components/ShareButton.js";
import { OfferVenueButton, VenueOfferPanel } from "../components/VenueOffers.js";
import { venueLabel, formatDateTime } from "../lib/format.js";

/** イベントのたまご詳細。賛同・開催宣言・クローズ。 */
export function EventRequestDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const q = useEventRequest(id);
  const react = useReactEventRequest(id);
  const setStatus = useSetEventRequestStatus(id);
  const setVenueWanted = useSetRequestVenueWanted(id);
  const setReactorsAnonymous = useSetReactorsAnonymous(id);
  const del = useDeleteEventRequest();

  if (q.isLoading) return <Typography>読み込み中…</Typography>;
  if (q.isError || !q.data) {
    return <Alert severity="error">たまごが見つかりませんでした。</Alert>;
  }
  const { request, creator, community, events, myReactions, isMine, reactors } =
    q.data;
  const attending = myReactions.includes("attend");
  const hosting = myReactions.includes("host");
  const open = request.status === "open";
  const creatorName = creator ? creator.globalName || creator.username : "?";

  const toggle = (kind: "attend" | "host", on: boolean) => {
    if (!me) {
      navigate("/login");
      return;
    }
    react.mutate({ kind, on });
  };

  return (
    <Stack spacing={3}>
      <Card variant="outlined">
        <CardContent>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography
              variant="h5"
              fontWeight={700}
              sx={{
                wordBreak: "break-word",
                display: "flex",
                alignItems: "center",
                gap: 0.75,
              }}
            >
              <EggIcon fontSize="medium" />
              {request.title}
            </Typography>
            {!open && <Chip size="small" label="クローズ" />}
            {request.venueTypePref && (
              <Chip size="small" variant="outlined" label={`希望: ${venueLabel[request.venueTypePref]}`} />
            )}
            {request.membersOnly && (
              <Chip size="small" variant="outlined" label="メンバー限定" />
            )}
            {request.venueWanted && (
              <Chip
                size="small"
                color="success"
                variant="outlined"
                icon={<StadiumIcon fontSize="small" />}
                label="会場募集中"
              />
            )}
            {community && (
              <Chip
                size="small"
                variant="outlined"
                label={community.name}
                component={RouterLink}
                to={`/c/${community.slug}`}
                clickable
              />
            )}
            {/* メンバー限定はURLを知られても見えないが、共有導線は出さない */}
            {!request.membersOnly && (
              <ShareButton slug={request.slug} title={request.title} prefix="r" />
            )}
          </Stack>

          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.5 }}>
            <Avatar src={creator?.avatarUrl ?? undefined} sx={{ width: 24, height: 24 }}>
              {creatorName[0]}
            </Avatar>
            <Typography variant="body2" color="text.secondary">
              {creatorName} さんの「あったらいいな」 ・ {formatDateTime(request.createdAt)}
            </Typography>
          </Stack>

          {request.description && (
            <Typography sx={{ mt: 2, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {request.description}
            </Typography>
          )}

          <Divider sx={{ my: 2 }} />

          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
            <Button
              variant={attending ? "contained" : "outlined"}
              color="error"
              startIcon={attending ? <FavoriteIcon /> : <FavoriteBorderIcon />}
              onClick={() => toggle("attend", !attending)}
              disabled={!open || react.isPending}
            >
              参加したい {request.attendCount}
            </Button>
            <Button
              variant={hosting ? "contained" : "outlined"}
              color="warning"
              startIcon={hosting ? <CampaignIcon /> : <CampaignOutlinedIcon />}
              onClick={() => toggle("host", !hosting)}
              disabled={!open || react.isPending}
            >
              開催してもいい {request.hostCount}
            </Button>
            {me && open && (
              <Button
                variant="contained"
                color="success"
                startIcon={<RocketLaunchIcon />}
                component={RouterLink}
                to={`/events/new?fromRequest=${request.id}`}
              >
                開催します
              </Button>
            )}
          </Stack>
          {reactors && (reactors.attend.length > 0 || reactors.host.length > 0) && (
            <Box sx={{ mt: 2 }}>
              {reactors.attend.length > 0 && (
                <ReactorRow label="参加したい" users={reactors.attend} />
              )}
              {reactors.host.length > 0 && (
                <ReactorRow label="開催してもいい" users={reactors.host} />
              )}
            </Box>
          )}
          {!me && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
              賛同や開催宣言にはログインが必要です。
            </Typography>
          )}
          {react.isError && (
            <Typography variant="body2" color="error" sx={{ mt: 1.5 }}>
              賛同できませんでした。コミュニティのたまごへの賛同はメンバーのみです。
            </Typography>
          )}

          {isMine && (
            <>
              <Divider sx={{ my: 2 }} />
              <Stack direction="row" spacing={1.5}>
                {open ? (
                  <Button size="small" onClick={() => setStatus.mutate("closed")}>
                    クローズする
                  </Button>
                ) : (
                  <Button size="small" onClick={() => setStatus.mutate("open")}>
                    再オープン
                  </Button>
                )}
                <Button
                  size="small"
                  startIcon={request.venueWanted ? undefined : <StadiumIcon />}
                  disabled={setVenueWanted.isPending}
                  onClick={() => setVenueWanted.mutate(!request.venueWanted)}
                >
                  {request.venueWanted ? "会場募集を止める" : "会場も募集する"}
                </Button>
                <Button
                  size="small"
                  disabled={setReactorsAnonymous.isPending}
                  onClick={() =>
                    setReactorsAnonymous.mutate(!request.reactorsAnonymous)
                  }
                >
                  {request.reactorsAnonymous
                    ? "賛同者を表示する"
                    : "賛同者を匿名にする"}
                </Button>
                <Button
                  size="small"
                  color="error"
                  onClick={() => {
                    if (window.confirm("このたまごを削除しますか？")) {
                      del.mutate(request.id, {
                        onSuccess: () => navigate("/requests"),
                      });
                    }
                  }}
                >
                  削除
                </Button>
              </Stack>
            </>
          )}
        </CardContent>
      </Card>

      {/* 会場マッチング */}
      <VenueOfferPanel kind="for-request" id={id} enabled={isMine} />
      {me && !isMine && request.venueWanted && open && !request.membersOnly && (
        <Box>
          <OfferVenueButton requestId={id} />
        </Box>
      )}

      {events.length > 0 && (
        <Box>
          <Typography
            variant="h6"
            fontWeight={700}
            gutterBottom
            sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
          >
            <EggAltIcon fontSize="small" />
            このたまごから生まれたイベント
          </Typography>
          <Stack spacing={2}>
            {events.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </Stack>
        </Box>
      )}
    </Stack>
  );
}

/** 賛同者の一行表示（アバター＋名前のリンク） */
function ReactorRow({ label, users }: { label: string; users: ReactorUser[] }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 0.5 }}>
      <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
        {label}:
      </Typography>
      {users.map((u) => (
        <UserLink
          key={u.id}
          username={u.username}
          name={u.globalName ?? u.username}
          avatarUrl={u.avatarUrl}
          withAvatar
          avatarSize={20}
        />
      ))}
    </Stack>
  );
}
