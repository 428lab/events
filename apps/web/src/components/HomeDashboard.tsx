import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import GroupAddIcon from "@mui/icons-material/GroupAdd";
import SearchIcon from "@mui/icons-material/Search";
import { Link as RouterLink } from "react-router-dom";
import type { MyEventSummary } from "@eventer/shared";
import { useMyPage } from "../api/hooks.js";
import { useMyStaffInvites } from "../api/staffInviteHooks.js";
import { dashboardBuckets, isDashboardEmpty } from "../lib/dashboard.js";
import { formatDateRange, formatRemaining, venueLabel } from "../lib/format.js";
import { EventList } from "./EventList.js";

/** 「このあとの予定」に出す件数。全部出すと下の一覧と役割が重なる */
const UPCOMING_LIMIT = 4;

/** 見出し。件数を添えるものだけ n を渡す */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <Typography variant="h6" sx={{ mb: 1 }}>
      {children}
    </Typography>
  );
}

/**
 * 主役の1件。開催中と「次のイベント」で共用する。
 * 一覧のカードより情報を増やし、そのままイベントを開けるようにする。
 */
function FeatureCard({
  event,
  live,
  now,
}: {
  event: MyEventSummary;
  live: boolean;
  now: number;
}) {
  const { t } = useTranslation();
  // formatRemaining は「あと5時間」「5h left」まで組み立てて返す。
  // 辞書で「あと {{remaining}}」のように包むと「あと あと5時間」になる
  const remaining = !live && event.startsAt > now ? formatRemaining(event.startsAt, now) : "";
  return (
    <Card
      variant="outlined"
      sx={{
        // 主役なので面を一段持ち上げる。DESIGN.md の「階層は面の明度差と罫線」に従い、
        // 影ではなく border の色で前に出す
        borderColor: live ? "secondary.main" : "primary.main",
      }}
    >
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
          {live && <Chip size="small" color="secondary" label={t("home.liveNow")} />}
          {remaining && <Chip size="small" variant="outlined" label={remaining} />}
        </Stack>
        <Typography variant="h6" sx={{ lineHeight: 1.3 }}>
          {event.title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {formatDateRange(event.startsAt, event.endsAt)}
          {t("common.dotSeparator")}
          {venueLabel(event.venueType)}
        </Typography>
        <Box sx={{ mt: 2 }}>
          <Button
            variant="contained"
            component={RouterLink}
            to={`/events/${event.id}`}
          >
            {t("home.openEvent")}
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
}

/**
 * ログイン後のホームの上段 (#489)。
 *
 * 一覧（`EventsBrowser`）が「探す」に答えるのに対して、ここは
 * **「自分が次に行くのはどれか」**にだけ答える。答えるものが無ければ
 * 丸ごと出さない（要対応が0件のときに空の見出しを残さない）。
 *
 * データは `/api/me/events` の使い回しで、新しい API は増やしていない。
 */
export function HomeDashboard() {
  const { t } = useTranslation();
  const { data: myPage, isLoading, isError, refetch } = useMyPage();
  const { data: invites } = useMyStaffInvites();

  // 開催中・締切の境目をまたいでも表示が切り替わるように時計を持つ。
  // 粒度は分でよい（useEventTiming と同じ方針）
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  const buckets = dashboardBuckets(myPage?.ongoing, now);
  const pendingInvites = invites?.length ?? 0;

  // 読み込み中は何も出さない。プレースホルダを出すと、下の一覧が
  // 読み終わったあとに上から押し下げられて視線が飛ぶ
  if (isLoading) return null;

  // 取得失敗を「参加予定なし」と案内しない。空配列（正常）と data 無し（失敗）は別
  if (isError) {
    return (
      <Alert
        severity="error"
        sx={{ mb: 4 }}
        action={
          <Button color="inherit" size="small" onClick={() => void refetch()}>
            {t("home.reload")}
          </Button>
        }
      >
        {t("home.loadError")}
      </Alert>
    );
  }

  const empty = isDashboardEmpty(buckets);
  if (empty && pendingInvites === 0) {
    return (
      <Card variant="outlined" sx={{ mb: 4 }}>
        <CardContent>
          <Typography variant="h6">{t("home.emptyTitle")}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {t("home.emptyBody")}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 2 }} flexWrap="wrap" useFlexGap>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              component={RouterLink}
              to="/events/new"
            >
              {t("home.emptyCreate")}
            </Button>
            <Button startIcon={<SearchIcon />} component={RouterLink} to="/events/upcoming">
              {t("home.emptyBrowse")}
            </Button>
          </Stack>
        </CardContent>
      </Card>
    );
  }

  const upcoming = buckets.upcoming.slice(0, UPCOMING_LIMIT);

  return (
    <Stack spacing={3} sx={{ mb: 4 }}>
      {/* 返事待ち。承諾するまでイベントページを開けないので見落とすと詰む (#339) */}
      {pendingInvites > 0 && (
        <Alert
          severity="warning"
          icon={<GroupAddIcon />}
          action={
            <Button color="inherit" size="small" component={RouterLink} to="/staff-invites">
              {t("home.staffInvitesAction")}
            </Button>
          }
        >
          {t("home.staffInvites", { n: pendingInvites })}
        </Alert>
      )}

      {buckets.live.map((e) => (
        <Box key={e.id}>
          <FeatureCard event={e} live now={now} />
        </Box>
      ))}

      {buckets.next && (
        <Box>
          <SectionHeading>{t("home.next")}</SectionHeading>
          <FeatureCard event={buckets.next} live={false} now={now} />
        </Box>
      )}

      {upcoming.length > 0 && (
        <Box>
          <SectionHeading>{t("home.upcoming")}</SectionHeading>
          <EventList events={upcoming} />
        </Box>
      )}

      {buckets.scheduling.length > 0 && (
        <Box>
          <SectionHeading>{t("home.scheduling")}</SectionHeading>
          <EventList events={buckets.scheduling} />
        </Box>
      )}
    </Stack>
  );
}
