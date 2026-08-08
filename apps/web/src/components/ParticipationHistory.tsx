import { useState } from "react";
import { Box, Stack, Tab, Tabs, Typography } from "@mui/material";
import type { EventTimelinePhotos, MyEventSummary } from "@eventer/shared";
import { EventList, ListColumnsToggle } from "./EventList.js";
import { ParticipationTimeline } from "./ParticipationTimeline.js";

/** 4分類のひとかたまり。件数を見出しに出し、1列/2列の切替を添える */
function Section({
  title,
  events,
}: {
  title: string;
  events: MyEventSummary[];
}) {
  if (events.length === 0) return null;
  return (
    <Box>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1}
        sx={{ mb: 1 }}
      >
        <Typography variant="h6">
          {title}（{events.length}）
        </Typography>
        <ListColumnsToggle />
      </Stack>
      <EventList events={events} />
    </Box>
  );
}

/**
 * 公開プロフィールの参加履歴 (#315)。
 *
 * 主役は従来どおり4分類の一覧で、年表は同じデータの別の見せ方として
 * タブで切り替える。既定は一覧（#310 で年表に置き換えて情報密度が落ちたため）。
 */
export function ParticipationHistory({
  events,
  userId,
  speakerEventIds,
  meetCounts,
  eventPhotos,
  now = Date.now(),
}: {
  events: MyEventSummary[];
  userId: string;
  speakerEventIds: string[];
  meetCounts?: Record<string, number>;
  eventPhotos?: EventTimelinePhotos[];
  now?: number;
}) {
  const [view, setView] = useState<"list" | "timeline">("list");
  if (events.length === 0) return null;

  // 日程調整中（endsAt未確定=0）は「これから」側に含める
  const upcoming = (e: MyEventSummary) => e.scheduling || e.endsAt >= now;
  const hosted = events.filter((e) => e.myRole === "staff");
  const joined = events.filter((e) => e.myRole !== "staff");

  return (
    <Box>
      <Tabs
        value={view}
        onChange={(_e, v: "list" | "timeline") => setView(v)}
        sx={{ mb: 2, minHeight: 40 }}
        aria-label="参加履歴の表示切替"
      >
        <Tab value="list" label="一覧" sx={{ minHeight: 40 }} />
        <Tab value="timeline" label="年表" sx={{ minHeight: 40 }} />
      </Tabs>

      {view === "list" ? (
        <Stack spacing={3}>
          <Section
            title="主催・運営するイベント"
            events={hosted.filter(upcoming)}
          />
          <Section
            title="参加予定のイベント"
            events={joined.filter(upcoming)}
          />
          <Section
            title="主催・運営したイベント"
            events={hosted.filter((e) => !upcoming(e))}
          />
          <Section
            title="参加したイベント"
            events={joined.filter((e) => !upcoming(e))}
          />
        </Stack>
      ) : (
        <ParticipationTimeline
          events={events}
          userId={userId}
          speakerEventIds={speakerEventIds}
          meetCounts={meetCounts}
          eventPhotos={eventPhotos}
          now={now}
        />
      )}
    </Box>
  );
}
