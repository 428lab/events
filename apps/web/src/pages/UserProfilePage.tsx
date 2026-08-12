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
  Tooltip,
  Typography,
} from "@mui/material";
import BadgeOutlinedIcon from "@mui/icons-material/BadgeOutlined";
import QrCode2Icon from "@mui/icons-material/QrCode2";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
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
import { useTranslation } from "react-i18next";
import type {
  EarnedBadge,
  Gamification,
  ParticipationStats,
  UserAward,
  UserPhoto,
  UserProfile,
} from "@eventer/shared";
import { useSetFollow, useUserProfile } from "../api/userHooks.js";
import { useMe, useMyPage } from "../api/hooks.js";
import { useUserPhotos } from "../api/eventPhotoHooks.js";
import { ParticipationHistory } from "../components/ParticipationHistory.js";
import { ShareButton } from "../components/ShareButton.js";
import { BigQrDialog } from "../components/BigQrDialog.js";
import { ProfileCardPanel } from "../components/licenseCard/ProfileCardPanel.js";
import { dateLocale } from "../i18n/index.js";

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
  const { t } = useTranslation();
  if (awards.length === 0) return null;
  return (
    <Box>
      <Typography
        variant="h6"
        gutterBottom
        sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
      >
        <EmojiEventsIcon fontSize="small" />
        {t("profile.awardsHeading", { n: awards.length })}
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
                    {a.entryName !== profileName &&
                      t("profile.awardEntryName", { name: a.entryName })}
                  </Typography>
                </Box>
                <Typography variant="caption" color="text.secondary">
                  {new Date(a.endsAt).toLocaleDateString(dateLocale())}
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

/** 獲得済みバッジの一覧 (#14)。未獲得なら非表示 */
function BadgesSection({ g }: { g?: Gamification }) {
  const { t } = useTranslation();
  if (!g || g.badges.length === 0) return null;
  return (
    <Box>
      <Typography
        variant="h6"
        gutterBottom
        sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
      >
        <MilitaryTechOutlinedIcon fontSize="small" />
        {t("profile.badgesHeading", { n: g.badges.length })}
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

/** 参加実績（出席・無断欠席・キャンセル内訳・主催/スタッフ数）。実績ゼロなら非表示 */
function ParticipationSection({ stats }: { stats?: ParticipationStats }) {
  const { t } = useTranslation();
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
        {t("profile.participationHeading")}
      </Typography>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        {rate != null && (
          <Chip
            label={t("profile.attendanceRate", { n: rate })}
            color="primary"
            variant="outlined"
          />
        )}
        {hosted > 0 && (
          <Chip label={t("profile.hostedCount", { n: hosted })} variant="outlined" />
        )}
        {staffed > 0 && (
          <Chip label={t("profile.staffedCount", { n: staffed })} variant="outlined" />
        )}
        {spoken > 0 && (
          <Chip
            label={t("profile.spokenCount", { n: spoken })}
            color="secondary"
            variant="outlined"
          />
        )}
        {likesReceived > 0 && (
          <Chip
            label={t("profile.likesCount", { n: likesReceived })}
            variant="outlined"
          />
        )}
        <Typography variant="body2" color="text.secondary">
          {t("profile.participationBreakdown", {
            attended,
            noShow,
            canceled: cancelEarly + cancelLate,
            late: cancelLate,
          })}
        </Typography>
      </Stack>
    </Box>
  );
}

/** プロフィール上部の通算値 (#315)。年表の絞り込みには追随しないことを
 * 「通算」のラベルで明示する（絞り込みに追随する集計は年表の中に別で出る）。
 * 出会い数は表示中の行の合計ではなくサーバーが独立に数えた実人数
 * （同じ人と別のイベントで会っても1人）。年表下部の「出会いの記録 N件」は
 * 延べ件数なので別物 */
function TotalsBar({
  events,
  meetTotal,
}: {
  events: UserProfile["events"];
  meetTotal: number;
}) {
  const { t } = useTranslation();
  const hosted = events.filter((e) => e.myRole === "staff").length;
  const totals = [
    { label: t("profile.totalEvents"), value: events.length, accent: false },
    { label: t("profile.filterHost"), value: hosted, accent: false },
    { label: t("profile.filterJoin"), value: events.length - hosted, accent: false },
    { label: t("profile.totalMet"), value: meetTotal, accent: true },
  ];
  if (events.length === 0 && meetTotal === 0) return null;
  return (
    <Stack
      direction="row"
      spacing={2}
      alignItems="center"
      flexWrap="wrap"
      useFlexGap
    >
      <Chip
        label={t("profile.totalsLabel")}
        size="small"
        variant="outlined"
        sx={{ fontWeight: 800 }}
      />
      {totals.map((total) => (
        <Box key={total.label}>
          <Typography
            sx={{
              fontSize: 19,
              fontWeight: 800,
              lineHeight: 1.2,
              fontVariantNumeric: "tabular-nums",
              ...(total.accent && { color: "primary.main" }),
            }}
          >
            {total.value}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {total.label}
          </Typography>
        </Box>
      ))}
    </Stack>
  );
}

export function UserProfilePage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const { data, isLoading, isError } = useUserProfile(id);
  const { data: me } = useMe();
  const navigate = useNavigate();
  const setFollow = useSetFollow(id);
  // 本人のページはマイページ相当を兼ねる (#319)。公開プロフィールの一覧は
  // 公開イベントだけなので、本人には下書き・参加申込中も含む自分用の一覧を出す
  const isMe = data?.isMe === true;
  const { data: myEvents } = useMyPage(isMe);
  // 自分のQRを大きく見せる (#324)。他人のQRを見せる意味はないので本人のときだけ
  const [qrOpen, setQrOpen] = useState(false);

  if (isError)
    return <Alert severity="info">{t("profile.notFound")}</Alert>;
  if (isLoading || !data) return <Typography>{t("common.loading")}</Typography>;

  const joined = new Date(data.createdAt).toLocaleDateString(dateLocale());
  // 参加履歴に流す一覧。本人なら自分用（公開ぶんの上位集合）、他人なら公開ぶん
  const historyEvents =
    data.isMe && myEvents ? [...myEvents.ongoing, ...myEvents.past] : data.events;

  const toggleFollow = () => {
    if (!me) {
      navigate("/login");
      return;
    }
    setFollow.mutate(!data.isFollowing);
  };

  return (
    <Stack spacing={3}>
      {/* カードを主役にする (#334)。大きなアイコンとレベルの進捗はカードに出るので
          落としたが、カード上で読めないもの（バッジ名・コミュニティのリンク）は下に残す */}
      <ProfileCardPanel profile={data} fallbackHandle={id} />

      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
        sx={{
          // スマホ幅で1行に収まらないぶんは折り返す。縮まないままだと右端の
          // ボタンが本文の余白を突き抜けて画面際に貼りつく (#326)
          minWidth: 0,
          "& .MuiButton-root": {
            fontSize: { xs: "0.875rem", sm: "0.9375rem" },
            px: { xs: 1.5, sm: 2.25 },
          },
        }}
      >
        {/* 他人にできるのはフォローだけ。編集・印刷・書き出しの導線は出さない */}
        {!data.isMe && (
          <Button
            variant={data.isFollowing ? "outlined" : "contained"}
            size="large"
            onClick={toggleFollow}
            disabled={setFollow.isPending}
          >
            {data.isFollowing ? t("profile.following") : t("profile.follow")}
          </Button>
        )}
        {/* カードの意匠を仕立てる画面 (#334)。他人のカードは編集も印刷もできない */}
        {data.isMe && (
          <Button
            component={RouterLink}
            to={`/users/${data.handle ?? id}/card`}
            variant="contained"
            size="large"
            startIcon={<BadgeOutlinedIcon />}
          >
            {t("profile.editCard")}
          </Button>
        )}
        {/* 交流の場で相手に読み取ってもらう用の大きなQR (#324) */}
        {data.isMe && (
          <Button
            variant="outlined"
            size="large"
            startIcon={<QrCode2Icon />}
            onClick={() => setQrOpen(true)}
          >
            {t("profile.showQr")}
          </Button>
        )}
        <ShareButton
          title={data.name}
          url={`${window.location.origin}/users/${data.handle ?? id}`}
        />
        {/* 設定は本人にしか意味がないので本人のページだけに出す (#319) */}
        {data.isMe && (
          <Tooltip title={t("nav.settings")}>
            <IconButton
              component={RouterLink}
              to="/account"
              aria-label={t("nav.settings")}
            >
              <SettingsOutlinedIcon />
            </IconButton>
          </Tooltip>
        )}
      </Stack>

      {/* カードに無い素性。登録日とフォローの数 */}
      <Typography variant="caption" color="text.secondary">
        {t("profile.joinedOn", { date: joined })}
        {t("common.dotSeparator")}
        {t("profile.followerCount", { n: data.followerCount })}
        {t("common.dotSeparator")}
        {/* 本人のときだけフォロー中の一覧へ行けるようにする (#319)。
            /following は自分のフォローを管理する画面なので他人には出さない */}
        {data.isMe ? (
          <Link
            component={RouterLink}
            to="/following"
            color="inherit"
            underline="hover"
          >
            {t("profile.followingCount", { n: data.followingCount })}
          </Link>
        ) : (
          <>{t("profile.followingCount", { n: data.followingCount })}</>
        )}
      </Typography>

      {data.isMe && (
        <BigQrDialog
          open={qrOpen}
          onClose={() => setQrOpen(false)}
          name={data.name}
          avatarUrl={data.avatarUrl}
        />
      )}

      {/* 直下の一覧と同じ母集団を数える。本人のページは下書き等も含む自分用の
          一覧なので、公開ぶんだけを数えると件数が合わなくなる (#319) */}
      <TotalsBar events={historyEvents} meetTotal={data.meetTotal ?? 0} />

      {/* バッジはカードにも出るが、カード上は★の数と最上位1件の英字だけで、
          名前も説明も読めない。何を獲得したのかはここでしか分からない (#334) */}
      <BadgesSection g={data.gamification} />

      <ParticipationSection stats={data.participation} />

      <AwardsSection awards={data.awards} profileName={data.name} />

      <PhotoGallerySection handle={data.handle ?? id} />

      {/* コミュニティもカードに出るが、カード上は上位5件までの飾りでリンクにならない。
          役割つきで辿れるのはここだけ (#334) */}
      {data.communities.length > 0 && (
        <Box>
          <Typography variant="h6" gutterBottom>
            {t("profile.communitiesHeading")}
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
                // 一般メンバーは立場を添えず名前だけ。どの立場に添えるかは
                // 画面側の決めごとで、文言だけを辞書から引く
                label={
                  com.role === "owner" || com.role === "admin"
                    ? t("profile.communityWithRole", {
                        name: com.name,
                        role: t(`communityRole.${com.role}`),
                      })
                    : com.name
                }
              />
            ))}
          </Stack>
        </Box>
      )}

      {/* 参加履歴 (#315)。主役は4分類の一覧で、年表はタブで切り替える。
          本人のページではマイページ相当の一覧（下書き等も含む）を出す (#319) */}
      {historyEvents.length === 0 ? (
        <Typography color="text.secondary">
          {data.isMe
            ? t("profile.noOngoingEvents")
            : t("profile.noPublicEvents")}
        </Typography>
      ) : (
        <ParticipationHistory
          events={historyEvents}
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
  const { t } = useTranslation();
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
        {t("profile.photosHeading", { n: photos.length })}
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
                {t("profile.viewEvent", { title: open.eventTitle })}
              </Link>
            </Box>
          </Box>
        )}
      </Dialog>
    </Box>
  );
}
