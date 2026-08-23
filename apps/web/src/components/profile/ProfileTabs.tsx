import { useState } from "react";
import {
  Box,
  Stack,
  Tab,
  Tabs,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { EventTimelinePhotos, MyEventSummary } from "@eventer/shared";
import { EventList, ListColumnsToggle } from "../EventList.js";
import { isDraftEvent } from "../DraftChip.js";
import { ParticipationTimeline } from "../ParticipationTimeline.js";
import { ProfileMediaTab } from "./ProfileMediaTab.js";

/** タブの値。URL の `?tab=` にそのまま載る（既定の upcoming は載せない）。
 * all は並びの先頭だが既定ではない（既定は「参加予定」のまま） */
const TAB_KEYS = ["all", "upcoming", "past", "hosted", "drafts", "media"] as const;
export type ProfileTabKey = (typeof TAB_KEYS)[number];

/** `?tab=` の解釈。不正な値と、出せない drafts は既定タブに落とす
 * （リダイレクトはしない。URL はそのままで表示だけ既定になる） */
function resolveTab(raw: string | null, draftsVisible: boolean): ProfileTabKey {
  const found = TAB_KEYS.find((k) => k === raw);
  if (!found || (found === "drafts" && !draftsVisible)) return "upcoming";
  return found;
}

/** ひとかたまり。件数を見出しに出し、1列/2列の切替を添える。
 * note を渡すと見出しの下に補足を出す（下書きタブ用） */
function Section({
  title,
  events,
  note,
}: {
  title: string;
  events: MyEventSummary[];
  note?: string;
}) {
  const { t } = useTranslation();
  if (events.length === 0) return null;
  return (
    <Box>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1}
        sx={{ mb: note ? 0.25 : 1 }}
      >
        <Typography variant="h6">
          {t("profile.sectionCount", { title, n: events.length })}
        </Typography>
        <ListColumnsToggle />
      </Stack>
      {note && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {note}
        </Typography>
      )}
      <EventList events={events} />
    </Box>
  );
}

/** 年表のもとになるデータ。タブごとの母集団を events で渡す */
interface TimelineSource {
  userId: string;
  speakerEventIds: string[];
  meetCounts?: Record<string, number>;
  eventPhotos?: EventTimelinePhotos[];
  now: number;
}

/**
 * イベント系タブ1つぶんの中身。主役は件数見出しつきの一覧で、
 * 年表は同じ母集団の別の見せ方としてトグルで切り替える (#315 の関係のまま)。
 */
function EventTabBody({
  sections,
  emptyText,
  events,
  view,
  onViewChange,
  timeline,
}: {
  sections: { title: string; events: MyEventSummary[]; note?: string }[];
  emptyText: string;
  events: MyEventSummary[];
  view: "list" | "timeline";
  onViewChange: (v: "list" | "timeline") => void;
  timeline: TimelineSource;
}) {
  const { t } = useTranslation();
  if (events.length === 0) {
    return <Typography color="text.secondary">{emptyText}</Typography>;
  }
  return (
    <Stack spacing={2}>
      <ToggleButtonGroup
        size="small"
        exclusive
        value={view}
        onChange={(_e, v: "list" | "timeline" | null) => {
          if (v != null) onViewChange(v);
        }}
        aria-label={t("profile.historyViewToggle")}
        sx={{ alignSelf: "flex-start" }}
      >
        <ToggleButton value="list">{t("profile.tabList")}</ToggleButton>
        <ToggleButton value="timeline">{t("profile.tabTimeline")}</ToggleButton>
      </ToggleButtonGroup>
      {view === "list" ? (
        <Stack spacing={3}>
          {sections.map((s) => (
            <Section
              key={s.title}
              title={s.title}
              events={s.events}
              note={s.note}
            />
          ))}
        </Stack>
      ) : (
        <ParticipationTimeline
          events={events}
          userId={timeline.userId}
          speakerEventIds={timeline.speakerEventIds}
          meetCounts={timeline.meetCounts}
          eventPhotos={timeline.eventPhotos}
          now={timeline.now}
        />
      )}
    </Stack>
  );
}

/**
 * プロフィールのタブ (#407)。参加予定（既定）／過去／主催／下書き（本人のみ）／
 * メディアに分ける。時間の軸（予定/過去）と役割の軸（主催）は独立 (#416):
 * 主催イベントは「主催」タブに出たまま、開催時期に応じて「参加予定」または
 * 「過去」にも重ねて出る。下書きだけは時間のタブに混ぜない（公開前のものが
 * 「参加予定」に出ると紛らわしい #348）。
 *
 * - 選択中のタブは `?tab=` で URL に載る（共有・リロードで残る）。
 *   既定タブはパラメータ無し。履歴は置き換えるので戻るボタンは前のページへ
 * - 下書きタブは本人かつ下書きが1件以上あるときだけ出す (#319, #348)。
 *   他人のデータ源は公開イベントだけの API なので、出し分けは表示の都合であって
 *   保証の根拠ではない
 * - メディアタブの中身はタブを開いたときに初めて取得する
 */
export function ProfileTabs({
  events,
  userId,
  speakerEventIds,
  meetCounts,
  eventPhotos,
  isMe,
  handle,
  now = Date.now(),
}: {
  events: MyEventSummary[];
  userId: string;
  speakerEventIds: string[];
  meetCounts?: Record<string, number>;
  eventPhotos?: EventTimelinePhotos[];
  isMe: boolean;
  handle: string;
  now?: number;
}) {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  // 一覧⇄年表の切替。タブをまたいで共有し、URL には載せない（既定は一覧 #315）
  const [view, setView] = useState<"list" | "timeline">("list");

  // 日程調整中（endsAt未確定=0）は「これから」側に含める
  const upcoming = (e: MyEventSummary) => e.scheduling || e.endsAt >= now;
  // 合算の「すべて」タブで同じイベントが二重に出ないよう id で一意化しておく
  // （個別タブは母集団が排他なので影響しない）
  const unique = [...new Map(events.map((e) => [e.id, e] as const)).values()];
  // 公開前は時間の軸とは別の状態なので、個別タブには混ぜない (#348)
  const drafts = unique.filter(isDraftEvent);
  const live = unique.filter((e) => !isDraftEvent(e));
  const hosted = live.filter((e) => e.myRole === "staff");
  const joined = live.filter((e) => e.myRole !== "staff");
  const joinedUpcoming = joined.filter(upcoming);
  const joinedPast = joined.filter((e) => !upcoming(e));
  const hostedUpcoming = hosted.filter(upcoming);
  const hostedPast = hosted.filter((e) => !upcoming(e));
  // 時間タブの母集団。主催イベントも開催時期に応じて重ねて出す (#416)。
  // 主催を時間タブから外したくなったら、次の2行の hosted* を除くだけでよい
  const upcomingEvents = [...hostedUpcoming, ...joinedUpcoming];
  const pastEvents = [...hostedPast, ...joinedPast];

  const draftsVisible = isMe && drafts.length > 0;
  // 「すべて」タブの母集団: イベント系タブの合算（メディアは含めない）。
  // 下書きは drafts タブと同じ出し分け（本人のみ）。他人のデータ源は
  // もともと公開分だけだが、表示側でも同じ線を守る
  const allEvents = isMe ? unique : live;
  const tab = resolveTab(searchParams.get("tab"), draftsVisible);

  const selectTab = (next: ProfileTabKey) => {
    // 既定タブは素の URL（既定を URL に書かない）。共有・リロードには残したいが
    // 戻るボタンでタブ履歴を1つずつ遡らせたくないので置き換える
    const params = new URLSearchParams(searchParams);
    if (next === "upcoming") params.delete("tab");
    else params.set("tab", next);
    setSearchParams(params, { replace: true });
  };

  const countLabel = (title: string, n: number) =>
    t("profile.sectionCount", { title, n });
  // 一覧が丸ごと空のときはタブ別の文言より前に、本人／他人で言い分ける従来の
  // 空メッセージを出す（本人は自分用の一覧、他人は公開ぶんだけ #319）
  const emptyAll =
    events.length === 0
      ? t(isMe ? "profile.noOngoingEvents" : "profile.noPublicEvents")
      : null;
  const timeline: TimelineSource = {
    userId,
    speakerEventIds,
    meetCounts,
    eventPhotos,
    now,
  };

  return (
    <Box>
      <Tabs
        value={tab}
        onChange={(_e, v: ProfileTabKey) => selectTab(v)}
        variant="scrollable"
        allowScrollButtonsMobile
        sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}
      >
        {/* 並びの先頭は合算の「すべて」。ただし既定タブは「参加予定」のまま */}
        <Tab
          value="all"
          label={countLabel(t("profile.tabAll"), allEvents.length)}
        />
        <Tab
          value="upcoming"
          label={countLabel(t("profile.tabUpcoming"), upcomingEvents.length)}
        />
        <Tab
          value="past"
          label={countLabel(t("profile.tabPast"), pastEvents.length)}
        />
        <Tab
          value="hosted"
          label={countLabel(t("profile.tabHosted"), hosted.length)}
        />
        {draftsVisible && (
          <Tab
            value="drafts"
            label={countLabel(t("profile.tabDrafts"), drafts.length)}
          />
        )}
        {/* メディアは開くまで取得しないので件数を添えない */}
        <Tab value="media" label={t("profile.tabMedia")} />
      </Tabs>

      {/* 合算の「すべて」。まとまりの切り方は旧4分類＋下書き (#315, #348) をそのまま
          再現する（1イベントはどれか1まとまりにだけ出る） */}
      {tab === "all" && (
        <EventTabBody
          sections={[
            ...(isMe
              ? [
                  {
                    title: t("profile.sectionDrafts"),
                    events: drafts,
                    note: t("profile.sectionDraftsNote"),
                  },
                ]
              : []),
            {
              title: t("profile.sectionHosting"),
              events: hostedUpcoming,
            },
            { title: t("profile.sectionJoining"), events: joinedUpcoming },
            {
              title: t("profile.sectionHosted"),
              events: hostedPast,
            },
            { title: t("profile.sectionJoined"), events: joinedPast },
          ]}
          emptyText={
            emptyAll ??
            t(isMe ? "profile.noOngoingEvents" : "profile.noPublicEvents")
          }
          events={allEvents}
          view={view}
          onViewChange={setView}
          timeline={timeline}
        />
      )}
      {/* 時間の2タブは主催ぶんも含む (#416)。主催を先に出す並びは「すべて」と同じ */}
      {tab === "upcoming" && (
        <EventTabBody
          sections={[
            { title: t("profile.sectionHosting"), events: hostedUpcoming },
            { title: t("profile.sectionJoining"), events: joinedUpcoming },
          ]}
          emptyText={emptyAll ?? t("profile.tabEmptyUpcoming")}
          events={upcomingEvents}
          view={view}
          onViewChange={setView}
          timeline={timeline}
        />
      )}
      {tab === "past" && (
        <EventTabBody
          sections={[
            { title: t("profile.sectionHosted"), events: hostedPast },
            { title: t("profile.sectionJoined"), events: joinedPast },
          ]}
          emptyText={emptyAll ?? t("profile.tabEmptyPast")}
          events={pastEvents}
          view={view}
          onViewChange={setView}
          timeline={timeline}
        />
      )}
      {tab === "hosted" && (
        <EventTabBody
          sections={[
            {
              title: t("profile.sectionHosting"),
              events: hostedUpcoming,
            },
            {
              title: t("profile.sectionHosted"),
              events: hostedPast,
            },
          ]}
          emptyText={emptyAll ?? t("profile.tabEmptyHosted")}
          events={hosted}
          view={view}
          onViewChange={setView}
          timeline={timeline}
        />
      )}
      {/* 下書きに時系列の意味はないので年表切替は付けない */}
      {tab === "drafts" && (
        <Section
          title={t("profile.sectionDrafts")}
          events={drafts}
          note={t("profile.sectionDraftsNote")}
        />
      )}
      {tab === "media" && <ProfileMediaTab handle={handle} />}
    </Box>
  );
}
