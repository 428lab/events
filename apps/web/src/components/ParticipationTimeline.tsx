import { useMemo, useState } from "react";
import { Box, Chip, Link, Stack, Typography } from "@mui/material";
import type { Theme } from "@mui/material/styles";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import PersonAddAlt1Icon from "@mui/icons-material/PersonAddAlt1";
import PeopleAltOutlinedIcon from "@mui/icons-material/PeopleAltOutlined";
import PlaceOutlinedIcon from "@mui/icons-material/PlaceOutlined";
import type { EventTimelinePhotos, MyEventSummary } from "@eventer/shared";
import {
  TimelinePhotoLightbox,
  TimelinePhotoStrip,
  type OpenPhoto,
} from "./TimelinePhotoStrip.js";
import { eventImageUrl } from "../api/hooks.js";
import { eventColor } from "./EventCard.js";
import { DraftChip, isDraftEvent } from "./DraftChip.js";
import {
  formatTime,
  participantCountLabel,
  roleLabel,
  venueLabel,
} from "../lib/format.js";
import { i18next } from "../i18n/index.js";

/** 狭い幅では中央縦線をやめて左寄せの1カラムに畳む */
const NARROW = "@media (max-width:640px)";

/** 淡い面の上に小さい文字で置くときの色。
 * dark はテーマ色そのまま、light は一段暗い派生値（どちらもテーマトークン由来） */
const inkOf = (t: Theme, role: "primary" | "secondary") =>
  t.palette.mode === "dark" ? t.palette[role].main : t.palette[role].dark;

/** 年表のチップに出す「関わり方」。文言ではなくキーを返す（呼ぶ側が判定に使うため） */
export type EntryRole = "host" | "staff" | "judge" | "observer" | "speaker";

/** 関わり方を並べる。作成者は「主催」、それ以外のスタッフは「スタッフ」。
 * タイムテーブルの担当に紐づいていれば「登壇」も添える */
export function entryRoles(
  event: MyEventSummary,
  userId: string,
  spokeEventIds: ReadonlySet<string>,
): EntryRole[] {
  const roles: EntryRole[] = [];
  if (event.myRole === "staff") {
    roles.push(event.createdBy === userId ? "host" : "staff");
  } else if (event.myRole === "judge") {
    roles.push("judge");
  } else if (event.myRole === "observer") {
    roles.push("observer");
  }
  if (spokeEventIds.has(event.id)) roles.push("speaker");
  return roles;
}

/** 関わり方のキーを表示用の文言にする。イベント内での立場は `role.*` を再利用し、
 * 年表だけの言い方（主催 / 登壇）を `profile.*` が持つ */
function entryRoleLabel(role: EntryRole): string {
  if (role === "host") return i18next.t("profile.roleHost");
  if (role === "speaker") return i18next.t("profile.roleSpeaker");
  return roleLabel(role);
}

/** 開催予定か（日程調整中は日付が未確定なので常に予定側） */
function isUpcoming(event: MyEventSummary, now: number): boolean {
  return event.scheduling || event.endsAt >= now;
}

/** 区分。一覧の4分類と同じ切り方（myRole が staff なら主催・運営側） */
function roleKindOf(event: MyEventSummary): "host" | "join" {
  return event.myRole === "staff" ? "host" : "join";
}

/** 年表に並べる1件ぶんの、表示に必要なものを揃えたもの */
interface TimelineItem {
  event: MyEventSummary;
  roles: EntryRole[];
  kind: "host" | "join";
  when: "upcoming" | "past";
  /** そのイベントで出会った人数。0なら出さない */
  meets: number;
  photos: EventTimelinePhotos | undefined;
}

/** 日程調整中(startsAt=0)は日付が決まっていないので先頭へ */
const sortKey = (e: MyEventSummary) =>
  e.scheduling ? Number.MAX_SAFE_INTEGER : e.startsAt;

/** 年（日程調整中はまとめて1つ）でひとかたまりにする。並びは新しい順のまま。
 * 見出しは中央のピル型ラベルとして出す */
export function groupByYear(
  items: TimelineItem[],
): { key: string; label: string; items: TimelineItem[] }[] {
  const sorted = [...items].sort((a, b) => sortKey(b.event) - sortKey(a.event));
  const groups: { key: string; label: string; items: TimelineItem[] }[] = [];
  for (const item of sorted) {
    const key = item.event.scheduling
      ? "scheduling"
      : `y${new Date(item.event.startsAt).getFullYear()}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(item);
      continue;
    }
    groups.push({
      key,
      label: item.event.scheduling
        ? i18next.t("events.schedulingBadge")
        : String(new Date(item.event.startsAt).getFullYear()),
      items: [item],
    });
  }
  return groups;
}

/** 会場の表示。オンラインのURLはそのまま出さず種別だけにする */
function venueText(event: MyEventSummary): string {
  if (event.venueType === "online") return venueLabel("online");
  return event.venueOffline?.trim() || venueLabel(event.venueType);
}

/** 日付ラベル（年はピル型見出しに任せず、カードでも通しで読めるようにする） */
function dateText(event: MyEventSummary): string {
  if (event.scheduling) return i18next.t("events.schedulingBadge");
  const d = new Date(event.startsAt);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

/** メタ行の1項目（アイコン＋テキスト） */
function Meta({
  icon,
  children,
  strong = false,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <Box
      component="span"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        minWidth: 0,
        color: strong ? "text.primary" : "text.secondary",
        "& > svg": { fontSize: 15, flexShrink: 0, opacity: strong ? 1 : 0.85 },
      }}
    >
      {icon}
      {children}
    </Box>
  );
}

/** 年表の1件（カード＋中央線のドット）。カードは左右交互に置く */
function TimelineCard({
  item,
  side,
  onOpenPhoto,
}: {
  item: TimelineItem;
  side: "left" | "right";
  onOpenPhoto: (p: OpenPhoto) => void;
}) {
  const { t } = useTranslation();
  const { event, roles, kind, when, meets, photos } = item;
  // 塗り分けの主になる関わり方。登壇は別軸なので独立したチップに回す
  const mainRole = roles.find((r) => r !== "speaker");
  const img = eventImageUrl(event);
  const color = eventColor(event.id);
  const accent = kind === "host" ? "primary" : "secondary";
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "1fr 44px 1fr",
        alignItems: "start",
        mb: 3.25,
        "& > *": { gridRow: 1 },
        [NARROW]: { gridTemplateColumns: "28px 1fr" },
      }}
    >
      <Box
        sx={{
          position: "relative",
          width: "100%",
          maxWidth: 380,
          minWidth: 0,
          gridColumn: side === "left" ? 1 : 3,
          justifySelf: side === "left" ? "end" : "start",
          bgcolor: "background.paper",
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          p: 1.75,
          display: "flex",
          flexDirection: "column",
          gap: 1.125,
          transition: "transform .18s ease, border-color .18s ease",
          "&:hover": {
            transform: "translateY(-3px)",
            borderColor: `${accent}.main`,
          },
          // カードと中央線をつなぐ横線
          "&::before": {
            content: '""',
            position: "absolute",
            top: 28,
            [side === "left" ? "right" : "left"]: -22,
            width: 22,
            height: "1px",
            bgcolor: `${accent}.main`,
            opacity: 0.55,
          },
          [NARROW]: {
            gridColumn: 2,
            justifySelf: "stretch",
            maxWidth: "none",
            "&::before": { right: "auto", left: -14, width: 14 },
          },
          "@media (prefers-reduced-motion: reduce)": {
            "&:hover": { transform: "none" },
          },
        }}
      >
        <Typography
          sx={{
            fontSize: 11.5,
            fontWeight: 700,
            letterSpacing: "0.1em",
            fontVariantNumeric: "tabular-nums",
            color: (theme) => inkOf(theme, accent),
          }}
        >
          {dateText(event)}
        </Typography>
        <Link
          component={RouterLink}
          to={`/events/${event.id}`}
          underline="hover"
          color="inherit"
          sx={{
            fontSize: { xs: 16.5, sm: 17.5 },
            fontWeight: 800,
            lineHeight: 1.35,
            letterSpacing: "-0.01em",
            overflowWrap: "anywhere",
          }}
        >
          {event.title}
        </Link>
        {/* イベント画像。無いイベントは一覧のカードと同じ配色を敷いてタイトルを出す。
            数十件並ぶので img の遅延読み込みに任せ、見えている分だけ取りに行く */}
        <Box
          component={RouterLink}
          to={`/events/${event.id}`}
          aria-hidden="true"
          tabIndex={-1}
          sx={{
            position: "relative",
            display: "block",
            width: "100%",
            aspectRatio: "16 / 9",
            borderRadius: "10px",
            overflow: "hidden",
            ...(img
              ? {}
              : {
                  bgcolor: color.bg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  p: 1.5,
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
                fontWeight: 800,
                fontSize: 15,
                lineHeight: 1.3,
                textAlign: "center",
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
        <Box
          sx={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "3px 12px",
            fontSize: 12.5,
            lineHeight: 1.45,
          }}
        >
          <Meta icon={<AccessTimeIcon />}>
            {event.scheduling
              ? t("events.schedulingBadge")
              : `${formatTime(event.startsAt)}–${formatTime(event.endsAt)}`}
          </Meta>
          <Meta icon={<PlaceOutlinedIcon />}>{venueText(event)}</Meta>
          <Meta icon={<PeopleAltOutlinedIcon />}>
            {participantCountLabel(event)}
          </Meta>
          {/* 出会いは「イベントの事実」ではなく「その人の記録」なので一段強調する。
              0人のイベントは項目ごと出さない */}
          {meets > 0 && (
            <Meta icon={<PersonAddAlt1Icon color={accent} />} strong>
              <Box component="span" sx={{ fontWeight: 800 }}>
                {t("profile.metCount", { n: meets })}
              </Box>
            </Meta>
          )}
        </Box>
        <Stack direction="row" flexWrap="wrap" alignItems="center" gap={0.75}>
          {/* 公開前は一覧のカードと同じ印を先頭に出す。年表でも公開済みと
              同じ見え方にしない (#348) */}
          {isDraftEvent(event) && <DraftChip />}
          {/* 塗り＝主催・運営 / 枠線＝参加。関わり方が分かる細かいラベルは残し、
              登壇は「主催かどうか」とは別の軸なので独立したチップにする */}
          <Chip
            size="small"
            label={mainRole ? entryRoleLabel(mainRole) : t("profile.filterJoin")}
            color={accent}
            variant={kind === "host" ? "filled" : "outlined"}
            sx={{ fontWeight: 800, height: 24 }}
          />
          {roles.includes("speaker") && (
            <Chip
              size="small"
              label={entryRoleLabel("speaker")}
              color="secondary"
              variant="outlined"
              sx={{ fontWeight: 800, height: 24 }}
            />
          )}
          {when === "upcoming" && (
            <Chip
              size="small"
              label={t("profile.filterUpcoming")}
              variant="outlined"
              icon={
                <Box
                  sx={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    bgcolor: "success.main",
                    ml: 1,
                  }}
                />
              }
              sx={{ fontWeight: 700, height: 24 }}
            />
          )}
          {photos && (
            <TimelinePhotoStrip
              eventId={event.id}
              eventTitle={event.title}
              photos={photos}
              onOpen={onOpenPhoto}
            />
          )}
        </Stack>
      </Box>
      {/* 中央線のドット。これからのイベントは中抜きにする */}
      <Box
        sx={{
          gridColumn: 2,
          justifySelf: "center",
          mt: "22px",
          width: 11,
          height: 11,
          borderRadius: "50%",
          position: "relative",
          zIndex: 2,
          bgcolor: when === "upcoming" ? "background.default" : `${accent}.main`,
          boxShadow: (theme) =>
            when === "upcoming"
              ? `0 0 0 4px ${theme.palette.background.default}, 0 0 0 6px ${theme.palette[accent].main}`
              : `0 0 0 4px ${theme.palette.background.default}, 0 0 0 5px ${theme.palette[accent].main}`,
          [NARROW]: { gridColumn: 1 },
        }}
      />
    </Box>
  );
}

/**
 * 参加履歴の年表 (#308, #315)。中央の縦線に対してカードを左右交互に置き、
 * 年はピル型ラベルで区切る。狭い幅では1カラムに畳む。
 * 区分・時期の絞り込みは持たない（プロフィールのタブがその軸を持つ #407）。
 * 渡されたイベント列をそのまま年表として描く。
 */
export function ParticipationTimeline({
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
  /** イベントid → 出会った人数 (#315) */
  meetCounts?: Record<string, number>;
  /** イベントごとの公開写真サムネイル (#315) */
  eventPhotos?: EventTimelinePhotos[];
  now?: number;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<OpenPhoto | null>(null);

  const items = useMemo<TimelineItem[]>(() => {
    const spoke = new Set(speakerEventIds);
    const photoMap = new Map(
      (eventPhotos ?? []).map((p) => [p.eventId, p] as const),
    );
    return events.map((event) => ({
      event,
      roles: entryRoles(event, userId, spoke),
      kind: roleKindOf(event),
      when: isUpcoming(event, now) ? ("upcoming" as const) : ("past" as const),
      meets: meetCounts?.[event.id] ?? 0,
      photos: photoMap.get(event.id),
    }));
  }, [events, userId, speakerEventIds, meetCounts, eventPhotos, now]);

  if (events.length === 0) return null;

  const groups = groupByYear(items);
  // カードの出会い数の合計。同じ人と別のイベントで会えば2件と数える延べ件数
  // なので、プロフィール上部の「出会った人（実人数）」とは別物として出す
  const metTotal = items.reduce((s, it) => s + it.meets, 0);

  // 左右交互は「見えている順」で振り直す
  let seq = 0;

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        {t("profile.timelineHeading")}
      </Typography>
      <Typography
        variant="body2"
        color="text.secondary"
        role="status"
        sx={{ mb: 3 }}
      >
        {t("profile.timelineSummary", { n: items.length, m: metTotal })}
      </Typography>

      <Box
        sx={{
          position: "relative",
          pt: 0.5,
          pb: 1,
          "&::before": {
            content: '""',
            position: "absolute",
            left: "50%",
            top: 0,
            bottom: 0,
            width: 2,
            transform: "translateX(-1px)",
            opacity: 0.55,
            background: (theme) =>
              `linear-gradient(180deg, transparent 0, ${theme.palette.primary.main} 7%, ${theme.palette.secondary.main} 93%, transparent 100%)`,
            [NARROW]: { left: 14, transform: "none" },
          },
        }}
      >
        {groups.map((group) => (
          <Box key={group.key}>
            <Box
              sx={{
                display: "flex",
                justifyContent: "center",
                mb: 2.75,
                position: "relative",
                zIndex: 2,
              }}
            >
              <Typography
                component="span"
                sx={{
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: "0.16em",
                  fontVariantNumeric: "tabular-nums",
                  px: 2.25,
                  py: 0.75,
                  borderRadius: 999,
                  border: 1,
                  borderColor: "divider",
                  bgcolor: "background.paper",
                }}
              >
                {group.label}
              </Typography>
            </Box>
            {group.items.map((item) => (
              <TimelineCard
                key={item.event.id}
                item={item}
                side={seq++ % 2 === 0 ? "left" : "right"}
                onOpenPhoto={setOpen}
              />
            ))}
          </Box>
        ))}
      </Box>

      <TimelinePhotoLightbox open={open} onChange={setOpen} onClose={() => setOpen(null)} />
    </Box>
  );
}

