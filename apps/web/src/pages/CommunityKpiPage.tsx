import { useState } from "react";
import { useTranslation } from "react-i18next";
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
import {
  type CommunityKpiPayload,
  type KpiMetricKey,
  type KpiSeriesPoint,
  type KpiTrend,
  kpiTrend,
} from "@eventer/shared";
import { useIsAdmin } from "../api/hooks.js";
import { useCommunity } from "../api/communityHooks.js";
import { useCommunityKpi } from "../api/analyticsHooks.js";
import { i18next } from "../i18n/index.js";
import { KpiNote } from "../components/KpiNote.js";
import {
  FullWidth,
  MiniBars,
  Section,
  Tile,
  TrendChart,
  num,
  pct,
} from "../components/KpiTiles.js";

/** 前期間比を引く。方向（増えたら良いか）の定義は @eventer/shared の
 * KPI_METRICS が1箇所で持っていて、全体KPIの画面と共通 (#266)。
 * 全期間を選んだときは previous が null なので何も出さない */
function trendOf(
  data: CommunityKpiPayload,
  key: KpiMetricKey,
  current: number | null,
): KpiTrend | null {
  return kpiTrend(key, current, data.previous?.[key]);
}

function seriesPoints(data: CommunityKpiPayload): KpiSeriesPoint[] {
  return data.daily.map((d) => ({
    day: d.day,
    values: { heldEvents: d.heldEvents, participations: d.participations },
  }));
}

/** 期間の選択肢。**訳した文字列ではなく翻訳キーを持つ**（文字列を持つと言語を
 * 切り替えたとき前の言語のまま残る）。React の `key` は日数から作るので、
 * ここのラベルが `key` を兼ねることもない */
const RANGES = [
  { labelKey: "kpi.range30", days: 30 },
  { labelKey: "kpi.range90", days: 90 },
  { labelKey: "kpi.range365", days: 365 },
  { labelKey: "kpi.rangeAll", days: null },
] as const satisfies readonly { labelKey: string; days: number | null }[];

/** 母数不足で率を出せないときの補足。件数そのものは出しているので、
 * 「隠している」のではなく「率にすると誤読しやすい」ことを伝える。
 *
 * 1つのセクションに分母の違う率が並ぶことがあるので（例: 開催シェアの分母は
 * イベント件数、2回以上開いた人の割合の分母は人数）、足りていない母数を
 * すべて並べる。サーバー側は画面に出るすべての率に同じゲートを掛けているので、
 * ここに挙がっていない率が「—」になることはない。
 *
 * caution は「なぜ率が —なのか」を知らないとその場の数字を誤読するので短く見せる。
 * 理由や閾値の説明（detail）はセクションのⓘに畳む。
 *
 * `label` は呼ぶ側が描画時に訳したもの（ここが訳文を溜め込むことはない）。 */
function fewNote(
  bases: { base: number; label: string }[],
  minSample: number,
): { caution?: string; detail: string } {
  const few = bases.filter((b) => b.base < minSample);
  if (few.length === 0) return { detail: "" };
  const list = few
    .map((b) => i18next.t("kpi.fewItem", { label: b.label, n: b.base }))
    .join(i18next.t("kpi.fewSeparator"));
  return {
    caution: i18next.t("kpi.fewCaution", { list }),
    detail: i18next.t("kpi.fewDetail", { list, n: minSample }),
  };
}

/** コミュニティ運営者向けのKPI (#262)。/c/:slug/kpi。
 * 数字は評価ではなく「次に何を試すか」を考えるための材料として出す */
export function CommunityKpiPage() {
  const { t } = useTranslation();
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

  if (loadingCommunity) return <Typography>{t("common.loading")}</Typography>;
  if (!community) {
    return <Alert severity="info">{t("community.notFound")}</Alert>;
  }
  if (!isManager && !isAdmin) {
    return <Alert severity="warning">{t("kpi.noPermission")}</Alert>;
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
        {t("kpi.heading")}
      </Typography>

      <KpiNote>{t("kpi.communityNote", { all: t("kpi.rangeAll") })}</KpiNote>

      <ToggleButtonGroup
        size="small"
        exclusive
        value={range ?? "all"}
        onChange={(_e, v) => v !== null && setRange(v === "all" ? null : v)}
      >
        {RANGES.map((r) => (
          <ToggleButton key={r.days ?? "all"} value={r.days ?? "all"}>
            {t(r.labelKey)}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      {isError ? (
        <Alert severity="error">{t("kpi.loadError")}</Alert>
      ) : isLoading || !data ? (
        <Typography>{t("common.loading")}</Typography>
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
  const { t } = useTranslation();
  const n = data.northStar;
  const o = data.organizers;
  const few = fewNote(
    [{ base: o.dudBaseEvents, label: t("kpi.baseDudEvents") }],
    data.minSample,
  );
  return (
    <Section
      title={t("kpi.nsTitle")}
      caution={few.caution}
      note={`${t("kpi.nsNote")}${few.detail}`}
    >
      <Tile
        label={t("kpi.labelParticipations")}
        value={n.participations}
        hint={t("kpi.hintParticipations", {
          n: n.heldParticipants.toLocaleString(),
        })}
        trend={trendOf(data, "participations", n.participations)}
        big
      />
      <Tile
        label={t("kpi.labelHeldEvents")}
        value={n.heldEvents}
        hint={t("kpi.hintHeldEvents")}
        trend={trendOf(data, "heldEvents", n.heldEvents)}
      />
      <Tile
        label={t("kpi.labelAvgParticipants")}
        text={num(n.avgParticipantsPerEvent)}
        hint={t("kpi.hintDivide", {
          a: t("kpi.labelParticipations"),
          b: t("kpi.labelHeldEvents"),
        })}
        trend={trendOf(
          data,
          "avgParticipantsPerEvent",
          n.avgParticipantsPerEvent,
        )}
      />
      <Tile
        label={t("kpi.labelDudRate")}
        text={pct(o.dudRate)}
        hint={`${t("kpi.hintDudRate", {
          a: o.dudEvents,
          b: o.dudBaseEvents,
          c: o.attendanceUnrecordedEvents,
        })}${t("kpi.lowerIsBetter")}`}
        trend={trendOf(data, "dudRate", o.dudRate)}
      />
      {/* 参加体験の数は開催イベント数より桁がひとつ大きい。同じ目盛りに並べると
          開催イベント数の棒が潰れて読めないので、チャートを分ける */}
      <FullWidth>
        <TrendChart
          title={t("kpi.chartParticipationsTitle")}
          hint={t("kpi.chartParticipationsHint")}
          points={seriesPoints(data)}
          series={[
            {
              key: "participations",
              label: t("kpi.labelParticipations"),
              color: "primary.main",
            },
          ]}
          unit={t("kpi.unitPeople")}
        />
      </FullWidth>
      <FullWidth>
        <TrendChart
          title={t("kpi.chartHeldEventsTitle")}
          hint={t("kpi.chartHeldEventsHint", {
            label: t("kpi.labelParticipations"),
          })}
          points={seriesPoints(data)}
          series={[
            {
              key: "heldEvents",
              label: t("kpi.labelHeldEvents"),
              color: "secondary.main",
            },
          ]}
          unit={t("kpi.unitEvents")}
        />
      </FullWidth>
    </Section>
  );
}

function NewcomerSection({ data }: { data: CommunityKpiPayload }) {
  const { t } = useTranslation();
  const nc = data.newcomers;
  const few = fewNote(
    [{ base: nc.participants, label: t("kpi.labelParticipants") }],
    data.minSample,
  );
  const repeatTile = (
    <Tile
      label={t("kpi.labelRepeatRate")}
      text={pct(data.participants.repeatRate)}
      hint={t("kpi.hintRepeatRate", {
        a: data.participants.repeatParticipants,
        b: data.participants.uniqueParticipants,
      })}
      trend={trendOf(data, "repeatRate", data.participants.repeatRate)}
      big={data.days === null}
    />
  );

  // 全期間は「期間より前」が存在しないので、全員が「初参加」になってしまう。
  // 他の期間と同じタイルで出すと必ず 100% で誤読されるため、数字は出さずに理由を書く
  if (data.days === null) {
    return (
      <Section
        title={t("kpi.ncAllTitle")}
        caution={few.caution}
        note={`${t("kpi.ncAllNote", {
          a: t("kpi.range30"),
          b: t("kpi.range90"),
          c: t("kpi.range365"),
        })}${few.detail}`}
      >
        {repeatTile}
        <Tile
          label={t("kpi.labelParticipants")}
          value={nc.participants}
          hint={t("kpi.hintParticipantsAll")}
        />
      </Section>
    );
  }

  return (
    <Section
      title={t("kpi.ncTitle")}
      caution={few.caution}
      note={`${t("kpi.ncNote")}${few.detail}`}
    >
      <Tile
        label={t("kpi.labelNewcomerRate")}
        text={pct(nc.newcomerRate)}
        hint={t("kpi.hintNewcomerRate", { a: nc.newcomers, b: nc.participants })}
        trend={trendOf(data, "newcomerRate", nc.newcomerRate)}
        big
      />
      <Tile
        label={t("kpi.labelNewcomers")}
        value={nc.newcomers}
        hint={t("kpi.hintNewcomers")}
        trend={trendOf(data, "newcomers", nc.newcomers)}
      />
      <Tile
        label={t("kpi.labelRegulars")}
        value={nc.regulars}
        hint={t("kpi.hintRegulars")}
        trend={trendOf(data, "regulars", nc.regulars)}
      />
      {repeatTile}
    </Section>
  );
}

function HostSection({ data }: { data: CommunityKpiPayload }) {
  const { t } = useTranslation();
  const o = data.organizers;
  const few = fewNote(
    [
      { base: o.heldEventsWithActiveHost, label: t("kpi.baseHeldEvents") },
      { base: o.hosts, label: t("kpi.labelHosts") },
    ],
    data.minSample,
  );
  return (
    <Section
      title={t("kpi.hostTitle")}
      caution={few.caution}
      note={`${t("kpi.hostNote")}${few.detail}`}
    >
      <Tile
        label={t("kpi.labelHosts")}
        value={o.hosts}
        hint={t("kpi.hintHosts")}
        trend={trendOf(data, "hosts", o.hosts)}
        big
      />
      <Tile
        label={t("kpi.labelTopHostShare")}
        text={pct(o.topHostShare)}
        hint={t("kpi.hintTopHostShare", {
          a: o.topHostEvents,
          b: o.heldEventsWithActiveHost,
        })}
        trend={trendOf(data, "topHostShare", o.topHostShare)}
      />
      <Tile
        label={t("kpi.labelAvgEventsPerHost")}
        text={num(o.avgEventsPerHost)}
        hint={t("kpi.hintAvgEventsPerHost", {
          a: o.heldEventsWithActiveHost,
          b: o.hosts,
        })}
        trend={trendOf(data, "avgEventsPerHost", o.avgEventsPerHost)}
      />
      <Tile
        label={t("kpi.labelRepeatHostRate")}
        text={pct(o.repeatHostRate)}
        hint={t("kpi.hintRepeatHostRate", { a: o.repeatHosts, b: o.hosts })}
        trend={trendOf(data, "repeatHostRate", o.repeatHostRate)}
      />
    </Section>
  );
}

function DormantSection({ data }: { data: CommunityKpiPayload }) {
  const { t } = useTranslation();
  const d = data.dormant;
  const few = fewNote(
    [{ base: d.members, label: t("kpi.baseFollowers") }],
    data.minSample,
  );
  return (
    <Section
      title={t("kpi.dormantTitle")}
      caution={few.caution}
      note={`${t("kpi.dormantNote")}${few.detail}`}
    >
      <Tile
        label={t("kpi.labelDormantRate")}
        text={pct(d.dormantRate)}
        hint={`${t("kpi.hintDormantRate", {
          a: d.dormantMembers,
          b: d.members,
        })}${t("kpi.lowerIsBetter")}`}
        trend={trendOf(data, "dormantRate", d.dormantRate)}
        big
      />
      <Tile
        label={t("kpi.labelFollowers")}
        value={d.members}
        hint={t("kpi.hintFollowers")}
      />
      <Tile
        label={t("kpi.labelActiveMembers")}
        value={d.activeMembers}
        hint={t("kpi.hintActiveMembers")}
        trend={trendOf(data, "activeMembers", d.activeMembers)}
      />
    </Section>
  );
}

function OverlapSection({ data }: { data: CommunityKpiPayload }) {
  const { t } = useTranslation();
  const total = data.newcomers.participants;
  return (
    <Section
      title={t("kpi.overlapTitle")}
      note={t("kpi.overlapNote", { n: data.minSample })}
    >
      <FullWidth>
        <MiniBars
          title={t("kpi.overlapBarsTitle", { n: total })}
          hint={t("kpi.overlapBarsHint")}
          items={data.overlap.map((o) => ({
            key: o.communityId,
            label: o.name,
            value: o.users,
          }))}
          unit={t("kpi.unitPeople")}
          unitOne={t("kpi.unitPerson")}
          empty={t("kpi.overlapEmpty", { n: data.minSample })}
        />
      </FullWidth>
      {data.overlap.map((o) => (
        <Tile
          key={o.communityId}
          label={o.name}
          text={pct(o.rate)}
          hint={t("kpi.overlapTileHint", { n: o.users, slug: o.slug })}
        />
      ))}
    </Section>
  );
}

function ParticipantsSection({ data }: { data: CommunityKpiPayload }) {
  const { t } = useTranslation();
  const p = data.participants;
  return (
    <Section title={t("kpi.pTitle")} note={t("kpi.pNote")}>
      <Tile
        label={t("kpi.labelRegistrations")}
        value={p.registrations}
        hint={t("kpi.hintRegistrations")}
        trend={trendOf(data, "registrations", p.registrations)}
      />
      <Tile
        label={t("kpi.labelConfirmed")}
        value={p.confirmedRegistrations}
        hint={t("kpi.hintConfirmed")}
        trend={trendOf(data, "confirmedRegistrations", p.confirmedRegistrations)}
      />
      <Tile
        label={t("kpi.labelUniqueViewers")}
        value={p.uniqueViewers}
        hint={t("kpi.hintUniqueViewers", { n: p.totalViews.toLocaleString() })}
        trend={trendOf(data, "uniqueViewers", p.uniqueViewers)}
      />
      <Tile
        label={t("kpi.labelViewToJoin")}
        text={pct(p.viewToJoinRate)}
        hint={t("kpi.hintViewToJoin")}
        trend={trendOf(data, "viewToJoinRate", p.viewToJoinRate)}
      />
      <Tile
        label={t("kpi.labelAttendanceRate")}
        text={pct(p.attendanceRate)}
        hint={t("kpi.hintAttendanceRate", {
          a: p.attended,
          b: p.attendanceExpected,
        })}
        trend={trendOf(data, "attendanceRate", p.attendanceRate)}
      />
      <Tile
        label={t("kpi.labelNoShowRate")}
        text={pct(p.noShowRate)}
        hint={`${t("kpi.hintNoShowRate")}${t("kpi.lowerIsBetter")}`}
        trend={trendOf(data, "noShowRate", p.noShowRate)}
      />
      <Tile
        label={t("kpi.labelCancelRate")}
        text={pct(p.cancelRate)}
        hint={`${t("kpi.hintCancelRate", {
          a: p.canceled,
          b: p.registrations,
        })}${t("kpi.lowerIsBetter")}`}
        trend={trendOf(data, "cancelRate", p.cancelRate)}
      />
      {/* 前期間比がポイント差なので、値も率にして単位を揃える */}
      <Tile
        label={t("kpi.labelLateCancelRate")}
        text={pct(p.lateCancelRate)}
        hint={`${t("kpi.hintLateCancelRate", {
          a: p.canceledLate,
          b: p.canceled,
          c: p.canceledEarly,
        })}${t("kpi.lowerIsBetter")}`}
        trend={trendOf(data, "lateCancelRate", p.lateCancelRate)}
      />
      <FullWidth>
        <MiniBars
          title={t("kpi.labelCountDistribution")}
          hint={t("kpi.hintCountDistribution")}
          items={p.countDistribution.map((b) => ({
            label: b.label,
            value: b.users,
          }))}
          unit={t("kpi.unitPeople")}
          unitOne={t("kpi.unitPerson")}
        />
      </FullWidth>
    </Section>
  );
}
