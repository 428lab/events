import { useState } from "react";
import {
  Alert,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import InsightsIcon from "@mui/icons-material/Insights";
import {
  type KpiMetricKey,
  type KpiPayload,
  type KpiSeriesPoint,
  type KpiTrend,
  addDays,
  kpiTrend,
} from "@eventer/shared";
import { useIsAdmin } from "../api/hooks.js";
import { useAdminKpi } from "../api/analyticsHooks.js";
import { KpiNote } from "../components/KpiNote.js";
import {
  FullWidth,
  MiniBars,
  Section,
  Tile,
  TrendChart,
  longDay,
  num,
  pct,
} from "../components/KpiTiles.js";

/** 期間の選択肢。90日までは日別/週別、1年・全期間は月別になる
 * （粒度の切り替えは kpiGranularity が点数で決める #292）。
 * コミュニティ別KPI (#262) と同じ並びにしている */
const RANGES: { label: string; days: number | null }[] = [
  { label: "7日", days: 7 },
  { label: "30日", days: 30 },
  { label: "90日", days: 90 },
  { label: "1年", days: 365 },
  { label: "全期間", days: null },
];

/** 前期間比を引くための入口。方向（増えたら良いか）の定義は
 * @eventer/shared の KPI_METRICS が1箇所で持っている (#266)。
 * 全期間を選んだときは previous が null なので、どの指標も何も出さない */
function trendOf(
  data: KpiPayload,
  key: KpiMetricKey,
  current: number | null,
): KpiTrend | null {
  return kpiTrend(key, current, data.previous?.[key]);
}

/** 日次推移をグラフ用の形に。系列の値は day ごとに1レコードにまとめる */
function seriesPoints(data: KpiPayload): KpiSeriesPoint[] {
  return data.retention.daily.map((d) => ({
    day: d.day,
    values: {
      signups: d.signups,
      joins: d.joins,
      heldEvents: d.heldEvents,
      participations: d.participations,
      dau: d.dau,
      mau: d.mau,
    },
  }));
}

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
        いま計測できているデータのみを表示しています。サイト全体のPV・各ファネルの
        到達数・検索需要・メール到達は未計測です（今後対応）。
        各数字の下の「前期間」は、同じ長さのひとつ前の期間との比較です。増えたら良い指標と
        減ったら良い指標（キャンセル率・不発率・退会数など）で色の向きを変えています。
        全期間を選ぶと比べる過去が無いため出しません。
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
      note="実際に人が集まった参加体験の数。開催済みイベント（期間内に終了した公開イベント）の確定参加者の合計で、出席チェックを実施したイベントは出席者数、未実施は確定登録者数を数えます。イベントページに出る参加者数と同じ定義のため、主催・スタッフを含みます。出席チェックを有効にしたのに記録を取らなかったイベントは、参加者が主催・スタッフ分しか乗らないため実態より少なく出ます。推移は「イベントが終了した日」に立てています。"
    >
      <Tile
        label="参加体験の数"
        value={n.participations}
        hint={`開催済みイベントの確定参加者の合計（主催・スタッフを含む）。主催・スタッフを除くと ${n.heldParticipants.toLocaleString()}`}
        trend={trendOf(data, "participations", n.participations)}
        big
      />
      <Tile
        label="開催イベント数"
        value={n.heldEvents}
        hint="期間内に終了した公開イベント（日程確定済み・開催日設定済み）"
        trend={trendOf(data, "heldEvents", n.heldEvents)}
      />
      <Tile
        label="1イベントあたり平均参加者"
        text={num(n.avgParticipantsPerEvent)}
        hint="参加体験の数 ÷ 開催イベント数"
        trend={trendOf(
          data,
          "avgParticipantsPerEvent",
          n.avgParticipantsPerEvent,
        )}
      />
      {/* 参加体験の数は開催イベント数より桁がひとつ大きい。同じ目盛りに並べると
          開催イベント数の棒が潰れて読めないので、チャートを分ける */}
      <FullWidth>
        <TrendChart
          title="参加体験の推移"
          hint="イベントが終了した日に立てています。主催・スタッフを含む合計です。"
          points={seriesPoints(data)}
          series={[
            { key: "participations", label: "参加体験の数", color: "primary.main" },
          ]}
          unit="人"
        />
      </FullWidth>
      <FullWidth>
        <TrendChart
          title="開催イベント数の推移"
          hint="イベントが終了した日に立てています。参加体験の数とは桁が違うため、別のグラフにしています。"
          points={seriesPoints(data)}
          series={[
            { key: "heldEvents", label: "開催イベント数", color: "secondary.main" },
          ]}
          unit="件"
        />
      </FullWidth>
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
        hint="期間内に作成された登録（取消を含む全ステータス。主催・スタッフを除き、審査員・観覧者は含む）。取消も含むため、増えたことが良いとは限りません"
        trend={trendOf(data, "registrations", p.registrations)}
      />
      <Tile
        label="うち確定"
        value={p.confirmedRegistrations}
        hint="いま確定状態の登録"
        trend={trendOf(data, "confirmedRegistrations", p.confirmedRegistrations)}
      />
      <Tile
        label="イベント詳細の閲覧UU"
        value={p.uniqueViewers}
        hint="訪問者Cookieで重複排除。全イベント横断"
        trend={trendOf(data, "uniqueViewers", p.uniqueViewers)}
      />
      <Tile
        label="閲覧→登録の転換率"
        text={pct(p.viewToJoinRate)}
        hint="イベント閲覧UUに対する概算。分母は期間全体の全イベント横断のUUで、一覧やお知らせなど詳細ページを経由しない登録も分子に入るため100%を超えることがあります"
        trend={trendOf(data, "viewToJoinRate", p.viewToJoinRate)}
      />
      <Tile
        label="出席率"
        text={pct(p.attendanceRate)}
        hint={`出席 ${p.attended} ÷ 出席チェック実施イベントの確定参加者 ${p.attendanceExpected}`}
        trend={trendOf(data, "attendanceRate", p.attendanceRate)}
      />
      <Tile
        label="無断欠席率"
        text={pct(p.noShowRate)}
        hint="登録したのに出席チェックされなかった割合。減ったら良い指標なので、下がったときを緑にしています"
        trend={trendOf(data, "noShowRate", p.noShowRate)}
      />
      <Tile
        label="キャンセル率"
        text={pct(p.cancelRate)}
        hint={`取消 ${p.canceled} ÷ 期間内の登録 ${p.registrations}（日程調整中の取消は除外。再参加すると取消の記録は消える）。減ったら良い指標なので、下がったときを緑にしています`}
        trend={trendOf(data, "cancelRate", p.cancelRate)}
      />
      {/* 前期間比がポイント差なので、値も率にして単位を揃える
          （件数を出して増減だけ pt で出すと、何が何 pt 動いたのか読み違える） */}
      <Tile
        label="うち直前24時間の割合"
        text={pct(p.lateCancelRate)}
        hint={`直前24時間の取消 ${p.canceledLate} ÷ 取消 ${p.canceled}（事前の取消は ${p.canceledEarly} 件）。減ったら良い指標なので、下がったときを緑にしています`}
        trend={trendOf(data, "lateCancelRate", p.lateCancelRate)}
      />
      <Tile
        label="リピート参加率"
        text={pct(p.repeatRate)}
        hint={`2回以上参加 ${p.repeatParticipants} ÷ 参加した実人数 ${p.uniqueParticipants}`}
        trend={trendOf(data, "repeatRate", p.repeatRate)}
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
        trend={trendOf(data, "createdEvents", o.createdEvents)}
      />
      <Tile
        label="うち下書き"
        value={o.draftEvents}
        hint="未公開のまま。多い/少ないのどちらが良いとも言えないため色は付けません"
        trend={trendOf(data, "draftEvents", o.draftEvents)}
      />
      <Tile
        label="うち公開"
        value={o.publishedEvents}
        hint="公開済み"
        trend={trendOf(data, "publishedEvents", o.publishedEvents)}
      />
      <Tile
        label="日程調整中"
        value={o.schedulingEvents}
        hint="公開済みだが開催日が未確定。活発とも確定できていないとも読めるため色は付けません"
        trend={trendOf(data, "schedulingEvents", o.schedulingEvents)}
      />
      <Tile
        label="日程確定率"
        text={pct(o.schedulingConfirmRate)}
        hint={`確定 ${o.schedulingConfirmedEvents} ÷ 候補日を使ったイベント ${o.schedulingUsedEvents}`}
        trend={trendOf(data, "schedulingConfirmRate", o.schedulingConfirmRate)}
      />
      <Tile
        label="開催完了数"
        value={o.heldEvents}
        hint="期間内に終了した公開イベント（日程確定済み・開催日設定済み）"
        trend={trendOf(data, "heldEvents", o.heldEvents)}
      />
      <Tile
        label="不発率"
        text={pct(o.dudRate)}
        hint={`参加者3人以下 ${o.dudEvents} ÷ ${o.dudBaseEvents}（主催・スタッフを除いた人数で判定）。開催完了 ${o.heldEvents} のうち出席未記録 ${o.attendanceUnrecordedEvents} 件は判定できないため除外。減ったら良い指標なので、下がったときを緑にしています`}
        trend={trendOf(data, "dudRate", o.dudRate)}
      />
      <Tile
        label="主催者数"
        value={o.hosts}
        hint="期間内にイベントを開催した実人数（退会申請中を除く）"
        trend={trendOf(data, "hosts", o.hosts)}
      />
      <Tile
        label="再開催率"
        text={pct(o.repeatHostRate)}
        hint={`2回以上開催 ${o.repeatHosts} ÷ 主催者数 ${o.hosts}`}
        trend={trendOf(data, "repeatHostRate", o.repeatHostRate)}
      />
      <Tile
        label="主催者あたり開催数"
        text={num(o.avgEventsPerHost)}
        hint={`在籍主催者の開催 ${o.heldEventsWithActiveHost} ÷ 主催者数 ${o.hosts}（開催完了 ${o.heldEvents} には退会申請中の主催者の分も含む）`}
        trend={trendOf(data, "avgEventsPerHost", o.avgEventsPerHost)}
      />
    </Section>
  );
}

/** MAU が立ち上がり途中かどうかの注記。計測開始 (#257) から30日は窓が埋まらない。
 *
 * 「いつから計測しているか」「この期間に計測データがあるか」はグラフ側が
 * measuredFrom から出す (#292)。ここは**それだけでは分からない**こと
 * ＝「値は出ているが窓が埋まりきっていないので低く出る」だけを言う。 */
function mauCaution(measuredFrom: string | null, latestDay: string | undefined) {
  if (measuredFrom === null) return undefined;
  const full = addDays(measuredFrom, 29);
  if (latestDay && latestDay < full) {
    return `MAU は「直近30日にアクセスした人数」なので、計測開始（${longDay(measuredFrom)}）から30日たつ ${longDay(full)} までは窓が埋まりきらず実態より低く出ます。`;
  }
  return undefined;
}

function RetentionSection({ data }: { data: KpiPayload }) {
  const r = data.retention;
  const points = seriesPoints(data);
  return (
    <Section
      title="定着"
      note="退会申請中のユーザーは分母から除いています。「初回参加」は参加者（審査員・観覧者を含む）として登録した人だけで、主催しただけの人は含みません（参加も主催もした人は両方に数えるため、2つの率の合計は100%を超えることがあります）。DAU/MAU はアクセスの記録から算出しています（記録を始める前の期間は出ません）。登録後の残存率（コホート）は未対応です。"
    >
      <Tile
        label="新規登録者数"
        value={r.signups}
        hint="期間内にアカウントを作った人"
        trend={trendOf(data, "signups", r.signups)}
      />
      {/* 前期間比は出さない。分子が「これまでに1度でも参加/主催したか」で期間の
          縛りが無く、前期間に登録した人ほど猶予が長いため、横ばいでも必ず
          「悪化」に寄って誤読させる（詳細は kpi.ts の previousValues のコメント） */}
      <Tile
        label="登録→初回参加"
        text={pct(r.activationParticipantRate)}
        hint={`公開イベントに参加者（審査員・観覧者を含む）として登録したことがある ${r.activatedParticipant} ÷ 新規登録 ${r.signups}。登録が新しい人ほど参加する時間が短いため、前期間との比較は出していません`}
      />
      <Tile
        label="登録→初回主催"
        text={pct(r.activationHostRate)}
        hint={`公開イベントを主催したことがある ${r.activatedHost} ÷ 新規登録 ${r.signups}。登録が新しい人ほど主催する時間が短いため、前期間との比較は出していません`}
      />
      <Tile
        label="在籍ユーザー数"
        value={r.activeUsers}
        hint="現在の総数（期間によらないので前期間比は出しません）"
      />
      <FullWidth>
        <TrendChart
          title="新規登録・確定参加登録の推移"
          hint="「確定参加登録」は確定状態の登録だけを数えます。上の「参加登録数」は取消も含む全ステータスなので合計は一致しません。"
          points={points}
          series={[
            { key: "signups", label: "新規登録", color: "primary.main" },
            { key: "joins", label: "確定参加登録", color: "secondary.main" },
          ]}
        />
      </FullWidth>
      {/* MAU は DAU のおよそ30倍になるため、同じ目盛りに並べると DAU が潰れる。
          別のグラフにして、それぞれの目盛りで読めるようにする */}
      <FullWidth>
        <TrendChart
          title="MAU の推移"
          hint="その日を含む直近30日にアクセスした実人数です。週別・月別表示では期末（週の最終日・月末）の値を出します（足すと延べ人数になって意味が変わるため）。"
          caution={mauCaution(data.activeMeasuredFrom, points.at(-1)?.day)}
          points={points}
          measuredFrom={data.activeMeasuredFrom}
          series={[
            {
              key: "mau",
              label: "MAU（直近30日）",
              color: "primary.main",
              rollup: "last",
            },
          ]}
          unit="人"
        />
      </FullWidth>
      <FullWidth>
        <TrendChart
          title="DAU の推移"
          hint="その日にアクセスした人数です。週別・月別表示ではその期間の平均を出します（足すと延べ人数になります）。MAU とは桁が違うため、別のグラフにしています。"
          points={points}
          measuredFrom={data.activeMeasuredFrom}
          series={[
            {
              key: "dau",
              label: "DAU（その日）",
              color: "secondary.main",
              rollup: "average",
            },
          ]}
          unit="人"
        />
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
      <Tile
        label="退会申請数"
        value={h.deleteRequested}
        hint="期間内の申請。減ったら良い指標なので、下がったときを緑にしています"
        trend={trendOf(data, "deleteRequested", h.deleteRequested)}
      />
      <Tile
        label="完全削除数"
        value={h.deleteCompleted}
        hint="猶予期間を過ぎて削除された件数。減ったら良い指標です"
        trend={trendOf(data, "deleteCompleted", h.deleteCompleted)}
      />
      <Tile
        label="猶予期間中の復帰数"
        value={h.restored}
        hint="申請を取り消して戻ってきた件数"
        trend={trendOf(data, "restored", h.restored)}
      />
      <Tile
        label="退会申請中"
        value={h.pendingDeletion}
        hint="現在の猶予期間中ユーザー（期間によらないので前期間比は出しません）"
      />
      <Tile
        label="チャット利用率"
        text={pct(h.chatUsedRate)}
        hint={`チャンネルが作られたイベント ${h.chatUsedEvents} ÷ 公開イベント ${h.featureEvents}`}
        trend={trendOf(data, "chatUsedRate", h.chatUsedRate)}
      />
      <Tile
        label="アンケート利用率"
        text={pct(h.surveyUsedRate)}
        hint={`設問があるイベント ${h.surveyUsedEvents} ÷ 公開イベント ${h.featureEvents}`}
        trend={trendOf(data, "surveyUsedRate", h.surveyUsedRate)}
      />
      <Tile
        label="チェックイン利用率"
        text={pct(h.checkinUsedRate)}
        hint={`出席チェックを有効にしたイベント ${h.checkinUsedEvents} ÷ 公開イベント ${h.featureEvents}`}
        trend={trendOf(data, "checkinUsedRate", h.checkinUsedRate)}
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
  const reactions = m.eggAttendReactions + m.eggHostReactions;
  return (
    <Section
      title="マッチング"
      note="会場オファーとたまご（イベントのリクエスト）。期間はオファー・たまごの作成日で切っています。"
    >
      <Tile
        label="会場オファー数"
        value={m.venueOffers}
        hint={`承諾 ${m.venueOffersAccepted} / 辞退 ${m.venueOffersDeclined} / 未回答 ${m.venueOffersPending}`}
        trend={trendOf(data, "venueOffers", m.venueOffers)}
      />
      <Tile
        label="オファー成立率"
        text={pct(m.venueOfferAcceptRate)}
        hint="承諾 ÷ オファー数"
        trend={trendOf(data, "venueOfferAcceptRate", m.venueOfferAcceptRate)}
      />
      <Tile
        label="会場募集の充足率"
        text={pct(m.venueWantedFillRate)}
        hint={`会場が決まった ${m.venueWantedFilled} ÷ 会場募集中で作成 ${m.venueWantedEvents}`}
        trend={trendOf(data, "venueWantedFillRate", m.venueWantedFillRate)}
      />
      <Tile
        label="たまご投稿数"
        value={m.eggs}
        hint="期間内に投稿されたもの"
        trend={trendOf(data, "eggs", m.eggs)}
      />
      <Tile
        label="たまごの賛同数"
        value={reactions}
        hint={`参加したい ${m.eggAttendReactions} / 開催してもいい ${m.eggHostReactions}。1件あたり ${num(m.avgReactionsPerEgg)}`}
        trend={trendOf(data, "eggReactions", reactions)}
      />
      <Tile
        label="たまごのイベント化率"
        text={pct(m.eggConversionRate)}
        hint={`イベント化 ${m.eggsConverted} ÷ たまご投稿数 ${m.eggs}`}
        trend={trendOf(data, "eggConversionRate", m.eggConversionRate)}
      />
    </Section>
  );
}
