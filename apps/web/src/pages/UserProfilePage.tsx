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
  LinearProgress,
  Link,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import BadgeOutlinedIcon from "@mui/icons-material/BadgeOutlined";
import CloseIcon from "@mui/icons-material/Close";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import MilitaryTechIcon from "@mui/icons-material/MilitaryTech";
import MilitaryTechOutlinedIcon from "@mui/icons-material/MilitaryTechOutlined";
import WorkspacePremiumIcon from "@mui/icons-material/WorkspacePremium";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import CampaignOutlinedIcon from "@mui/icons-material/CampaignOutlined";
import HandymanOutlinedIcon from "@mui/icons-material/HandymanOutlined";
import CoPresentOutlinedIcon from "@mui/icons-material/CoPresentOutlined";
import EventAvailableOutlinedIcon from "@mui/icons-material/EventAvailableOutlined";
import ThumbUpOutlinedIcon from "@mui/icons-material/ThumbUpOutlined";
import HandshakeOutlinedIcon from "@mui/icons-material/HandshakeOutlined";
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom";
import type {
  EarnedBadge,
  Gamification,
  ParticipationStats,
  UserAward,
  UserPhoto,
} from "@eventer/shared";
import { useSetFollow, useUserProfile } from "../api/userHooks.js";
import { useMe } from "../api/hooks.js";
import { useMeetableEvents, useRecordMeet } from "../api/eventMeetHooks.js";
import { useUserPhotos } from "../api/eventPhotoHooks.js";
import { ParticipationHistory } from "../components/ParticipationHistory.js";
import { ShareButton } from "../components/ShareButton.js";

const COMMUNITY_ROLE_LABEL: Record<string, string> = {
  owner: "オーナー",
  admin: "管理者",
};

/** 順位に応じたメダルアイコン（1〜3位=金/銀/銅トロフィー、4位以下の入賞=メダル、特別枠=勲章） */
function awardIcon(rankOrder: number | null) {
  if (rankOrder === 1)
    return <EmojiEventsIcon sx={{ fontSize: "inherit", color: "#FFB300" }} />;
  if (rankOrder === 2)
    return <EmojiEventsIcon sx={{ fontSize: "inherit", color: "#9E9E9E" }} />;
  if (rankOrder === 3)
    return <EmojiEventsIcon sx={{ fontSize: "inherit", color: "#8D6E63" }} />;
  if (rankOrder != null)
    return <WorkspacePremiumIcon sx={{ fontSize: "inherit" }} />;
  return <MilitaryTechIcon sx={{ fontSize: "inherit" }} />;
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
      <Typography
        variant="h6"
        gutterBottom
        sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
      >
        <EmojiEventsIcon fontSize="small" />
        受賞歴（{awards.length}）
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
                  {awardIcon(a.rankOrder)}
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

/** バッジ種別 → 単色アイコンの対応 (#14) */
const BADGE_ICONS: Record<
  EarnedBadge["icon"],
  typeof CampaignOutlinedIcon
> = {
  host: CampaignOutlinedIcon,
  staff: HandymanOutlinedIcon,
  speak: CoPresentOutlinedIcon,
  attend: EventAvailableOutlinedIcon,
  liked: ThumbUpOutlinedIcon,
  meet: HandshakeOutlinedIcon,
};

/** バッジの段階に応じた色（1=控えめ, 2=プライマリ, 3=セカンダリで強調） */
const TIER_COLORS: Record<number, string> = {
  1: "text.secondary",
  2: "primary.main",
  3: "secondary.main",
};

/** レベルチップ＋次のレベルまでの進捗バー (#14)。実績ゼロなら非表示 */
function LevelBlock({ g }: { g?: Gamification }) {
  if (!g || (g.xp === 0 && g.badges.length === 0)) return null;
  const span = g.nextLevelXp - g.currentLevelXp;
  const pct =
    span > 0
      ? Math.min(100, Math.max(0, ((g.xp - g.currentLevelXp) / span) * 100))
      : 0;
  return (
    <Box sx={{ mt: 0.75, maxWidth: 320 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Chip
          label={`Lv.${g.level}`}
          color="primary"
          size="small"
          sx={{ fontWeight: 700 }}
        />
        <Typography variant="caption" color="text.secondary">
          {g.xp} XP ・ 次のレベルまで {g.nextLevelXp - g.xp}
        </Typography>
      </Stack>
      <LinearProgress
        variant="determinate"
        value={pct}
        sx={{ mt: 0.5, height: 4, borderRadius: 2 }}
      />
    </Box>
  );
}

/** 獲得済みバッジの一覧 (#14)。未獲得なら非表示 */
function BadgesSection({ g }: { g?: Gamification }) {
  if (!g || g.badges.length === 0) return null;
  return (
    <Box>
      <Typography
        variant="h6"
        gutterBottom
        sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
      >
        <MilitaryTechOutlinedIcon fontSize="small" />
        バッジ（{g.badges.length}）
      </Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {g.badges.map((b) => {
          const Icon = BADGE_ICONS[b.icon] ?? MilitaryTechOutlinedIcon;
          const color = TIER_COLORS[b.tier] ?? "text.secondary";
          return (
            <Tooltip key={b.key} title={b.description}>
              <Card
                variant="outlined"
                sx={{
                  px: 1.25,
                  py: 0.75,
                  // 段階が上がるほど枠線で控えめに強調（単色アイコンのみ）
                  ...(b.tier >= 2 && { borderColor: color }),
                }}
              >
                <Stack direction="row" spacing={0.75} alignItems="center">
                  <Icon fontSize="small" sx={{ color }} />
                  <Typography variant="body2" fontWeight={600}>
                    {b.name}
                  </Typography>
                </Stack>
              </Card>
            </Tooltip>
          );
        })}
      </Stack>
    </Box>
  );
}

/** 「同じイベントに参加中」バナー (#189)。プロフィールQRの読み合いを想定し、
 * 両者が参加中の共通イベントがあるときだけ「出会った！」ボタンを出す。
 * ログイン中に他人のプロフィールを見ているときのみマウントすること */
function MeetSection({ targetUserId }: { targetUserId: string }) {
  const { data: events } = useMeetableEvents(targetUserId, true);
  const recordMeet = useRecordMeet();
  // イベントごとの記録結果（created=新規記録 / already=このペアで記録済み）
  const [results, setResults] = useState<
    Record<string, "created" | "already" | "error">
  >({});
  if (!events || events.length === 0) return null;
  return (
    <Stack spacing={1}>
      {/* 共通イベントが複数あるのは稀なので最大2件まで表示 */}
      {events.slice(0, 2).map((ev) => {
        const result = results[ev.id];
        return (
          <Alert
            key={ev.id}
            severity={result === "created" ? "success" : "info"}
            icon={<HandshakeOutlinedIcon fontSize="inherit" />}
            action={
              result ? undefined : (
                <Button
                  color="inherit"
                  size="small"
                  variant="outlined"
                  disabled={recordMeet.isPending}
                  onClick={() =>
                    recordMeet.mutate(
                      { eventId: ev.id, userId: targetUserId },
                      {
                        onSuccess: (r) =>
                          setResults((prev) => ({
                            ...prev,
                            [ev.id]: r.created ? "created" : "already",
                          })),
                        onError: () =>
                          setResults((prev) => ({ ...prev, [ev.id]: "error" })),
                      },
                    )
                  }
                  sx={{ whiteSpace: "nowrap", flexShrink: 0 }}
                >
                  出会った！
                </Button>
              )
            }
          >
            {result === "created"
              ? "記録しました！お互いにXPが入ります"
              : result === "already"
                ? "このイベントでは記録済みです"
                : result === "error"
                  ? "記録できませんでした（イベント時間外の可能性があります）"
                  : `同じイベント「${ev.title}」に参加中`}
          </Alert>
        );
      })}
    </Stack>
  );
}

/** 参加実績（出席・無断欠席・キャンセル内訳・主催/スタッフ数）。実績ゼロなら非表示 */
function ParticipationSection({ stats }: { stats?: ParticipationStats }) {
  if (!stats) return null;
  const { attended, noShow, cancelEarly, cancelLate, hosted, staffed, spoken } =
    stats;
  // 主催・スタッフとしてもらったいいね合計 (#155)。旧レスポンスでは欠落しうる
  const likesReceived = stats.likesReceived ?? 0;
  const registered = attended + noShow;
  if (
    registered +
      cancelEarly +
      cancelLate +
      hosted +
      staffed +
      spoken +
      likesReceived ===
    0
  ) {
    return null;
  }
  const rate = registered > 0 ? Math.round((attended / registered) * 100) : null;
  return (
    <Box>
      <Typography
        variant="h6"
        gutterBottom
        sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
      >
        <FactCheckIcon fontSize="small" />
        参加実績
      </Typography>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        {rate != null && (
          <Chip label={`参加率 ${rate}%`} color="primary" variant="outlined" />
        )}
        {hosted > 0 && <Chip label={`主催 ${hosted}`} variant="outlined" />}
        {staffed > 0 && <Chip label={`スタッフ ${staffed}`} variant="outlined" />}
        {spoken > 0 && <Chip label={`登壇 ${spoken}`} color="secondary" variant="outlined" />}
        {likesReceived > 0 && (
          <Chip label={`いいね ${likesReceived}`} variant="outlined" />
        )}
        <Typography variant="body2" color="text.secondary">
          出席 {attended} ・無断欠席 {noShow} ・キャンセル {cancelEarly + cancelLate}
          （うち直前 {cancelLate}）
        </Typography>
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
          <LevelBlock g={data.gamification} />
        </Box>
        {/* プロフィールカード (#178) とシェア。PCでは空きスペースの中央に大きめ表示 */}
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{
            flexShrink: 0,
            // sm以上: 余白の中央あたりに寄せて目立たせる
            mx: { xs: 0, sm: "auto" },
          }}
        >
          <Button
            component={RouterLink}
            to={`/users/${data.handle ?? id}/card`}
            variant="contained"
            size="large"
            startIcon={<BadgeOutlinedIcon />}
          >
            プロフィールカード
          </Button>
          <ShareButton
            title={data.name}
            url={`${window.location.origin}/users/${data.handle ?? id}`}
          />
        </Stack>
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

      {/* 出会った記録 (#189)。ログイン中に他人のプロフィールを見ているときのみ */}
      {me && !data.isMe && <MeetSection key={data.id} targetUserId={data.id} />}

      <BadgesSection g={data.gamification} />

      <ParticipationSection stats={data.participation} />

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

      {/* 参加履歴 (#315)。主役は4分類の一覧で、年表はタブで切り替える */}
      {data.events.length === 0 ? (
        <Typography color="text.secondary">
          公開イベントの実績はまだありません。
        </Typography>
      ) : (
        <ParticipationHistory
          events={data.events}
          userId={data.id}
          speakerEventIds={data.speakerEventIds ?? []}
          meetCounts={data.meetCounts}
          eventPhotos={data.eventPhotos}
        />
      )}
    </Stack>
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
      <Typography
        variant="h6"
        gutterBottom
        sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
      >
        <PhotoCameraIcon fontSize="small" />
        投稿した写真（{photos.length}）
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
