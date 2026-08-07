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
import { KpiNote } from "../components/KpiNote.js";
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
 * 「隠している」のではなく「率にすると誤読しやすい」ことを伝える。
 *
 * 1つのセクションに分母の違う率が並ぶことがあるので（例: 開催シェアの分母は
 * イベント件数、2回以上開いた人の割合の分母は人数）、足りていない母数を
 * すべて並べる。サーバー側は画面に出るすべての率に同じゲートを掛けているので、
 * ここに挙がっていない率が「—」になることはない。
 *
 * caution は「なぜ率が —なのか」を知らないとその場の数字を誤読するので短く見せる。
 * 理由や閾値の説明（detail）はセクションのⓘに畳む。 */
function fewNote(
  bases: { base: number; label: string }[],
  minSample: number,
): { caution?: string; detail: string } {
  const few = bases.filter((b) => b.base < minSample);
  if (few.length === 0) return { detail: "" };
  const list = few.map((b) => `${b.label}が ${b.base}`).join("、");
  return {
    caution: `${list}のため、このセクションの割合は「—」にしています`,
    detail: `いまは${list}のため、このセクションの割合は「—」にしています（${minSample} 以上で表示。少ない母数だと1件・1人の増減で割合が大きく動くためです）。件数と平均はそのまま出しています。`,
  };
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
    <Stack spacing={2}>
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

      <KpiNote>
        コミュニティの状態を振り返るための数字です。良し悪しを採点するものではなく、
        「次に何を試すか」を考えるための材料として使ってください。数え方は運営ダッシュボードの
        全体KPIと揃えてあり、主催・スタッフの行（イベント作成時に自動で作られます）と
        退会申請中のユーザーは除いています。審査員・観覧者は実際にイベントに来る人なので
        参加者として数えます。母数が少ないときは率が極端に振れて誤読しやすいため、
        件数だけを出して率は「—」にしています。
      </KpiNote>

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
  const few = fewNote(
    [{ base: o.dudBaseEvents, label: "参加者数を判定できた開催数" }],
    data.minSample,
  );
  return (
    <Section
      title="開催と参加"
      caution={few.caution}
      note={`このコミュニティに紐づく公開イベントのうち、期間内に終了したものが対象です。出席チェックを実施したイベントは出席者数、未実施は確定登録者数を数えます（イベントページの参加者数と同じ定義なので主催・スタッフを含みます）。何が分かるか: 活動の量と、1回あたりの集まり具合。${few.detail}`}
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
  const few = fewNote(
    [{ base: nc.participants, label: "参加した人数" }],
    data.minSample,
  );
  const repeatTile = (
    <Tile
      label="また来てくれた人の割合"
      text={pct(data.participants.repeatRate)}
      hint={`期間内に2回以上参加 ${data.participants.repeatParticipants} 人 ÷ 参加した人数 ${data.participants.uniqueParticipants} 人`}
      big={data.days === null}
    />
  );

  // 全期間は「期間より前」が存在しないので、全員が「初参加」になってしまう。
  // 他の期間と同じタイルで出すと必ず 100% で誤読されるため、数字は出さずに理由を書く
  if (data.days === null) {
    return (
      <Section
        title="また来てくれた人"
        caution={few.caution}
        note={`全期間では「期間より前に参加していたか」を判定できない（比べる過去が無い）ため、初参加と常連の内訳は出していません。新規流入を見たいときは 30日・90日・1年に切り替えてください。${few.detail}`}
      >
        {repeatTile}
        <Tile
          label="参加した人数"
          value={nc.participants}
          hint="このコミュニティのイベントに参加したことがある実人数（全期間）"
        />
      </Section>
    );
  }

  return (
    <Section
      title="新規流入と常連"
      caution={few.caution}
      note={`期間内にこのコミュニティのイベントに参加した人を、「初参加」と「以前にも来ていた人」に分けています。初参加の判定は、期間の開始日より前に終了したこのコミュニティの公開イベントへの参加記録が無いこと。何が分かるか: 常連だけで回っていないか、新しい人が入る余地があるか。${few.detail}`}
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
      {repeatTile}
    </Section>
  );
}

function HostSection({ data }: { data: CommunityKpiPayload }) {
  const o = data.organizers;
  const few = fewNote(
    [
      { base: o.heldEventsWithActiveHost, label: "開催数" },
      { base: o.hosts, label: "開催した人数" },
    ],
    data.minSample,
  );
  return (
    <Section
      title="開催を担っている人"
      caution={few.caution}
      note={`期間内にこのコミュニティのイベントを開いた人の内訳です（退会申請中の人は除きます）。何が分かるか: 開催が特定の人に集中していないか。集中していても問題があるとは限りませんが、その人が忙しくなると活動が止まりやすくなります。${few.detail}`}
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
  const few = fewNote(
    [{ base: d.members, label: "フォロー人数" }],
    data.minSample,
  );
  return (
    <Section
      title="フォローしている人の動き"
      caution={few.caution}
      note={`フォロー登録（コミュニティのメンバー）をしている在籍ユーザーのうち、期間内に開催されたイベントに参加した人と、していない人の内訳です。イベントに参加しただけでフォローしていない人は含みません。主催のみの人は「参加」に数えません。抽選や先着で参加枠を絞っている場合、申し込んだけれど参加できなかった人も「参加していない人」に入るため、実際より高く見えます。何が分かるか: 名簿だけが増えていないか、届いていない人にどう声をかけるか。${few.detail}`}
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
      note={`期間内にこのコミュニティのイベントに参加した人が、他のどのコミュニティの公開イベントにも参加しているか（時期は問いません・多い順に最大5件）。誰でも見られる公開イベントの参加記録だけを使っています。数え方は分子と分母で少し違い、こちら側（分母）は出席チェックを反映した期間内の参加、相手側（分子）は公開イベントへの確定登録で、出席チェックと時期は問いません。重なっている人が ${data.minSample} 人未満のコミュニティは、メンバー一覧と突き合わせると誰のことか分かってしまうため出していません。何が分かるか: 声をかけやすい連携先、独自の層をどれくらい持てているか。`}
    >
      <FullWidth>
        <MiniBars
          title={`重なっている人数（参加者 ${total} 人中）`}
          hint="期間内にこのコミュニティのイベントに参加した人のうち、他のコミュニティの公開イベントにも参加している人数"
          items={data.overlap.map((o) => ({
            key: o.communityId,
            label: o.name,
            value: o.users,
          }))}
          unit="人"
          empty={`他のコミュニティのイベントに参加している人は見つかりませんでした（重なりが ${data.minSample} 人未満のコミュニティは出していません）。`}
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
