import { useState } from "react";
import {
  Alert,
  Box,
  Card,
  CardContent,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import InsightsIcon from "@mui/icons-material/Insights";
import type { KpiPayload } from "@eventer/shared";
import { useIsAdmin } from "../api/hooks.js";
import { useAdminKpi } from "../api/analyticsHooks.js";
import { KpiNote } from "../components/KpiNote.js";
import { InfoTip } from "../components/InfoTip.js";
import {
  FullWidth,
  MiniBars,
  Section,
  Tile,
  num,
  pct,
} from "../components/KpiTiles.js";

const RANGES: { label: string; days: number | null }[] = [
  { label: "7日", days: 7 },
  { label: "30日", days: 30 },
  { label: "90日", days: 90 },
  { label: "全期間", days: null },
];

/** 運営管理者向け: サービス全体のKPIダッシュボード (#257) */
export function AdminKpiPage() {
  const isAdmin = useIsAdmin();
  const [range, setRange] = useState<number | null>(30);
  const { data, isLoading, isError } = useAdminKpi(range, isAdmin);

  if (!isAdmin) {
    return <Alert severity="warning">この画面は運営管理者専用です。</Alert>;
  }

  return (
    <Stack spacing={2}>
      <Typography
        variant="h5"
        fontWeight={700}
        sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
      >
        <InsightsIcon fontSize="medium" />
        KPI ダッシュボード
      </Typography>

      <ToggleButtonGroup
        size="small"
        exclusive
        value={range ?? "all"}
        onChange={(_e, v) => v !== null && setRange(v === "all" ? null : v)}
      >
        {RANGES.map((r) => (
          <ToggleButton key={r.label} value={r.days ?? "all"}>
            {r.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      <KpiNote>
        いま計測できているデータのみを表示しています。サイト全体のPV・DAU/MAU・
        各ファネルの到達数・検索需要・メール到達は未計測です（今後対応）。
        参加登録の数え方は「アクセス統計（全イベント）」ページと異なります。この画面は
        主催・スタッフの行（イベント作成時に自動で作られます）・下書きイベント・
        退会申請中ユーザーを除くため、あちらより少なく出ます。審査員・観覧者は
        実際にイベントに来る人なので参加者として数えます。ロールは後から変更できるため、
        参加者をスタッフに変えると過去の数字も遡って変わります。
      </KpiNote>

      {isError ? (
        <Alert severity="error">
          KPI の取得に失敗しました。時間をおいて再読み込みしてください。
        </Alert>
      ) : isLoading || !data ? (
        <Typography>読み込み中…</Typography>
      ) : (
        <>
          <NorthStarSection data={data} />
          <ParticipantsSection data={data} />
          <OrganizersSection data={data} />
          <RetentionSection data={data} />
          <HealthSection data={data} />
          <MatchingSection data={data} />
        </>
      )}
    </Stack>
  );
}

/* ---------------- セクション ---------------- */

function NorthStarSection({ data }: { data: KpiPayload }) {
  const n = data.northStar;
  return (
    <Section
      title="北極星指標"
      note="実際に人が集まった参加体験の数。開催済みイベント（期間内に終了した公開イベント）の確定参加者の合計で、出席チェックを実施したイベントは出席者数、未実施は確定登録者数を数えます。イベントページに出る参加者数と同じ定義のため、主催・スタッフを含みます。出席チェックを有効にしたのに記録を取らなかったイベントは、参加者が主催・スタッフ分しか乗らないため実態より少なく出ます。"
    >
      <Tile
        label="参加体験の数"
        value={n.participations}
        hint={`開催済みイベントの確定参加者の合計（主催・スタッフを含む）。主催・スタッフを除くと ${n.heldParticipants.toLocaleString()}`}
        big
      />
      <Tile
        label="開催イベント数"
        value={n.heldEvents}
        hint="期間内に終了した公開イベント（日程確定済み・開催日設定済み）"
      />
      <Tile
        label="1イベントあたり平均参加者"
        text={num(n.avgParticipantsPerEvent)}
        hint="参加体験の数 ÷ 開催イベント数"
      />
    </Section>
  );
}

function ParticipantsSection({ data }: { data: KpiPayload }) {
  const p = data.participants;
  return (
    <Section
      title="参加者（需要側）"
      note="閲覧はイベント詳細ページのみの計測です。登録・キャンセルは「登録が作成された日」、出席は「イベントが終了した日」で期間を切っています。数えるのは主催・スタッフを除いた行で、審査員・観覧者は参加者として含みます（下書きイベントは含みません）。キャンセルは、取り消したあと同じイベントに再参加すると行が再利用されるため構造的に少なめに出ます。"
    >
      <Tile
        label="参加登録数"
        value={p.registrations}
        hint="期間内に作成された登録（取消を含む全ステータス。主催・スタッフを除き、審査員・観覧者は含む）"
      />
      <Tile
        label="うち確定"
        value={p.confirmedRegistrations}
        hint="いま確定状態の登録"
      />
      <Tile
        label="イベント詳細の閲覧UU"
        value={p.uniqueViewers}
        hint="訪問者Cookieで重複排除。全イベント横断"
      />
      <Tile
        label="閲覧→登録の転換率"
        text={pct(p.viewToJoinRate)}
        hint="イベント閲覧UUに対する概算。分母は期間全体の全イベント横断のUUで、一覧やお知らせなど詳細ページを経由しない登録も分子に入るため100%を超えることがあります"
      />
      <Tile
        label="出席率"
        text={pct(p.attendanceRate)}
        hint={`出席 ${p.attended} ÷ 出席チェック実施イベントの確定参加者 ${p.attendanceExpected}`}
      />
      <Tile
        label="無断欠席率"
        text={pct(p.noShowRate)}
        hint="登録したのに出席チェックされなかった割合"
      />
      <Tile
        label="キャンセル率"
        text={pct(p.cancelRate)}
        hint={`取消 ${p.canceled} ÷ 期間内の登録 ${p.registrations}（日程調整中の取消は除外。再参加すると取消の記録は消える）`}
      />
      <Tile
        label="うち直前24時間"
        text={`${p.canceledLate} / ${p.canceled}`}
        hint={`事前の取消は ${p.canceledEarly} 件。直前率 ${pct(p.lateCancelRate)}`}
      />
      <Tile
        label="リピート参加率"
        text={pct(p.repeatRate)}
        hint={`2回以上参加 ${p.repeatParticipants} ÷ 参加した実人数 ${p.uniqueParticipants}`}
      />
      <FullWidth>
        <MiniBars
          title="参加回数の分布"
          hint="期間内に開催されたイベントへの参加回数"
          items={p.countDistribution.map((b) => ({
            label: b.label,
            value: b.users,
          }))}
          unit="人"
        />
      </FullWidth>
    </Section>
  );
}

function OrganizersSection({ data }: { data: KpiPayload }) {
  const o = data.organizers;
  return (
    <Section
      title="主催者（供給側）"
      note="作成・公開は「イベントの作成日」、開催・再開催は「イベントの終了日」で期間を切っています。不発率は、出席チェックを有効にしたのに記録が1件も無いイベント（＝出席未記録）を分母から除いています。イベント作成画面への到達数は未計測のため、着手→作成の転換率は出せません。"
    >
      <Tile
        label="イベント作成数"
        value={o.createdEvents}
        hint="期間内に作成されたイベント（全ステータス）"
      />
      <Tile label="うち下書き" value={o.draftEvents} hint="未公開のまま" />
      <Tile label="うち公開" value={o.publishedEvents} hint="公開済み" />
      <Tile
        label="日程調整中"
        value={o.schedulingEvents}
        hint="公開済みだが開催日が未確定"
      />
      <Tile
        label="日程確定率"
        text={pct(o.schedulingConfirmRate)}
        hint={`確定 ${o.schedulingConfirmedEvents} ÷ 候補日を使ったイベント ${o.schedulingUsedEvents}`}
      />
      <Tile
        label="開催完了数"
        value={o.heldEvents}
        hint="期間内に終了した公開イベント（日程確定済み・開催日設定済み）"
      />
      <Tile
        label="不発率"
        text={pct(o.dudRate)}
        hint={`参加者3人以下 ${o.dudEvents} ÷ ${o.dudBaseEvents}（主催・スタッフを除いた人数で判定）。開催完了 ${o.heldEvents} のうち出席未記録 ${o.attendanceUnrecordedEvents} 件は判定できないため除外`}
      />
      <Tile
        label="主催者数"
        value={o.hosts}
        hint="期間内にイベントを開催した実人数（退会申請中を除く）"
      />
      <Tile
        label="再開催率"
        text={pct(o.repeatHostRate)}
        hint={`2回以上開催 ${o.repeatHosts} ÷ 主催者数 ${o.hosts}`}
      />
      <Tile
        label="主催者あたり開催数"
        text={num(o.avgEventsPerHost)}
        hint={`在籍主催者の開催 ${o.heldEventsWithActiveHost} ÷ 主催者数 ${o.hosts}（開催完了 ${o.heldEvents} には退会申請中の主催者の分も含む）`}
      />
    </Section>
  );
}

function RetentionSection({ data }: { data: KpiPayload }) {
  const r = data.retention;
  return (
    <Section
      title="定着"
      note="退会申請中のユーザーは分母から除いています。「初回参加」は参加者（審査員・観覧者を含む）として登録した人だけで、主催しただけの人は含みません（参加も主催もした人は両方に数えるため、2つの率の合計は100%を超えることがあります）。DAU/WAU/MAU と登録後の残存率（コホート）は最終アクセスを記録していないため未計測です（今後対応）。"
    >
      <Tile
        label="新規登録者数"
        value={r.signups}
        hint="期間内にアカウントを作った人"
      />
      <Tile
        label="登録→初回参加"
        text={pct(r.activationParticipantRate)}
        hint={`公開イベントに参加者（審査員・観覧者を含む）として登録したことがある ${r.activatedParticipant} ÷ 新規登録 ${r.signups}`}
      />
      <Tile
        label="登録→初回主催"
        text={pct(r.activationHostRate)}
        hint={`公開イベントを主催したことがある ${r.activatedHost} ÷ 新規登録 ${r.signups}`}
      />
      <Tile
        label="在籍ユーザー数"
        value={r.activeUsers}
        hint="現在の総数（期間によらない）"
      />
      <FullWidth>
        <TrendChart daily={r.daily} />
      </FullWidth>
    </Section>
  );
}

function HealthSection({ data }: { data: KpiPayload }) {
  const h = data.health;
  return (
    <Section
      title="健全性"
      note="機能利用率の分母は「期間内に作成された公開イベント」です。通報件数（機能未実装）・問い合わせの初回応答時間・メール到達は未計測です。"
    >
      <Tile label="退会申請数" value={h.deleteRequested} hint="期間内の申請" />
      <Tile
        label="完全削除数"
        value={h.deleteCompleted}
        hint="猶予期間を過ぎて削除された件数"
      />
      <Tile
        label="猶予期間中の復帰数"
        value={h.restored}
        hint="申請を取り消して戻ってきた件数"
      />
      <Tile
        label="退会申請中"
        value={h.pendingDeletion}
        hint="現在の猶予期間中ユーザー（期間によらない）"
      />
      <Tile
        label="チャット利用率"
        text={pct(h.chatUsedRate)}
        hint={`チャンネルが作られたイベント ${h.chatUsedEvents} ÷ 公開イベント ${h.featureEvents}`}
      />
      <Tile
        label="アンケート利用率"
        text={pct(h.surveyUsedRate)}
        hint={`設問があるイベント ${h.surveyUsedEvents} ÷ 公開イベント ${h.featureEvents}`}
      />
      <Tile
        label="チェックイン利用率"
        text={pct(h.checkinUsedRate)}
        hint={`出席チェックを有効にしたイベント ${h.checkinUsedEvents} ÷ 公開イベント ${h.featureEvents}`}
      />
      <FullWidth>
        <MiniBars
          title="ログイン方法の内訳"
          hint="在籍ユーザーの現在の連携。期間によらない"
          items={h.providers.map((p) => ({
            label: p.provider,
            value: p.users,
          }))}
          unit="人"
        />
      </FullWidth>
    </Section>
  );
}

function MatchingSection({ data }: { data: KpiPayload }) {
  const m = data.matching;
  return (
    <Section
      title="マッチング"
      note="会場オファーとたまご（イベントのリクエスト）。期間はオファー・たまごの作成日で切っています。"
    >
      <Tile
        label="会場オファー数"
        value={m.venueOffers}
        hint={`承諾 ${m.venueOffersAccepted} / 辞退 ${m.venueOffersDeclined} / 未回答 ${m.venueOffersPending}`}
      />
      <Tile
        label="オファー成立率"
        text={pct(m.venueOfferAcceptRate)}
        hint="承諾 ÷ オファー数"
      />
      <Tile
        label="会場募集の充足率"
        text={pct(m.venueWantedFillRate)}
        hint={`会場が決まった ${m.venueWantedFilled} ÷ 会場募集中で作成 ${m.venueWantedEvents}`}
      />
      <Tile label="たまご投稿数" value={m.eggs} hint="期間内に投稿されたもの" />
      <Tile
        label="たまごの賛同数"
        value={m.eggAttendReactions + m.eggHostReactions}
        hint={`参加したい ${m.eggAttendReactions} / 開催してもいい ${m.eggHostReactions}。1件あたり ${num(m.avgReactionsPerEgg)}`}
      />
      <Tile
        label="たまごのイベント化率"
        text={pct(m.eggConversionRate)}
        hint={`イベント化 ${m.eggsConverted} ÷ たまご投稿数 ${m.eggs}`}
      />
    </Section>
  );
}

/* ---------------- 部品 ---------------- */

/** 日別の推移（新規登録 / 参加登録）。既存の統計ページと同じ素朴な棒グラフ。
 * 2系列を同じチャートに描くので目盛りは共通にする（系列ごとに正規化すると
 * 同じ高さの棒が違う値を意味してしまう） */
function TrendChart({ daily }: { daily: KpiPayload["retention"]["daily"] }) {
  const max = Math.max(1, ...daily.map((d) => Math.max(d.signups, d.joins)));
  return (
    <Card variant="outlined" sx={{ width: "100%" }}>
      <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
          <Stack direction="row" spacing={0.25} alignItems="center" sx={{ flex: 1, minWidth: 120 }}>
            <Typography variant="subtitle2">日別の推移</Typography>
            <InfoTip
              label="日別の推移"
              text="「確定参加登録」は確定状態の登録だけを数えます。上の「参加登録数」は取消も含む全ステータスなので合計は一致しません。"
            />
          </Stack>
          <SeriesLabel color="primary.main" text="新規登録" />
          <SeriesLabel color="secondary.main" text="確定参加登録" />
        </Stack>
        {daily.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            データなし
          </Typography>
        ) : (
          <Box
            sx={{
              display: "flex",
              alignItems: "flex-end",
              gap: 0.75,
              height: 150,
              overflowX: "auto",
            }}
          >
            {daily.map((d) => (
              <Box
                key={d.day}
                title={`${d.day}  新規登録:${d.signups} / 確定参加登録:${d.joins}`}
                sx={{
                  flex: "1 0 20px",
                  minWidth: 20,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 0.5,
                }}
              >
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "flex-end",
                    justifyContent: "center",
                    gap: "2px",
                    height: 110,
                    width: "100%",
                  }}
                >
                  <Box
                    sx={{
                      width: 8,
                      height: `${(d.signups / max) * 110}px`,
                      bgcolor: "primary.main",
                      borderRadius: "2px 2px 0 0",
                      minHeight: d.signups > 0 ? 2 : 0,
                    }}
                  />
                  <Box
                    sx={{
                      width: 8,
                      height: `${(d.joins / max) * 110}px`,
                      bgcolor: "secondary.main",
                      borderRadius: "2px 2px 0 0",
                      minHeight: d.joins > 0 ? 2 : 0,
                    }}
                  />
                </Box>
                <Typography
                  sx={{ fontSize: 9, color: "text.secondary", whiteSpace: "nowrap" }}
                >
                  {d.day.slice(5)}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

function SeriesLabel({ color, text }: { color: string; text: string }) {
  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <Box sx={{ width: 10, height: 10, borderRadius: "2px", bgcolor: color }} />
      <Typography variant="caption">{text}</Typography>
    </Stack>
  );
}
