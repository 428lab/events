import { useMemo, useState } from "react";
import {
  Box,
  ButtonBase,
  Chip,
  Dialog,
  IconButton,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import type { Theme } from "@mui/material/styles";
import { Link as RouterLink } from "react-router-dom";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import CloseIcon from "@mui/icons-material/Close";
import PersonAddAlt1Icon from "@mui/icons-material/PersonAddAlt1";
import PeopleAltOutlinedIcon from "@mui/icons-material/PeopleAltOutlined";
import PlaceOutlinedIcon from "@mui/icons-material/PlaceOutlined";
import type { EventTimelinePhotos, MyEventSummary } from "@eventer/shared";
import { eventImageUrl } from "../api/hooks.js";
import { eventColor } from "./EventCard.js";
import { formatTime, participantCountLabel, venueLabel } from "../lib/format.js";

/** 区分フィルタの値。役割は「主催・運営」と「参加」の2つに寄せる（配色もこの2つ） */
type RoleFilter = "all" | "host" | "join";
type WhenFilter = "all" | "upcoming" | "past";

const ROLE_LABEL: Record<RoleFilter, string> = {
  all: "すべて",
  host: "主催・運営",
  join: "参加",
};
const WHEN_LABEL: Record<WhenFilter, string> = {
  all: "すべて",
  upcoming: "これから",
  past: "過去",
};

/** 狭い幅では中央縦線をやめて左寄せの1カラムに畳む */
const NARROW = "@media (max-width:640px)";

/** 淡い面の上に小さい文字で置くときの色。
 * dark はテーマ色そのまま、light は一段暗い派生値（どちらもテーマトークン由来） */
const inkOf = (t: Theme, role: "primary" | "secondary") =>
  t.palette.mode === "dark" ? t.palette[role].main : t.palette[role].dark;

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

/** 区分。一覧の4分類と同じ切り方（myRole が staff なら主催・運営側） */
function roleKindOf(event: MyEventSummary): "host" | "join" {
  return event.myRole === "staff" ? "host" : "join";
}

/** 年表に並べる1件ぶんの、表示に必要なものを揃えたもの */
interface TimelineItem {
  event: MyEventSummary;
  roles: string[];
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
        ? "日程調整中"
        : String(new Date(item.event.startsAt).getFullYear()),
      items: [item],
    });
  }
  return groups;
}

/** 会場の表示。オンラインのURLはそのまま出さず種別だけにする */
function venueText(event: MyEventSummary): string {
  if (event.venueType === "online") return venueLabel.online;
  return event.venueOffline?.trim() || venueLabel[event.venueType];
}

/** 日付ラベル（年はピル型見出しに任せず、カードでも通しで読めるようにする） */
function dateText(event: MyEventSummary): string {
  if (event.scheduling) return "日程調整中";
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

const photoUrl = (eventId: string, photoId: string) =>
  `/api/events/${eventId}/photos/${photoId}/image`;

/** 拡大表示中の写真 */
interface OpenPhoto {
  eventId: string;
  eventTitle: string;
  photoIds: string[];
  index: number;
}

/** カードに添える公開写真のサムネイル。コメントが多い順に数枚だけ並べ、
 * コメント数そのものは出さない（並び順の基準としてしか使わない）。
 * 残りは「+N」でだけ示す */
function PhotoStrip({
  eventId,
  eventTitle,
  photos,
  onOpen,
}: {
  eventId: string;
  eventTitle: string;
  photos: EventTimelinePhotos;
  onOpen: (p: OpenPhoto) => void;
}) {
  // 取得に失敗した写真。イベントの公開設定が読み込み後に変わると 403/404 に
  // なり得るので、壊れた画像アイコンではなく無地の枠で出す
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  // サーバーも同じ順で返すが、並び順はこの画面の約束なのでここでも保証しておく
  const ids = [...photos.photos]
    .sort((a, b) => b.commentCount - a.commentCount)
    .map((p) => p.id);
  const rest = Math.max(0, photos.total - ids.length);
  if (ids.length === 0) return null;
  return (
    <Stack
      direction="row"
      spacing={0.625}
      alignItems="center"
      sx={{ ml: "auto" }}
      aria-label="公開写真"
    >
      {ids.map((id, i) => (
        <ButtonBase
          key={id}
          onClick={() => onOpen({ eventId, eventTitle, photoIds: ids, index: i })}
          aria-label={`写真${i + 1}枚目を拡大表示`}
          sx={{
            width: { xs: 31, sm: 36 },
            height: { xs: 31, sm: 36 },
            flexShrink: 0,
            borderRadius: "9px",
            overflow: "hidden",
            bgcolor: "action.hover",
            transition: "transform .14s ease, box-shadow .14s ease",
            "&:hover, &.Mui-focusVisible": {
              transform: "scale(1.14)",
              zIndex: 3,
              boxShadow: (t) => `0 0 0 2px ${t.palette.primary.main}`,
            },
          }}
        >
          {!failed.has(id) && (
            <Box
              component="img"
              src={photoUrl(eventId, id)}
              alt=""
              loading="lazy"
              onError={() =>
                setFailed((prev) => new Set(prev).add(id))
              }
              sx={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: "block",
              }}
            />
          )}
        </ButtonBase>
      ))}
      {rest > 0 && (
        <Box
          component="span"
          title={`ほか${rest}枚`}
          sx={{
            width: { xs: 31, sm: 36 },
            height: { xs: 31, sm: 36 },
            flexShrink: 0,
            borderRadius: "9px",
            display: "grid",
            placeItems: "center",
            fontSize: 11,
            fontWeight: 800,
            color: "text.secondary",
            border: "1px dashed",
            borderColor: "divider",
          }}
        >
          +{rest}
        </Box>
      )}
    </Stack>
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
  const { event, roles, kind, when, meets, photos } = item;
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
            color: (t) => inkOf(t, accent),
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
              ? "日程調整中"
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
                出会った {meets} 人
              </Box>
            </Meta>
          )}
        </Box>
        <Stack direction="row" flexWrap="wrap" alignItems="center" gap={0.75}>
          {/* 塗り＝主催・運営 / 枠線＝参加。関わり方が分かる細かいラベルは残し、
              登壇は「主催かどうか」とは別の軸なので独立したチップにする */}
          <Chip
            size="small"
            label={roles.find((r) => r !== "登壇") ?? "参加"}
            color={accent}
            variant={kind === "host" ? "filled" : "outlined"}
            sx={{ fontWeight: 800, height: 24 }}
          />
          {roles.includes("登壇") && (
            <Chip
              size="small"
              label="登壇"
              color="secondary"
              variant="outlined"
              sx={{ fontWeight: 800, height: 24 }}
            />
          )}
          {when === "upcoming" && (
            <Chip
              size="small"
              label="これから"
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
            <PhotoStrip
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
          boxShadow: (t) =>
            when === "upcoming"
              ? `0 0 0 4px ${t.palette.background.default}, 0 0 0 6px ${t.palette[accent].main}`
              : `0 0 0 4px ${t.palette.background.default}, 0 0 0 5px ${t.palette[accent].main}`,
          [NARROW]: { gridColumn: 1 },
        }}
      />
    </Box>
  );
}

/** 区分フィルタのチップ1つ。件数を添える */
function FilterChip({
  label,
  count,
  selected,
  swatch,
  onClick,
}: {
  label: string;
  count: number;
  selected: boolean;
  swatch?: "primary" | "secondary";
  onClick: () => void;
}) {
  return (
    <Chip
      clickable
      onClick={onClick}
      aria-pressed={selected}
      color={selected ? "primary" : "default"}
      variant={selected ? "filled" : "outlined"}
      // 0件は薄く。ただし選択中は薄くしない（いまどこにいるか分からなくなる）
      sx={{
        fontWeight: 700,
        opacity: count === 0 && !selected ? 0.5 : 1,
      }}
      icon={
        swatch ? (
          <Box
            sx={{
              width: 9,
              height: 9,
              borderRadius: "50%",
              bgcolor: `${swatch}.main`,
              ml: 1.25,
            }}
          />
        ) : undefined
      }
      label={`${label} ${count}`}
    />
  );
}

/**
 * 参加履歴の年表 (#308, #315)。中央の縦線に対してカードを左右交互に置き、
 * 年はピル型ラベルで区切る。狭い幅では1カラムに畳む。
 * 区分（主催・運営／参加）と時期（これから／過去）で絞り込める。
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
  const [role, setRole] = useState<RoleFilter>("all");
  const [when, setWhen] = useState<WhenFilter>("all");
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

  const match = (it: TimelineItem, r: RoleFilter, w: WhenFilter) =>
    (r === "all" || it.kind === r) && (w === "all" || it.when === w);
  const count = (r: RoleFilter, w: WhenFilter) =>
    items.filter((it) => match(it, r, w)).length;

  const visible = items.filter((it) => match(it, role, when));
  const groups = groupByYear(visible);
  // 表示中のカードの出会い数の合計。同じ人と別のイベントで会えば2件と数える
  // 延べ件数なので、プロフィール上部の「出会った人（実人数）」とは別物として出す
  const metTotal = visible.reduce((s, it) => s + it.meets, 0);

  // 左右交互は「見えている順」で振り直す（絞り込んでも片側に偏らない）
  let seq = 0;

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        参加履歴の年表
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        区分で絞り込めます。件数は、もう一方の絞り込みを反映した数です。
      </Typography>

      <Box
        sx={{
          p: 1.75,
          mb: 3,
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          display: "flex",
          flexDirection: "column",
          gap: 1.25,
        }}
      >
        <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontWeight: 800, letterSpacing: "0.08em", width: 44 }}
          >
            区分
          </Typography>
          {(["all", "host", "join"] as const).map((v) => (
            <FilterChip
              key={v}
              label={ROLE_LABEL[v]}
              count={count(v, when)}
              selected={role === v}
              swatch={v === "host" ? "primary" : v === "join" ? "secondary" : undefined}
              onClick={() => setRole(v)}
            />
          ))}
        </Stack>
        <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontWeight: 800, letterSpacing: "0.08em", width: 44 }}
          >
            時期
          </Typography>
          {(["all", "upcoming", "past"] as const).map((v) => (
            <FilterChip
              key={v}
              label={WHEN_LABEL[v]}
              count={count(role, v)}
              selected={when === v}
              onClick={() => setWhen(v)}
            />
          ))}
        </Stack>
        <Typography
          variant="body2"
          color="text.secondary"
          role="status"
          sx={{ borderTop: 1, borderColor: "divider", pt: 1 }}
        >
          表示中 {visible.length} 件 ・ 出会いの記録 {metTotal} 件
        </Typography>
      </Box>

      {visible.length === 0 ? (
        <Box
          sx={{
            textAlign: "center",
            py: 5,
            px: 2.5,
            border: "1px dashed",
            borderColor: "divider",
            borderRadius: 1,
          }}
          role="status"
        >
          <Typography fontWeight={800} gutterBottom>
            {[
              when === "all" ? null : WHEN_LABEL[when],
              role === "all" ? null : ROLE_LABEL[role],
            ]
              .filter(Boolean)
              .join(" × ") || ""}
            {role === "all" && when === "all" ? "履歴" : " の履歴"}
            はまだありません
          </Typography>
          <Typography variant="body2" color="text.secondary">
            「すべて」に戻すと、ほかの履歴が表示されます。
          </Typography>
        </Box>
      ) : (
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
              background: (t) =>
                `linear-gradient(180deg, transparent 0, ${t.palette.primary.main} 7%, ${t.palette.secondary.main} 93%, transparent 100%)`,
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
      )}

      <PhotoLightbox open={open} onChange={setOpen} onClose={() => setOpen(null)} />
    </Box>
  );
}

/** 写真の拡大表示。開くのはクリック/タップのみ（hover では開かない） */
function PhotoLightbox({
  open,
  onChange,
  onClose,
}: {
  open: OpenPhoto | null;
  onChange: (p: OpenPhoto) => void;
  onClose: () => void;
}) {
  if (!open) return null;
  const { eventId, eventTitle, photoIds, index } = open;
  const step = (d: number) =>
    onChange({
      ...open,
      index: (index + d + photoIds.length) % photoIds.length,
    });
  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="lg"
      aria-label="写真の拡大表示"
      // ←→ で前後の写真へ。閉じるは Esc と背景クリック（Dialog 側）と
      // 閉じるボタン。閉じたときのフォーカス戻しも Dialog に任せる
      onKeyDown={(e) => {
        if (photoIds.length < 2) return;
        if (e.key === "ArrowLeft") step(-1);
        else if (e.key === "ArrowRight") step(1);
      }}
    >
      <Box sx={{ position: "relative", bgcolor: "#000" }}>
        <IconButton
          onClick={onClose}
          aria-label="閉じる"
          sx={{ position: "absolute", top: 8, right: 8, color: "#fff", zIndex: 1 }}
        >
          <CloseIcon />
        </IconButton>
        {photoIds.length > 1 && (
          <>
            <IconButton
              onClick={() => step(-1)}
              aria-label="前の写真"
              sx={{
                position: "absolute",
                top: "50%",
                left: 8,
                transform: "translateY(-50%)",
                color: "#fff",
                zIndex: 1,
              }}
            >
              <ChevronLeftIcon />
            </IconButton>
            <IconButton
              onClick={() => step(1)}
              aria-label="次の写真"
              sx={{
                position: "absolute",
                top: "50%",
                right: 8,
                transform: "translateY(-50%)",
                color: "#fff",
                zIndex: 1,
              }}
            >
              <ChevronRightIcon />
            </IconButton>
          </>
        )}
        <Box
          component="img"
          src={photoUrl(eventId, photoIds[index])}
          alt=""
          sx={{
            display: "block",
            maxWidth: "90vw",
            maxHeight: "85vh",
            objectFit: "contain",
          }}
        />
        <Box
          sx={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            p: 1,
            bgcolor: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            gap: 1,
          }}
        >
          <Link
            component={RouterLink}
            to={`/events/${eventId}`}
            sx={{ color: "#fff", minWidth: 0 }}
            underline="hover"
            noWrap
          >
            {eventTitle} を見る →
          </Link>
          {photoIds.length > 1 && (
            <Typography
              sx={{ color: "#fff", ml: "auto", fontVariantNumeric: "tabular-nums" }}
              variant="body2"
            >
              {index + 1} / {photoIds.length}
            </Typography>
          )}
        </Box>
      </Box>
    </Dialog>
  );
}
