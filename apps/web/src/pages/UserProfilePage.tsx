import { useState } from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  IconButton,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom";
import type { UserAward, UserPhoto, UserProfile } from "@eventer/shared";
import { useSetFollow, useUserProfile } from "../api/userHooks.js";
import { useMe } from "../api/hooks.js";
import { useUserPhotos } from "../api/eventPhotoHooks.js";
import { EventCard } from "../components/EventCard.js";

const COMMUNITY_ROLE_LABEL: Record<string, string> = {
  owner: "オーナー",
  admin: "管理者",
};

/** 順位に応じたメダル（特別枠は 🎖️） */
function awardEmoji(rankOrder: number | null): string {
  if (rankOrder === 1) return "🥇";
  if (rankOrder === 2) return "🥈";
  if (rankOrder === 3) return "🥉";
  if (rankOrder != null) return "🏅";
  return "🎖️";
}

function AwardsSection({
  awards,
  profileName,
}: {
  awards: UserAward[];
  profileName: string;
}) {
  if (awards.length === 0) return null;
  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        🏆 受賞歴（{awards.length}）
      </Typography>
      <Stack spacing={1}>
        {awards.map((a, i) => (
          <Card key={`${a.eventId}-${a.awardName}-${i}`} variant="outlined">
            <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
              <Stack
                direction="row"
                spacing={1.5}
                alignItems="center"
                flexWrap="wrap"
                useFlexGap
              >
                <Typography fontSize={26} lineHeight={1}>
                  {awardEmoji(a.rankOrder)}
                </Typography>
                <Box sx={{ flex: 1, minWidth: 200 }}>
                  <Typography fontWeight={700} sx={{ color: "secondary.main" }}>
                    {a.awardName}
                  </Typography>
                  <Typography variant="body2">
                    <Link
                      component={RouterLink}
                      to={`/events/${a.eventId}`}
                      underline="hover"
                      color="inherit"
                    >
                      {a.eventTitle}
                    </Link>
                    {a.entryName !== profileName && `（${a.entryName}）`}
                  </Typography>
                </Box>
                <Typography variant="caption" color="text.secondary">
                  {new Date(a.endsAt).toLocaleDateString("ja-JP")}
                </Typography>
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>
    </Box>
  );
}

export function UserProfilePage() {
  const { id = "" } = useParams();
  const { data, isLoading, isError } = useUserProfile(id);
  const { data: me } = useMe();
  const navigate = useNavigate();
  const setFollow = useSetFollow(id);

  if (isError) return <Alert severity="info">ユーザーが見つかりません。</Alert>;
  if (isLoading || !data) return <Typography>読み込み中…</Typography>;

  const joined = new Date(data.createdAt).toLocaleDateString("ja-JP");
  const now = Date.now();
  // 日程調整中（endsAt未確定=0）は「これから」側に含める
  const isUpcoming = (e: { scheduling: boolean; endsAt: number }) =>
    e.scheduling || e.endsAt >= now;
  const hosted = data.events.filter((e) => e.myRole === "staff");
  const joinedEvents = data.events.filter((e) => e.myRole !== "staff");
  const hostedUpcoming = hosted.filter(isUpcoming);
  const hostedPast = hosted.filter((e) => !isUpcoming(e));
  const joinedUpcoming = joinedEvents.filter(isUpcoming);
  const joinedPast = joinedEvents.filter((e) => !isUpcoming(e));

  const toggleFollow = () => {
    if (!me) {
      navigate("/login");
      return;
    }
    setFollow.mutate(!data.isFollowing);
  };

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
        <Avatar
          src={data.avatarUrl ?? undefined}
          sx={{ width: 64, height: 64, fontSize: 28 }}
        >
          {data.name.charAt(0)}
        </Avatar>
        <Box sx={{ flex: 1, minWidth: 180 }}>
          <Typography variant="h5" fontWeight={700}>
            {data.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {joined} に登録 ・ フォロワー {data.followerCount} ・ フォロー中{" "}
            {data.followingCount}
          </Typography>
        </Box>
        {!data.isMe && (
          <Button
            variant={data.isFollowing ? "outlined" : "contained"}
            size="small"
            onClick={toggleFollow}
            disabled={setFollow.isPending}
            sx={{ flexShrink: 0 }}
          >
            {data.isFollowing ? "フォロー中" : "フォローする"}
          </Button>
        )}
      </Stack>

      <AwardsSection awards={data.awards} profileName={data.name} />

      <PhotoGallerySection handle={data.handle ?? id} />


      {data.communities.length > 0 && (
        <Box>
          <Typography variant="h6" gutterBottom>
            所属コミュニティ
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {data.communities.map((com) => (
              <Chip
                key={com.id}
                component={RouterLink}
                to={`/c/${com.slug}`}
                clickable
                avatar={
                  <Avatar src={com.iconUrl ?? undefined} variant="rounded">
                    {com.name.charAt(0)}
                  </Avatar>
                }
                label={
                  COMMUNITY_ROLE_LABEL[com.role]
                    ? `${com.name}・${COMMUNITY_ROLE_LABEL[com.role]}`
                    : com.name
                }
              />
            ))}
          </Stack>
        </Box>
      )}

      {data.events.length === 0 ? (
        <Typography color="text.secondary">
          公開イベントの実績はまだありません。
        </Typography>
      ) : (
        <>
          <Section title="主催・運営するイベント" events={hostedUpcoming} />
          <Section title="参加予定のイベント" events={joinedUpcoming} />
          <Section title="主催・運営したイベント" events={hostedPast} />
          <Section title="参加したイベント" events={joinedPast} />
        </>
      )}
    </Stack>
  );
}

function Section({
  title,
  events,
}: {
  title: string;
  events: UserProfile["events"];
}) {
  if (events.length === 0) return null;
  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        {title}（{events.length}）
      </Typography>
      <Stack spacing={1.5}>
        {events.map((e) => (
          <EventCard key={e.id} event={e} role={e.myRole} />
        ))}
      </Stack>
    </Box>
  );
}

const userPhotoUrl = (p: UserPhoto) =>
  `/api/events/${p.eventId}/photos/${p.id}/image`;

/** 公開イベントに投稿した写真ギャラリー */
function PhotoGallerySection({ handle }: { handle: string }) {
  const { data: photos } = useUserPhotos(handle);
  const [open, setOpen] = useState<UserPhoto | null>(null);
  if (!photos || photos.length === 0) return null;
  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        📷 投稿した写真（{photos.length}）
      </Typography>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "repeat(3, 1fr)",
            sm: "repeat(4, 1fr)",
            md: "repeat(6, 1fr)",
          },
          gap: 0.75,
        }}
      >
        {photos.map((p) => (
          <Box
            key={p.id}
            onClick={() => setOpen(p)}
            sx={{
              position: "relative",
              aspectRatio: "1",
              borderRadius: 1,
              overflow: "hidden",
              cursor: "pointer",
              bgcolor: "action.hover",
            }}
          >
            <Box
              component="img"
              src={userPhotoUrl(p)}
              alt=""
              loading="lazy"
              sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
            {p.commentCount > 0 && (
              <Stack
                direction="row"
                spacing={0.25}
                alignItems="center"
                sx={{
                  position: "absolute",
                  top: 2,
                  left: 2,
                  px: 0.5,
                  borderRadius: 1,
                  bgcolor: "rgba(0,0,0,0.6)",
                  color: "#fff",
                  pointerEvents: "none",
                }}
              >
                <ChatBubbleOutlineIcon sx={{ fontSize: 12 }} />
                <Typography sx={{ fontSize: 11, lineHeight: 1.6 }}>
                  {p.commentCount}
                </Typography>
              </Stack>
            )}
          </Box>
        ))}
      </Box>

      <Dialog open={Boolean(open)} onClose={() => setOpen(null)} maxWidth="lg">
        {open && (
          <Box sx={{ position: "relative", bgcolor: "#000" }}>
            <IconButton
              onClick={() => setOpen(null)}
              sx={{ position: "absolute", top: 8, right: 8, color: "#fff", zIndex: 1 }}
            >
              <CloseIcon />
            </IconButton>
            <Box
              component="img"
              src={userPhotoUrl(open)}
              alt=""
              sx={{
                display: "block",
                maxWidth: "90vw",
                maxHeight: "85vh",
                objectFit: "contain",
              }}
            />
            <Box
              sx={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                p: 1,
                bgcolor: "rgba(0,0,0,0.55)",
              }}
            >
              <Link
                component={RouterLink}
                to={`/events/${open.eventId}`}
                sx={{ color: "#fff" }}
                underline="hover"
              >
                {open.eventTitle} を見る →
              </Link>
            </Box>
          </Box>
        )}
      </Dialog>
    </Box>
  );
}
