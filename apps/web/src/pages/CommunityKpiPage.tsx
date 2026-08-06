import { useState } from "react";
import {
  Alert,
  Button,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import InsightsIcon from "@mui/icons-material/Insights";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { Link as RouterLink, useParams } from "react-router-dom";
import type { CommunityKpiPayload } from "@eventer/shared";
import { useIsAdmin } from "../api/hooks.js";
import { useCommunity } from "../api/communityHooks.js";
import { useCommunityKpi } from "../api/analyticsHooks.js";
import {
  FullWidth,
  MiniBars,
  Section,
  Tile,
  num,
  pct,
} from "../components/KpiTiles.js";

const RANGES: { label: string; days: number | null }[] = [
  { label: "30日", days: 30 },
  { label: "90日", days: 90 },
  { label: "1年", days: 365 },
  { label: "全期間", days: null },
];

/** 母数不足で率を出せないときの補足。件数そのものは出しているので、
 * 「隠している」のではなく「率にすると誤読しやすい」ことを伝える */
function fewNote(base: number, minSample: number, label: string): string {
  if (base >= minSample) return "";
  return `いまは ${label} が ${base} のため、率は「—」にしています（${minSample} 以上で表示。少ない母数だと1人の増減で率が大きく動くためです）。`;
}

/** コミュニティ運営者向けのKPI (#262)。/c/:slug/kpi。
 * 数字は評価ではなく「次に何を試すか」を考えるための材料として出す */
export function CommunityKpiPage() {
  const { slug = "" } = useParams();
  const isAdmin = useIsAdmin();
  const [range, setRange] = useState<number | null>(90);
  const { data: community, isLoading: loadingCommunity } = useCommunity(slug);
  const isManager =
    community?.myRole === "owner" || community?.myRole === "admin";
  const { data, isLoading, isError } = useCommunityKpi(
    community?.id,
    range,
    isManager || isAdmin,
  );

  if (loadingCommunity) return <Typography>読み込み中…</Typography>;
  if (!community) {
    return <Alert severity="info">コミュニティが見つかりません。</Alert>;
  }
  if (!isManager && !isAdmin) {
    return (
      <Alert severity="warning">
        このページはコミュニティの管理者だけが見られます。
      </Alert>
    );
  }

  return (
    <Stack spacing={2.5}>
      <Button
        component={RouterLink}
        to={`/c/${slug}`}
        startIcon={<ArrowBackIcon />}
        sx={{ alignSelf: "flex-start" }}
      >
        {community.name}
      </Button>

      <Typography
        variant="h5"
        fontWeight={700}
        sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
      >
        <InsightsIcon fontSize="medium" />
        コミュニティの数字
      </Typography>

      <Alert severity="info" sx={{ py: 0.5 }}>
        コミュニティの状態を振り返るための数字です。良し悪しを採点するものではなく、
        「次に何を試すか」を考えるための材料として使ってください。数え方は運営ダッシュボードの
        全体KPIと揃えてあり、主催・スタッフの行（イベント作成時に自動で作られます）と
        退会申請中のユーザーは除いています。審査員・観覧者は実際にイベントに来る人なので
        参加者として数えます。母数が少ないときは率が極端に振れて誤読しやすいため、
        件数だけを出して率は「—」にしています。
      </Alert>

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

      {isError ? (
        <Alert severity="error">
          数字の取得に失敗しました。時間をおいて再読み込みしてください。
        </Alert>
      ) : isLoading || !data ? (
        <Typography>読み込み中…</Typography>
      ) : (
        <>
          <NorthStarSection data={data} />
          <NewcomerSection data={data} />
          <HostSection data={data} />
          <DormantSection data={data} />
          <OverlapSection data={data} />
          <ParticipantsSection data={data} />
        </>
      )}
    </Stack>
  );
}

/* ---------------- セクション ---------------- */

function NorthStarSection({ data }: { data: CommunityKpiPayload }) {
  const n = data.northStar;
  const o = data.organizers;
  return (
    <Section
      title="開催と参加"
      note="このコミュニティに紐づく公開イベントのうち、期間内に終了したものが対象です。出席チェックを実施したイベントは出席者数、未実施は確定登録者数を数えます（イベントページの参加者数と同じ定義なので主催・スタッフを含みます）。何が分かるか: 活動の量と、1回あたりの集まり具合。"
    >
      <Tile
        label="参加体験の数"
        value={n.participations}
        hint={`開催済みイベントの参加者の合計（主催・スタッフを含む）。主催・スタッフを除くと ${n.heldParticipants.toLocaleString()}`}
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
      <Tile
        label="参加者が少なかった回の割合"
        text={pct(o.dudRate)}
        hint={`参加者3人以下 ${o.dudEvents} 件 ÷ ${o.dudBaseEvents} 件。出席チェックを有効にしたのに記録が0件の ${o.attendanceUnrecordedEvents} 件は判定できないため除いています。告知のタイミングや開催形式を見直すヒントに`}
      />
    </Section>
  );
}

function NewcomerSection({ data }: { data: CommunityKpiPayload }) {
  const nc = data.newcomers;
  return (
    <Section
      title="新規流入と常連"
      note={`期間内にこのコミュニティのイベントに参加した人を、「初参加」と「以前にも来ていた人」に分けています。初参加の判定は、期間の開始日より前に終了したこのコミュニティの公開イベントへの参加記録が無いこと。何が分かるか: 常連だけで回っていないか、新しい人が入る余地があるか。${fewNote(nc.participants, data.minSample, "参加した人数")}`}
    >
      <Tile
        label="初参加の割合"
        text={pct(nc.newcomerRate)}
        hint={`初参加 ${nc.newcomers} 人 ÷ 参加した人数 ${nc.participants} 人`}
        big
      />
      <Tile
        label="初参加の人数"
        value={nc.newcomers}
        hint="このコミュニティのイベントに初めて来た人"
      />
      <Tile
        label="以前にも来ていた人数"
        value={nc.regulars}
        hint="期間より前にも参加していた人。ここが厚いほど継続的な関係ができています"
      />
      <Tile
        label="また来てくれた人の割合"
        text={pct(data.participants.repeatRate)}
        hint={`期間内に2回以上参加 ${data.participants.repeatParticipants} 人 ÷ 参加した人数 ${data.participants.uniqueParticipants} 人`}
      />
    </Section>
  );
}

function HostSection({ data }: { data: CommunityKpiPayload }) {
  const o = data.organizers;
  return (
    <Section
      title="開催を担っている人"
      note={`期間内にこのコミュニティのイベントを開いた人の内訳です（退会申請中の人は除きます）。何が分かるか: 開催が特定の人に集中していないか。集中していても問題があるとは限りませんが、その人が忙しくなると活動が止まりやすくなります。${fewNote(o.heldEventsWithActiveHost, data.minSample, "開催数")}`}
    >
      <Tile
        label="開催した人数"
        value={o.hosts}
        hint="期間内に1件以上イベントを開いた実人数"
        big
      />
      <Tile
        label="いちばん多い人のシェア"
        text={pct(o.topHostShare)}
        hint={`最多の1人が ${o.topHostEvents} 件 ÷ 開催 ${o.heldEventsWithActiveHost} 件。高いときは共同開催や当番制を試すヒントに`}
      />
      <Tile
        label="1人あたり開催数"
        text={num(o.avgEventsPerHost)}
        hint={`開催 ${o.heldEventsWithActiveHost} 件 ÷ 開催した人数 ${o.hosts} 人`}
      />
      <Tile
        label="2回以上開いた人の割合"
        text={pct(o.repeatHostRate)}
        hint={`2回以上 ${o.repeatHosts} 人 ÷ 開催した人数 ${o.hosts} 人`}
      />
    </Section>
  );
}

function DormantSection({ data }: { data: CommunityKpiPayload }) {
  const d = data.dormant;
  return (
    <Section
      title="フォローしている人の動き"
      note={`フォロー登録（コミュニティのメンバー）をしている在籍ユーザーのうち、期間内に開催されたイベントに参加した人と、していない人の内訳です。イベントに参加しただけでフォローしていない人は含みません。主催のみの人は「参加」に数えません。何が分かるか: 名簿だけが増えていないか、届いていない人にどう声をかけるか。${fewNote(d.members, data.minSample, "フォロー人数")}`}
    >
      <Tile
        label="しばらく参加していない人の割合"
        text={pct(d.dormantRate)}
        hint={`未参加 ${d.dormantMembers} 人 ÷ フォロー ${d.members} 人`}
        big
      />
      <Tile
        label="フォローしている人数"
        value={d.members}
        hint="コミュニティをフォローしている在籍ユーザー（コミュニティページのメンバー数はイベント参加者も含むため一致しません）"
      />
      <Tile
        label="うち期間内に参加した人数"
        value={d.activeMembers}
        hint="期間内に開催されたこのコミュニティのイベントに参加した人"
      />
    </Section>
  );
}

function OverlapSection({ data }: { data: CommunityKpiPayload }) {
  const total = data.newcomers.participants;
  return (
    <Section
      title="他のコミュニティとの重なり"
      note="期間内にこのコミュニティのイベントに参加した人が、他のどのコミュニティの公開イベントにも参加しているか（時期は問いません・多い順に最大5件）。誰でも見られる公開イベントの参加記録だけを使っています。何が分かるか: 声をかけやすい連携先、独自の層をどれくらい持てているか。"
    >
      <FullWidth>
        <MiniBars
          title={`重なっている人数（期間内の参加者 ${total} 人のうち）`}
          items={data.overlap.map((o) => ({
            label: o.name,
            value: o.users,
          }))}
          unit="人"
          empty="他のコミュニティのイベントに参加している人は見つかりませんでした。"
        />
      </FullWidth>
      {data.overlap.map((o) => (
        <Tile
          key={o.communityId}
          label={o.name}
          text={pct(o.rate)}
          hint={`${o.users} 人が重なっています（@${o.slug}）`}
        />
      ))}
    </Section>
  );
}

function ParticipantsSection({ data }: { data: CommunityKpiPayload }) {
  const p = data.participants;
  return (
    <Section
      title="参加者の動き（詳細）"
      note="登録・キャンセルは「登録が作成された日」、出席は「イベントが終了した日」で期間を切っています。キャンセルは、取り消したあと同じイベントに再参加すると記録が上書きされるため少なめに出ます。何が分かるか: 告知から参加までのつまずき、当日来られなくなる人の傾向。"
    >
      <Tile
        label="参加登録数"
        value={p.registrations}
        hint="期間内に作成された登録（取消を含む全ステータス）"
      />
      <Tile label="うち確定" value={p.confirmedRegistrations} hint="いま確定状態の登録" />
      <Tile
        label="イベント詳細の閲覧UU"
        value={p.uniqueViewers}
        hint={`このコミュニティのイベント詳細を見た訪問者（Cookieで重複排除）。総表示回数 ${p.totalViews.toLocaleString()}`}
      />
      <Tile
        label="閲覧→登録の転換率"
        text={pct(p.viewToJoinRate)}
        hint="概算です。一覧やお知らせなど詳細ページを経由しない登録も分子に入るため100%を超えることがあります。低いときはイベント説明や日時の書き方を見直すヒントに"
      />
      <Tile
        label="出席率"
        text={pct(p.attendanceRate)}
        hint={`出席 ${p.attended} ÷ 出席チェックを実施したイベントの確定参加者 ${p.attendanceExpected}`}
      />
      <Tile
        label="当日来られなかった割合"
        text={pct(p.noShowRate)}
        hint="登録したのに出席チェックされなかった割合。リマインドの有無を見直すヒントに"
      />
      <Tile
        label="キャンセル率"
        text={pct(p.cancelRate)}
        hint={`取消 ${p.canceled} ÷ 期間内の登録 ${p.registrations}（日程調整中の取消は除外）`}
      />
      <Tile
        label="うち直前24時間"
        text={`${p.canceledLate} / ${p.canceled}`}
        hint={`事前の取消は ${p.canceledEarly} 件。直前率 ${pct(p.lateCancelRate)}`}
      />
      <FullWidth>
        <MiniBars
          title="参加回数の分布（期間内に開催されたイベントへの参加回数）"
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
