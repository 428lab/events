import { useState } from "react";
import {
  Box,
  Button,
  Card,
  CardActionArea,
  Chip,
  Stack,
  Typography,
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import HistoryIcon from "@mui/icons-material/History";
import type { MyEventSummary } from "@eventer/shared";
import { eventImageUrl } from "../api/hooks.js";
import { eventColor } from "./EventCard.js";
import { formatMonthDay } from "../lib/format.js";

/** 年表に出す1件。イベント本体に、その人の関わり方を添えたもの */
export interface TimelineEntry {
  event: MyEventSummary;
  /** 添えるラベル（主催 / スタッフ / 登壇 / 審査員 …）。参加者だけのときは空 */
  roles: string[];
}

/** 最初に見せる過去の件数。これを超える分は「もっと見る」で開く。
 * 数十件あるユーザーでも初期表示が縦に伸び続けないようにするための上限 */
const INITIAL_PAST = 20;

/** 年表の1行ぶんの見出し（「参加予定」か「2026年」） */
interface TimelineGroup {
  key: string;
  label: string;
  entries: TimelineEntry[];
}

/** 関わり方のラベルを組み立てる。作成者は「主催」、それ以外のスタッフは「スタッフ」。
 * タイムテーブルの担当に紐づいていれば「登壇」も添える */
export function entryRoles(
  event: MyEventSummary,
  userId: string,
  spokeEventIds: ReadonlySet<string>,
): string[] {
  const roles: string[] = [];
  if (event.myRole === "staff") {
    roles.push(event.createdBy === userId ? "主催" : "スタッフ");
  } else if (event.myRole === "judge") {
    roles.push("審査員");
  } else if (event.myRole === "observer") {
    roles.push("観覧者");
  }
  if (spokeEventIds.has(event.id)) roles.push("登壇");
  return roles;
}

/** 開催予定か（日程調整中は日付が未確定なので常に予定側） */
function isUpcoming(event: MyEventSummary, now: number): boolean {
  return event.scheduling || event.endsAt >= now;
}

/** 予定 → 年ごと（新しい順）にまとめる。並びは全体を通して新しい順のまま。
 * 日程調整中は日付が無いので予定の先頭に置く */
export function groupByYear(
  entries: TimelineEntry[],
  now: number,
): TimelineGroup[] {
  const upcoming: TimelineEntry[] = [];
  const past: TimelineEntry[] = [];
  for (const entry of entries) {
    (isUpcoming(entry.event, now) ? upcoming : past).push(entry);
  }
  // 日程調整中(startsAt=0)は日付が決まっていないので予定の先頭へ
  const sortKey = (e: TimelineEntry) =>
    e.event.scheduling ? Number.MAX_SAFE_INTEGER : e.event.startsAt;
  const byStartDesc = (a: TimelineEntry, b: TimelineEntry) =>
    sortKey(b) - sortKey(a);
  upcoming.sort(byStartDesc);
  past.sort(byStartDesc);

  const groups: TimelineGroup[] = [];
  if (upcoming.length > 0) {
    groups.push({ key: "upcoming", label: "参加予定", entries: upcoming });
  }
  for (const entry of past) {
    const year = new Date(entry.event.startsAt).getFullYear();
    const key = `y${year}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.entries.push(entry);
    else groups.push({ key, label: `${year}年`, entries: [entry] });
  }
  return groups;
}

/** 年表の1行。左に日付、右にイベント画像とタイトル */
function TimelineRow({ entry }: { entry: TimelineEntry }) {
  const { event, roles } = entry;
  const img = eventImageUrl(event);
  const color = eventColor(event.id);
  return (
    <Card variant="outlined">
      <CardActionArea
        component={RouterLink}
        to={`/events/${event.id}`}
        sx={{ display: "flex", alignItems: "stretch", p: 1, gap: 1 }}
      >
        <Box
          sx={{
            flexShrink: 0,
            width: { xs: 44, sm: 56 },
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontWeight: 700, lineHeight: 1.2 }}
          >
            {event.scheduling ? "調整中" : formatMonthDay(event.startsAt)}
          </Typography>
        </Box>
        {/* イベント画像。未生成のイベントは一覧のカードと同じ配色でタイトルを敷く。
            数十件並ぶので img の遅延読み込みに任せ、見えている分だけ取りに行く */}
        <Box
          sx={{
            flexShrink: 0,
            width: { xs: 92, sm: 120 },
            aspectRatio: "1200 / 630",
            borderRadius: 1,
            overflow: "hidden",
            ...(img
              ? {}
              : {
                  bgcolor: color.bg,
                  display: "flex",
                  alignItems: "center",
                  p: 0.75,
                }),
          }}
        >
          {img ? (
            <Box
              component="img"
              src={img}
              alt=""
              loading="lazy"
              sx={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: "block",
              }}
            />
          ) : (
            <Typography
              sx={{
                color: "#F1F5F9",
                fontWeight: 700,
                fontSize: { xs: 9, sm: 11 },
                lineHeight: 1.25,
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {event.title}
            </Typography>
          )}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0, alignSelf: "center" }}>
          <Typography
            sx={{
              fontWeight: 600,
              fontSize: { xs: "0.85rem", sm: "0.95rem" },
              lineHeight: 1.3,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {event.title}
          </Typography>
          {roles.length > 0 && (
            <Stack
              direction="row"
              spacing={0.5}
              flexWrap="wrap"
              useFlexGap
              sx={{ mt: 0.5 }}
            >
              {roles.map((role) => (
                <Chip
                  key={role}
                  size="small"
                  label={role}
                  variant="outlined"
                  color={role === "登壇" ? "secondary" : "default"}
                  sx={{ height: 20, fontSize: "0.7rem" }}
                />
              ))}
            </Stack>
          )}
        </Box>
      </CardActionArea>
    </Card>
  );
}

/**
 * 参加履歴の年表 (#308)。左に日付、右にイベント画像とタイトルを並べ、年で区切る。
 * 予定は上にまとめ、以降は新しい順。件数が多いときは古い側を畳んでおく。
 */
export function ParticipationTimeline({
  events,
  userId,
  speakerEventIds,
  now = Date.now(),
}: {
  events: MyEventSummary[];
  userId: string;
  speakerEventIds: string[];
  now?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  if (events.length === 0) return null;

  const spoke = new Set(speakerEventIds);
  const entries = events.map((event) => ({
    event,
    roles: entryRoles(event, userId, spoke),
  }));
  const groups = groupByYear(entries, now);

  // 予定は常に全部見せ、過去だけ INITIAL_PAST 件で打ち切る
  const upcomingCount = groups[0]?.key === "upcoming" ? groups[0].entries.length : 0;
  const pastCount = entries.length - upcomingCount;
  const hidden = expanded ? 0 : Math.max(0, pastCount - INITIAL_PAST);
  let shownPast = 0;
  const visibleGroups = expanded
    ? groups
    : groups.flatMap((group) => {
        if (group.key === "upcoming") return [group];
        const room = INITIAL_PAST - shownPast;
        if (room <= 0) return [];
        const slice = group.entries.slice(0, room);
        shownPast += slice.length;
        return [{ ...group, entries: slice }];
      });

  return (
    <Box>
      <Typography
        variant="h6"
        gutterBottom
        sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
      >
        <HistoryIcon fontSize="small" />
        参加の記録（{events.length}）
      </Typography>
      <Stack spacing={2}>
        {visibleGroups.map((group) => (
          <Box key={group.key}>
            <Typography
              variant="subtitle2"
              color="text.secondary"
              sx={{ mb: 0.75 }}
            >
              {group.label}
            </Typography>
            <Stack spacing={1}>
              {group.entries.map((entry) => (
                <TimelineRow key={entry.event.id} entry={entry} />
              ))}
            </Stack>
          </Box>
        ))}
      </Stack>
      {hidden > 0 && (
        <Button
          size="small"
          onClick={() => setExpanded(true)}
          sx={{ mt: 1.5 }}
        >
          もっと見る（残り {hidden}）
        </Button>
      )}
    </Box>
  );
}
