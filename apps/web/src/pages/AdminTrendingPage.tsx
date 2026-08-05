import { useState, type ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Alert,
  Avatar,
  Box,
  Card,
  CardContent,
  Chip,
  Divider,
  Link,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import LocalFireDepartmentIcon from "@mui/icons-material/LocalFireDepartment";
import {
  TRENDING_COMMUNITY_WEIGHTS,
  TRENDING_USER_WEIGHTS,
  type TrendingCommunityItem,
  type TrendingPayload,
  type TrendingUserItem,
} from "@eventer/shared";
import { useIsAdmin } from "../api/hooks.js";
import { useAdminTrending } from "../api/analyticsHooks.js";

const RANGES = [7, 30, 90] as const;

/** 内訳の表示定義。ラベル・重み・件数の取り出し方を1箇所にまとめる */
const USER_PARTS: {
  label: string;
  weight: number;
  get: (b: TrendingUserItem["breakdown"]) => number;
}[] = [
  { label: "主催", weight: TRENDING_USER_WEIGHTS.hosted, get: (b) => b.hosted },
  { label: "スタッフ", weight: TRENDING_USER_WEIGHTS.staffed, get: (b) => b.staffed },
  { label: "参加", weight: TRENDING_USER_WEIGHTS.joined, get: (b) => b.joined },
  {
    label: "いいね",
    weight: TRENDING_USER_WEIGHTS.likeReceived,
    get: (b) => b.likesReceived,
  },
  { label: "出会い", weight: TRENDING_USER_WEIGHTS.meet, get: (b) => b.meets },
  {
    label: "たまご投稿",
    weight: TRENDING_USER_WEIGHTS.eggPosted,
    get: (b) => b.eggsPosted,
  },
  {
    label: "賛同",
    weight: TRENDING_USER_WEIGHTS.eggReaction,
    get: (b) => b.eggReactions,
  },
  {
    label: "フォロワー",
    weight: TRENDING_USER_WEIGHTS.followerGained,
    get: (b) => b.followersGained,
  },
];

const COMMUNITY_PARTS: {
  label: string;
  weight: number;
  get: (b: TrendingCommunityItem["breakdown"]) => number;
}[] = [
  {
    label: "開催",
    weight: TRENDING_COMMUNITY_WEIGHTS.heldEvent,
    get: (b) => b.heldEvents,
  },
  {
    label: "延べ参加者",
    weight: TRENDING_COMMUNITY_WEIGHTS.participation,
    get: (b) => b.participations,
  },
  {
    label: "新規メンバー",
    weight: TRENDING_COMMUNITY_WEIGHTS.newMember,
    get: (b) => b.newMembers,
  },
  {
    label: "いいね",
    weight: TRENDING_COMMUNITY_WEIGHTS.likeReceived,
    get: (b) => b.likesReceived,
  },
];

/** 内訳のチップ列。0 の項目は出さない（並べても読みにくいだけ）。
 * ツールチップにはスコアの計算式（件数 × 重み）をそのまま出す */
function Breakdown<B>({
  parts,
  breakdown,
}: {
  parts: { label: string; weight: number; get: (b: B) => number }[];
  breakdown: B;
}) {
  const shown = parts.filter((p) => p.get(breakdown) > 0);
  if (shown.length === 0) return null;
  const detail = shown
    .map((p) => {
      const n = p.get(breakdown);
      return `${p.label} ${n} × ${p.weight} = ${n * p.weight}`;
    })
    .join(" / ");
  return (
    <Tooltip title={detail} placement="top">
      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
        {shown.map((p) => (
          <Chip
            key={p.label}
            size="small"
            variant="outlined"
            label={`${p.label} ${p.get(breakdown)}`}
            sx={{ height: 20, fontSize: 11 }}
          />
        ))}
      </Stack>
    </Tooltip>
  );
}

/** 「新規」または前期間比のバッジ。急上昇リストでのみ意味を持つ */
function TrendBadge({ isNew, ratio }: { isNew: boolean; ratio: number | null }) {
  if (isNew) {
    return (
      <Tooltip title="前の同じ期間には活動がありませんでした" placement="top">
        <Chip size="small" color="success" label="新規" sx={{ height: 20, fontSize: 11 }} />
      </Tooltip>
    );
  }
  if (ratio === null) return null;
  return (
    <Tooltip title="期間内スコア ÷ 前の同じ長さの期間のスコア" placement="top">
      <Chip
        size="small"
        color={ratio >= 1 ? "primary" : "default"}
        label={`×${ratio.toFixed(2)}`}
        sx={{ height: 20, fontSize: 11 }}
      />
    </Tooltip>
  );
}

/** 1件ぶんの行（アバター＋名前＋スコア＋内訳） */
function Row({
  rank,
  to,
  avatar,
  title,
  subtitle,
  score,
  previousScore,
  badge,
  breakdown,
}: {
  rank: number;
  to: string;
  avatar: string | null;
  title: string;
  subtitle: string;
  score: number;
  previousScore: number;
  badge: ReactNode;
  breakdown: ReactNode;
}) {
  return (
    <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ py: 0.75 }}>
      <Typography
        variant="caption"
        sx={{ width: 20, textAlign: "right", color: "text.secondary", mt: 0.75 }}
      >
        {rank}
      </Typography>
      <Avatar src={avatar ?? undefined} sx={{ width: 32, height: 32 }}>
        {title.slice(0, 1)}
      </Avatar>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
          <Link
            component={RouterLink}
            to={to}
            underline="hover"
            sx={{ fontWeight: 600, fontSize: 14 }}
          >
            {title}
          </Link>
          {badge}
        </Stack>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", wordBreak: "break-all" }}
        >
          {subtitle}
        </Typography>
        <Box sx={{ mt: 0.5 }}>{breakdown}</Box>
      </Box>
      <Tooltip title={`前の同じ期間のスコア: ${previousScore.toLocaleString()}`} placement="left">
        <Typography variant="subtitle2" fontWeight={700} sx={{ mt: 0.5, whiteSpace: "nowrap" }}>
          {score.toLocaleString()}
        </Typography>
      </Tooltip>
    </Stack>
  );
}

function ListCard({
  title,
  note,
  empty,
  children,
}: {
  title: string;
  note: string;
  empty: boolean;
  children: ReactNode;
}) {
  return (
    <Card variant="outlined" sx={{ flex: "1 1 340px", minWidth: 280 }}>
      <CardContent>
        <Typography variant="subtitle2" fontWeight={700}>
          {title}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {note}
        </Typography>
        <Divider sx={{ my: 1 }} />
        {empty ? (
          <Typography variant="caption" color="text.secondary">
            該当なし
          </Typography>
        ) : (
          <Stack divider={<Divider flexItem />}>{children}</Stack>
        )}
      </CardContent>
    </Card>
  );
}

function UserList({ items }: { items: TrendingUserItem[] }) {
  return (
    <>
      {items.map((u, i) => (
        <Row
          key={u.id}
          rank={i + 1}
          to={`/users/${u.handle}`}
          avatar={u.avatarUrl}
          title={u.name}
          subtitle={`@${u.handle}`}
          score={u.score}
          previousScore={u.previousScore}
          badge={<TrendBadge isNew={u.isNew} ratio={u.ratio} />}
          breakdown={<Breakdown parts={USER_PARTS} breakdown={u.breakdown} />}
        />
      ))}
    </>
  );
}

function CommunityList({ items }: { items: TrendingCommunityItem[] }) {
  return (
    <>
      {items.map((c, i) => (
        <Row
          key={c.id}
          rank={i + 1}
          to={`/c/${c.slug}`}
          avatar={c.iconUrl}
          title={c.name}
          subtitle={`/c/${c.slug}`}
          score={c.score}
          previousScore={c.previousScore}
          badge={<TrendBadge isNew={c.isNew} ratio={c.ratio} />}
          breakdown={<Breakdown parts={COMMUNITY_PARTS} breakdown={c.breakdown} />}
        />
      ))}
    </>
  );
}

/** スコアの重み一覧（画面の注記）。定数を直接並べるので実装とずれない */
function WeightNote({ parts }: { parts: { label: string; weight: number }[] }) {
  return (
    <Typography variant="caption" color="text.secondary">
      スコア = {parts.map((p) => `${p.label}×${p.weight}`).join(" + ")}
    </Typography>
  );
}

/** 運営管理者向け: 注目のユーザー / コミュニティ (#259 PR1)。
 * KPI と同じ期間セレクタだが「全期間」は無い（急上昇が前の同じ期間との比のため）ので、
 * KPI ダッシュボードとは別ページにしている */
export function AdminTrendingPage() {
  const isAdmin = useIsAdmin();
  const [days, setDays] = useState<number>(30);
  const { data, isLoading, isError } = useAdminTrending(days, isAdmin);

  if (!isAdmin) {
    return <Alert severity="warning">この画面は運営管理者専用です。</Alert>;
  }

  return (
    <Stack spacing={2.5}>
      <Typography
        variant="h5"
        fontWeight={700}
        sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
      >
        <LocalFireDepartmentIcon fontSize="medium" />
        注目（トレンド）
      </Typography>

      <ToggleButtonGroup
        size="small"
        exclusive
        value={days}
        onChange={(_e, v: number | null) => v !== null && setDays(v)}
      >
        {RANGES.map((d) => (
          <ToggleButton key={d} value={d}>
            {d}日
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      <Alert severity="info" sx={{ py: 0.5 }}>
        <strong>公開ランキングではありません。</strong>
        この画面は運営が「いま動きのある人・コミュニティ」を見つけるための内部指標で、
        ユーザーには公開されず、順位や点数を本人に知らせることもありません。
        スコアは期間内の行動の件数に重みを掛けて足したもので、場を作る側（主催・スタッフ）を
        厚く見ています。重みはゲーミフィケーションのXPと同じ思想で決めているため、
        XPと近い値になりますが別物です（たまご・フォロワーはXPには入りません）。
        「急上昇」は<strong>期間内スコア ÷ 前の同じ長さの期間のスコア</strong>で、
        前の期間に活動が無かったものは比が出せないため「新規」として先に並べます。
        小さな母数で倍率が跳ねないよう、期間内スコアが一定未満のものは急上昇に載せません。
        退会申請中のユーザーは除いています。
      </Alert>

      {isError ? (
        <Alert severity="error">
          注目の取得に失敗しました。時間をおいて再読み込みしてください。
        </Alert>
      ) : isLoading || !data ? (
        <Typography>読み込み中…</Typography>
      ) : (
        <>
          <PeriodNote data={data} />

          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle1" fontWeight={700}>
                ユーザー
              </Typography>
              <WeightNote parts={USER_PARTS} />
              <Divider sx={{ my: 1.5 }} />
              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                <ListCard
                  title="活動量 上位"
                  note="期間内スコアの高い順。大きく動いている人。"
                  empty={data.users.active.length === 0}
                >
                  <UserList items={data.users.active} />
                </ListCard>
                <ListCard
                  title="急上昇"
                  note={`前の同じ期間との比が高い順（新規が先）。期間内スコア ${data.minRisingScore.user} 未満は対象外。`}
                  empty={data.users.rising.length === 0}
                >
                  <UserList items={data.users.rising} />
                </ListCard>
              </Stack>
            </CardContent>
          </Card>

          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle1" fontWeight={700}>
                コミュニティ
              </Typography>
              <WeightNote parts={COMMUNITY_PARTS} />
              <Divider sx={{ my: 1.5 }} />
              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                <ListCard
                  title="活動量 上位"
                  note="期間内スコアの高い順。"
                  empty={data.communities.active.length === 0}
                >
                  <CommunityList items={data.communities.active} />
                </ListCard>
                <ListCard
                  title="急上昇"
                  note={`前の同じ期間との比が高い順（新規が先）。期間内スコア ${data.minRisingScore.community} 未満は対象外。`}
                  empty={data.communities.rising.length === 0}
                >
                  <CommunityList items={data.communities.rising} />
                </ListCard>
              </Stack>
            </CardContent>
          </Card>
        </>
      )}
    </Stack>
  );
}

function PeriodNote({ data }: { data: TrendingPayload }) {
  return (
    <Typography variant="caption" color="text.secondary">
      集計期間: {data.sinceDay} 〜 現在（{data.days}日） / 比較する前期間:{" "}
      {data.previousSinceDay} 〜 {data.sinceDay}
    </Typography>
  );
}
