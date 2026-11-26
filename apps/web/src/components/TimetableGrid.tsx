import { useEffect, useState } from "react";
import { Avatar, Box, Chip, Typography } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { useTranslation } from "react-i18next";
import {
  nowRow,
  timeState,
  type TimetableCard,
  type TimetableLayout,
} from "../lib/timetableLayout.js";
import { formatMonthDay, formatTime } from "../lib/format.js";

/** 時刻の列の幅 */
const TIME_COL_PX = 72;
/** 縦の線と丸の列の幅 */
const DOT_COL_PX = 28;
/** 右の細い列（並行して長く続く企画。縦書き）の幅 */
const SIDE_COL_PX = 52;
/** 行と行の間。詰めすぎると読みにくい（オーナー 2026-11-27「詰まりすぎてて見づらい」） */
const ROW_GAP_PX = 14;
/** 列と列の間 */
const COL_GAP_PX = 10;
/** 「いま」の印を引き直す間隔。分の表示なので1分ごとで足りる */
const NOW_TICK_MS = 60_000;

/** 読み上げにだけ出す（目には見えない） */
const SR_ONLY = {
  position: "absolute",
  width: "1px",
  height: "1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
} as const;

/** カードに出す時間の帯（例 "10:00–10:20"） */
function rangeLabel(card: TimetableCard): string {
  if (card.entry.item.durationMin <= 0) return formatTime(card.startsAt);
  return `${formatTime(card.startsAt)}–${formatTime(card.endsAt)}`;
}

function speakerOf(card: TimetableCard) {
  const it = card.entry.item;
  if (it.speaker) {
    return {
      name: it.speaker.globalName ?? it.speaker.username,
      avatarUrl: it.speaker.avatarUrl,
    };
  }
  return it.speakerName ? { name: it.speakerName, avatarUrl: null } : null;
}

/** 今の時刻。分の変わり目ごとに読み直す（setTimeout のつなぎ。サーバーには問い合わせない） */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        setNow(Date.now());
        schedule();
      }, NOW_TICK_MS - (Date.now() % NOW_TICK_MS));
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);
  return now;
}

/** 広い画面のタイムテーブル。縦のタイムライン（オーナー 2026-11-27、nostrasia.com を参考に）。
 *
 * - 左に時刻、その右に縦の線と丸。行は **コマの始まる時刻** ごとで、時間の長さには比例させない
 *   （5分の登壇が続いても潰れない）。行の間はゆったり空ける
 * - 本筋のコマは横幅いっぱいのカード。左の太い線と場所の札がトラックの色
 *   （全トラック共通はテーマの主色。灰色にしない）
 * - 並行して長く続く企画は、右の細い列に縦書きで置く。本筋のカードは、その時間に
 *   空いている細い列のぶんまで広がる
 * - 同じ時刻に重なる本筋のコマは横に並べる (#345)
 * - 過去のコマは薄く、開催中のコマは強調し、「いま」の位置に印を引く
 * - 裏方 (#383) は破線＋鍵の印 */
export function TimetableGrid({
  layout,
  colors,
}: {
  layout: TimetableLayout;
  /** トラックと同じ並びの色。テーマから導いた値 (lib/trackColors.ts)。
   * `null` は**スタッフ用の列** (#383)。色を持たず無彩色で描く */
  colors: Array<string | null>;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const now = useNow();
  const { tracks, cards, rows, sideLanes } = layout;
  if (cards.length === 0 || rows.length === 0) return null;

  const light = theme.palette.mode === "light";
  const ink = theme.palette.text.primary;
  const live = theme.palette.error.main;
  const commonColor = theme.palette.primary.main;
  const neutral = theme.palette.text.secondary;
  const colorOfTrack = (i: number) => colors[i] ?? neutral;
  const colorOf = (card: TimetableCard) =>
    card.common ? commonColor : colorOfTrack(card.trackIndexes[0]!);
  // 細い列 k（0 が右端）の grid の列番号。本筋は 3
  const sideColumn = (lane: number) => 3 + (sideLanes - lane);
  // 日をまたぐイベントだけ、日の変わり目に日付を添える
  const multiDay =
    new Date(rows[0]!).toDateString() !== new Date(rows[rows.length - 1]!).toDateString();
  const marker = nowRow(layout, now);

  /** 行ごとの状態。その行で始まるコマが1つでも開催中なら live、全部終わっていれば past */
  const rowState = rows.map((ms) => {
    const starting = cards.filter((c) => c.startsAt === ms);
    const states = starting.map((c) => timeState(c, now));
    if (states.includes("live")) return "live";
    if (states.length > 0 && states.every((s) => s === "past")) return "past";
    return "future";
  });

  const placeChip = (label: string, color: string, staff = false, key?: string) => (
    <Box
      key={key ?? label}
      component="span"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        fontSize: "0.72rem",
        fontWeight: 700,
        lineHeight: 1.6,
        whiteSpace: "nowrap",
        px: 0.75,
        borderRadius: 1,
        border: "1px solid",
        borderColor: alpha(ink, light ? 0.18 : 0.24),
        borderLeft: `4px solid ${color}`,
        bgcolor: alpha(color, light ? 0.08 : 0.14),
        color: "text.primary",
      }}
    >
      {staff && <LockOutlinedIcon sx={{ fontSize: 12 }} titleAccess={t("schedule.staffTrack")} />}
      {label}
    </Box>
  );

  const placesOf = (card: TimetableCard) =>
    card.common
      ? [placeChip(t("schedule.commonColumn"), commonColor)]
      : card.trackIndexes.map((i) =>
          placeChip(tracks[i]!.name, colorOfTrack(i), colors[i] === null, tracks[i]!.id),
        );

  return (
    // 役割とラベル、そしてフォーカスはスクロールするこの外側に置く（キーボードだけでも横に動かせる）。
    // 行やセルを持たない描き方なので、role は region にする
    <Box
      role="region"
      aria-label={t("schedule.timetable")}
      tabIndex={0}
      sx={{
        overflowX: "auto",
        border: 1,
        borderColor: "divider",
        borderRadius: 2,
        bgcolor: "background.paper",
        px: { md: 2.5, lg: 3 },
        py: 3,
      }}
    >
      <Box
        sx={{
          display: "grid",
          position: "relative",
          minWidth: `${TIME_COL_PX + DOT_COL_PX + 360 + sideLanes * SIDE_COL_PX}px`,
          gridTemplateColumns: `${TIME_COL_PX}px ${DOT_COL_PX}px minmax(0, 1fr)${" " + `${SIDE_COL_PX}px `.repeat(sideLanes)}`.trimEnd(),
          gridTemplateRows: `repeat(${rows.length}, auto)`,
          columnGap: `${COL_GAP_PX}px`,
          rowGap: `${ROW_GAP_PX}px`,
          alignItems: "start",
        }}
      >
        {/* 縦の線（丸の列の真ん中） */}
        <Box
          aria-hidden
          style={{ gridColumn: "2", gridRow: `1 / ${rows.length + 1}` }}
          sx={{
            justifySelf: "center",
            alignSelf: "stretch",
            width: "3px",
            my: "14px",
            borderRadius: 2,
            bgcolor: alpha(ink, light ? 0.7 : 0.55),
          }}
        />

        {/* 時刻と丸 */}
        {rows.map((ms, i) => {
          const state = rowState[i];
          const dayChanged =
            multiDay && (i === 0 || new Date(rows[i - 1]!).toDateString() !== new Date(ms).toDateString());
          return [
            <Box
              key={`time-${ms}`}
              style={{ gridColumn: "1", gridRow: String(i + 1) }}
              sx={{ textAlign: "right", opacity: state === "past" ? 0.45 : 1 }}
            >
              {dayChanged && (
                <Typography
                  component="div"
                  sx={{ fontSize: "0.72rem", fontWeight: 700, lineHeight: 1.2 }}
                  color="text.secondary"
                >
                  {formatMonthDay(ms)}
                </Typography>
              )}
              <Typography
                component="time"
                dateTime={new Date(ms).toISOString()}
                sx={{
                  display: "inline-block",
                  fontSize: "1.1rem",
                  fontWeight: 700,
                  lineHeight: "28px",
                  fontVariantNumeric: "tabular-nums",
                  ...(state === "live"
                    ? { bgcolor: live, color: theme.palette.getContrastText(live), px: 0.75, borderRadius: 1 }
                    : {}),
                }}
              >
                {formatTime(ms)}
              </Typography>
            </Box>,
            <Box
              key={`dot-${ms}`}
              aria-hidden
              style={{ gridColumn: "2", gridRow: String(i + 1) }}
              sx={{
                justifySelf: "center",
                mt: "6px",
                width: 16,
                height: 16,
                borderRadius: "50%",
                border: "3px solid",
                borderColor: state === "live" ? live : alpha(ink, light ? 0.85 : 0.7),
                bgcolor:
                  state === "live"
                    ? live
                    : state === "past"
                      ? alpha(ink, light ? 0.85 : 0.7)
                      : "background.paper",
                boxShadow: state === "live" ? `0 0 0 4px ${alpha(live, 0.25)}` : "none",
                zIndex: 1,
              }}
            />,
          ];
        })}

        {/* カード */}
        {cards.map((card) => {
          const it = card.entry.item;
          const color = colorOf(card);
          const state = timeState(card, now);
          const speaker = speakerOf(card);
          const note = it.description.trim();
          const label = `${rangeLabel(card)} ${it.title}${speaker ? ` / ${speaker.name}` : ""}`;
          const frame = {
            position: "relative",
            minWidth: 0,
            borderRadius: "10px",
            border: "1px solid",
            borderColor: state === "live" ? live : alpha(ink, light ? 0.16 : 0.22),
            borderLeft: `6px solid ${color}`,
            bgcolor: state === "live" ? alpha(live, light ? 0.05 : 0.1) : alpha(color, light ? 0.05 : 0.08),
            opacity: state === "past" ? 0.45 : 1,
            boxShadow: state === "live" ? `0 0 0 2px ${alpha(live, 0.25)}` : "none",
            ...(card.staffOnly ? { borderStyle: "dashed", borderLeftStyle: "solid" } : {}),
          } as const;

          if (card.side) {
            // 縦書きの細いカード。中身は枠の大きさに合わせて切る（行の高さを押し広げない）
            return (
              <Box
                key={card.key}
                data-timetable-block={it.id}
                data-timetable-side
                title={label}
                style={{
                  gridColumn: String(sideColumn(card.lane)),
                  gridRow: `${card.rowStart} / ${card.rowEnd}`,
                }}
                sx={{ ...frame, alignSelf: "stretch", borderLeft: "1px solid", borderTop: `5px solid ${color}`, borderLeftColor: frame.borderColor, overflow: "hidden" }}
              >
                <Box
                  sx={{
                    position: "absolute",
                    inset: 0,
                    py: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 0.75,
                    writingMode: "vertical-rl",
                    overflow: "hidden",
                  }}
                >
                  <Typography
                    component="span"
                    sx={{ fontSize: "0.95rem", fontWeight: 800, lineHeight: 1.3, letterSpacing: "0.04em", whiteSpace: "nowrap" }}
                  >
                    {it.title}
                  </Typography>
                  <Typography
                    component="span"
                    sx={{ fontSize: "0.72rem", lineHeight: 1.3, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}
                    color="text.secondary"
                  >
                    {rangeLabel(card)}
                  </Typography>
                  <Box component="span" sx={SR_ONLY}>
                    {card.common
                      ? t("schedule.commonColumn")
                      : card.trackIndexes.map((i) => tracks[i]!.name).join(t("common.dotSeparator"))}
                  </Box>
                </Box>
              </Box>
            );
          }

          // 本筋のカード。空いている細い列のぶんまで広げ、重なるものは横に並べる (#345)
          const lanes = card.laneCount;
          return (
            <Box
              key={card.key}
              data-timetable-block={it.id}
              title={label}
              style={{
                gridColumn: `3 / span ${1 + card.extendSide}`,
                gridRow: String(card.rowStart),
                ...(lanes > 1
                  ? {
                      width: `calc((100% - ${(lanes - 1) * 8}px) / ${lanes})`,
                      marginLeft: `calc((100% - ${(lanes - 1) * 8}px) / ${lanes} * ${card.lane} + ${card.lane * 8}px)`,
                      justifySelf: "start",
                    }
                  : {}),
              }}
              sx={{ ...frame, alignSelf: "start", px: 1.75, pt: 0.875, pb: 1.125 }}
            >
              <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, flexWrap: "wrap" }}>
                <Typography
                  component="span"
                  sx={{ fontSize: "0.78rem", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}
                  color="text.secondary"
                >
                  {rangeLabel(card)}
                </Typography>
                {state === "live" && (
                  <Box
                    component="span"
                    sx={{
                      fontSize: "0.68rem",
                      fontWeight: 800,
                      letterSpacing: "0.06em",
                      px: 0.75,
                      borderRadius: 1,
                      bgcolor: live,
                      color: theme.palette.getContrastText(live),
                    }}
                  >
                    {t("schedule.liveNow")}
                  </Box>
                )}
              </Box>
              <Typography
                component="div"
                sx={{ fontSize: "1.05rem", fontWeight: 800, lineHeight: 1.45, overflowWrap: "anywhere" }}
              >
                {it.title}
              </Typography>
              {/* 登壇者がいれば「名前 ＋ 発表の題名（説明）」、いなければ説明は補足として淡く */}
              {speaker ? (
                <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "2px 8px", mt: 0.25 }}>
                  <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.625 }}>
                    <Avatar
                      src={speaker.avatarUrl ?? undefined}
                      alt=""
                      sx={{ width: 20, height: 20, fontSize: "0.65rem" }}
                    >
                      {speaker.name.charAt(0)}
                    </Avatar>
                    <Typography component="span" sx={{ fontSize: "0.85rem", fontWeight: 700 }}>
                      {speaker.name}
                    </Typography>
                  </Box>
                  {note && (
                    <Typography component="span" sx={{ fontSize: "0.85rem", lineHeight: 1.6, minWidth: 0, overflowWrap: "anywhere" }}>
                      {note}
                    </Typography>
                  )}
                </Box>
              ) : (
                note && (
                  <Typography
                    sx={{
                      fontSize: "0.82rem",
                      lineHeight: 1.6,
                      mt: 0.25,
                      overflowWrap: "anywhere",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                    color="text.secondary"
                  >
                    {note}
                  </Typography>
                )
              )}
              <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "4px 8px", mt: 0.75 }}>
                {placesOf(card)}
                {/* 裏方の印 (#383)。参加者には出ないコマだと一目で分かるように */}
                {card.staffOnly && (
                  <Chip
                    size="small"
                    icon={<LockOutlinedIcon sx={{ fontSize: 12 }} />}
                    label={t("schedule.staffOnly")}
                    title={t("schedule.staffOnlyChip")}
                    sx={{ height: 20, fontSize: "0.7rem", bgcolor: alpha(ink, 0.1) }}
                  />
                )}
              </Box>
            </Box>
          );
        })}

        {/* 「いま」の印。次に始まる行の上（行の間）に引く。最後のコマの最中なら末尾の下 */}
        {marker !== null && (
          <Box
            data-timetable-now
            style={{
              gridColumn: "1 / -1",
              gridRow: String(Math.min(marker, rows.length)),
            }}
            sx={{
              alignSelf: marker > rows.length ? "end" : "start",
              position: "relative",
              height: 0,
              zIndex: 3,
              pointerEvents: "none",
              top: marker > rows.length ? `${ROW_GAP_PX / 2}px` : `-${ROW_GAP_PX / 2}px`,
            }}
          >
            <Box
              sx={{
                position: "absolute",
                left: 0,
                right: 0,
                top: 0,
                display: "grid",
                gridTemplateColumns: `${TIME_COL_PX}px ${DOT_COL_PX}px 1fr`,
                columnGap: `${COL_GAP_PX}px`,
                alignItems: "center",
                transform: "translateY(-50%)",
              }}
            >
              <Box
                component="span"
                sx={{
                  justifySelf: "end",
                  fontSize: "0.72rem",
                  fontWeight: 800,
                  lineHeight: "18px",
                  px: 0.75,
                  borderRadius: 1,
                  bgcolor: live,
                  color: theme.palette.getContrastText(live),
                  whiteSpace: "nowrap",
                }}
              >
                <span aria-hidden>{formatTime(now)}</span>
                <Box component="span" sx={SR_ONLY}>
                  {t("schedule.nowLine", { time: formatTime(now) })}
                </Box>
              </Box>
              <Box
                aria-hidden
                sx={{ justifySelf: "center", width: 12, height: 12, bgcolor: live, transform: "rotate(45deg)", borderRadius: "2px" }}
              />
              <Box aria-hidden sx={{ height: "3px", bgcolor: live, borderRadius: 2 }} />
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}
