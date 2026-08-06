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
  type TrendingCommunityItem,
  type TrendingCommunityWeights,
  type TrendingPayload,
  type TrendingUserItem,
  type TrendingUserWeights,
} from "@eventer/shared";
import { useIsAdmin } from "../api/hooks.js";
import { useAdminTrending } from "../api/analyticsHooks.js";
import { KpiNote } from "../components/KpiNote.js";
import { formatDateTime } from "../lib/format.js";

const RANGES = [7, 30, 90] as const;

/** 内訳の表示定義。ラベルと件数の取り出し方だけを持ち、**重みの値はレスポンスから取る**。
 * 画面のバンドルに重みを焼き込むと、古いバンドルのままスコアだけ新しい重みで返ってきた
 * ときに注記と実装がずれる。表示に使う定数はできるだけペイロード側に寄せる */
interface Part<B, W> {
  label: string;
  key: keyof W;
  get: (b: B) => number;
}

const USER_PARTS: Part<TrendingUserItem["breakdown"], TrendingUserWeights>[] = [
  { label: "主催", key: "hosted", get: (b) => b.hosted },
  { label: "スタッフ", key: "staffed", get: (b) => b.staffed },
  { label: "参加", key: "joined", get: (b) => b.joined },
  { label: "いいね", key: "likeReceived", get: (b) => b.likesReceived },
  { label: "出会い", key: "meet", get: (b) => b.meets },
  { label: "たまご投稿", key: "eggPosted", get: (b) => b.eggsPosted },
  { label: "賛同", key: "eggReaction", get: (b) => b.eggReactions },
  { label: "フォロワー", key: "followerGained", get: (b) => b.followersGained },
];

const COMMUNITY_PARTS: Part<
  TrendingCommunityItem["breakdown"],
  TrendingCommunityWeights
>[] = [
  { label: "開催", key: "heldEvent", get: (b) => b.heldEvents },
  { label: "延べ参加者", key: "participation", get: (b) => b.participations },
  { label: "新規メンバー", key: "newMember", get: (b) => b.newMembers },
  { label: "いいね", key: "likeReceived", get: (b) => b.likesReceived },
];

/** 内訳のチップ列。0 の項目は出さない（並べても読みにくいだけ）。
 * ツールチップにはスコアの計算式（件数 × 重み）と合計を出す。
 * 合計を出すのは、右に表示しているスコアと突き合わせられるようにするため */
function Breakdown<B, W extends Record<string, number>>({
  parts,
  weights,
  breakdown,
  score,
}: {
  parts: Part<B, W>[];
  weights: W;
  breakdown: B;
  score: number;
}) {
  const shown = parts.filter((p) => p.get(breakdown) > 0);
  if (shown.length === 0) return null;
  const detail = `${shown
    .map((p) => {
      const n = p.get(breakdown);
      const w = weights[p.key];
      return `${p.label} ${n} × ${w} = ${n * w}`;
    })
    .join(" / ")} → 合計 ${score.toLocaleString()}`;
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

/** 前期間比と「新規」のバッジ。**急上昇リストでのみ**出す。
 * 活動量上位は比を持たない（ratio は常に null）ので、そちらで「新規」だけが
 * 出ると「比の話をしているリスト」に見えてしまう。
 *
 * 「新規」は前の期間に活動が無かったという情報表示だけで、順位には効かない
 * （平滑化のおかげで前期間0でも比が定まるため、他と同じ式で並んでいる） */
function TrendBadge({
  isNew,
  ratio,
  smoothing,
}: {
  isNew: boolean;
  ratio: number | null;
  smoothing: number;
}) {
  if (ratio === null) return null;
  return (
    <>
      <Tooltip
        title={`（期間内スコア + ${smoothing}）÷（前の同じ長さの期間のスコア + ${smoothing}）。小さな母数で倍率が跳ねないよう両辺に ${smoothing} を足しています`}
        placement="top"
      >
        <Chip
          size="small"
          color="primary"
          label={`×${ratio.toFixed(2)}`}
          sx={{ height: 20, fontSize: 11 }}
        />
      </Tooltip>
      {isNew ? (
        <Tooltip
          title="前の同じ期間には活動がありませんでした（順位はこの左の比で決まります）"
          placement="top"
        >
          <Chip
            size="small"
            color="success"
            label="新規"
            sx={{ height: 20, fontSize: 11 }}
          />
        </Tooltip>
      ) : null}
    </>
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

/** rising=true のときだけ「×N」「新規」のバッジを出す（活動量上位では出さない） */
function UserList({
  items,
  weights,
  smoothing,
  rising = false,
}: {
  items: TrendingUserItem[];
  weights: TrendingUserWeights;
  smoothing: number;
  rising?: boolean;
}) {
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
          badge={
            rising ? (
              <TrendBadge isNew={u.isNew} ratio={u.ratio} smoothing={smoothing} />
            ) : null
          }
          breakdown={
            <Breakdown
              parts={USER_PARTS}
              weights={weights}
              breakdown={u.breakdown}
              score={u.score}
            />
          }
        />
      ))}
    </>
  );
}

function CommunityList({
  items,
  weights,
  smoothing,
  rising = false,
}: {
  items: TrendingCommunityItem[];
  weights: TrendingCommunityWeights;
  smoothing: number;
  rising?: boolean;
}) {
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
          badge={
            rising ? (
              <TrendBadge isNew={c.isNew} ratio={c.ratio} smoothing={smoothing} />
            ) : null
          }
          breakdown={
            <Breakdown
              parts={COMMUNITY_PARTS}
              weights={weights}
              breakdown={c.breakdown}
              score={c.score}
            />
          }
        />
      ))}
    </>
  );
}

/** スコアの重み一覧（画面の注記）。重みはレスポンスの値を出すので実装とずれない */
function WeightNote<B, W extends Record<string, number>>({
  parts,
  weights,
}: {
  parts: Part<B, W>[];
  weights: W;
}) {
  return (
    <Typography variant="caption" color="text.secondary">
      スコア = {parts.map((p) => `${p.label}×${weights[p.key]}`).join(" + ")}
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

      <KpiNote summary="スコアと急上昇の決め方">
        <strong>公開ランキングではありません。</strong>
        この画面は運営が「いま動きのある人・コミュニティ」を見つけるための内部指標で、
        ユーザーには公開されず、順位や点数を本人に知らせることもありません。
        スコアは期間内の行動の件数に重みを掛けて足したもので、場を作る側（主催・スタッフ）を
        厚く見ています。重みはゲーミフィケーションのXPと同じ思想で決めているため、
        XPと近い値になりますが別物です（たまご・フォロワーはXPには入りません）。
        「急上昇」は
        <strong>（期間内スコア + K）÷（前の同じ長さの期間のスコア + K）</strong>
        の高い順で、小さな母数で倍率が跳ねないよう分母・分子に同じ K を足しています（K
        の値は各リストの注記に出しています）。
        前の期間に活動が無かったもの（「新規」）も同じ式で比が出るので特別扱いはせず、
        「新規」バッジは順位ではなく状態の表示です。
        期間内スコアが一定未満のもの・比が1未満（前の期間より縮んだもの）は載せません。
        退会申請中のユーザーは除いています。
      </KpiNote>

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
              <WeightNote parts={USER_PARTS} weights={data.weights.user} />
              <Divider sx={{ my: 1.5 }} />
              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                <ListCard
                  title="活動量 上位"
                  note="期間内スコアの高い順。大きく動いている人。"
                  empty={data.users.active.length === 0}
                >
                  <UserList
                    items={data.users.active}
                    weights={data.weights.user}
                    smoothing={data.ratioSmoothing.user}
                  />
                </ListCard>
                <ListCard
                  title="急上昇"
                  note={`前の同じ期間との比（平滑化 K=${data.ratioSmoothing.user}）が高い順。期間内スコア ${data.minRisingScore.user} 未満・比 ${data.minRisingRatio} 未満は対象外。`}
                  empty={data.users.rising.length === 0}
                >
                  <UserList
                    items={data.users.rising}
                    weights={data.weights.user}
                    smoothing={data.ratioSmoothing.user}
                    rising
                  />
                </ListCard>
              </Stack>
            </CardContent>
          </Card>

          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle1" fontWeight={700}>
                コミュニティ
              </Typography>
              <WeightNote
                parts={COMMUNITY_PARTS}
                weights={data.weights.community}
              />
              <Divider sx={{ my: 1.5 }} />
              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                <ListCard
                  title="活動量 上位"
                  note="期間内スコアの高い順。"
                  empty={data.communities.active.length === 0}
                >
                  <CommunityList
                    items={data.communities.active}
                    weights={data.weights.community}
                    smoothing={data.ratioSmoothing.community}
                  />
                </ListCard>
                <ListCard
                  title="急上昇"
                  note={`前の同じ期間との比（平滑化 K=${data.ratioSmoothing.community}）が高い順。期間内スコア ${data.minRisingScore.community} 未満・比 ${data.minRisingRatio} 未満は対象外。`}
                  empty={data.communities.rising.length === 0}
                >
                  <CommunityList
                    items={data.communities.rising}
                    weights={data.weights.community}
                    smoothing={data.ratioSmoothing.community}
                    rising
                  />
                </ListCard>
              </Stack>
            </CardContent>
          </Card>
        </>
      )}
    </Stack>
  );
}

/** 集計期間の注記。日境界ではなく「読み込んだ時刻から遡って N 日」なので、
 * 日付だけでなく時刻まで出す（比を出す指標なので前期間と長さが厳密に同じ） */
function PeriodNote({ data }: { data: TrendingPayload }) {
  return (
    <Typography variant="caption" color="text.secondary">
      集計期間: 直近{data.days}日（{formatDateTime(data.since)} 〜{" "}
      {formatDateTime(data.until)}） / 比較する前期間: 同じ長さの直前の
      {data.days}日（{formatDateTime(data.previousSince)} 〜{" "}
      {formatDateTime(data.since)}）
    </Typography>
  );
}
