import { useEffect, useState } from "react";
import { Avatar, Box, Chip, Typography } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { useTranslation } from "react-i18next";
import {
  timeToOffsetPx,
  type TimetableBlock,
  type TimetableLayout,
} from "../lib/timetableLayout.js";
import { formatTime } from "../lib/format.js";

/** 時刻列の幅。ここだけ固定で、残りの列が幅を分け合う */
const TIME_COL_PX = 56;
/** トラック列の最小幅。これを下回るなら横スクロールに逃がす */
const TRACK_COL_MIN_PX = 200;
/** 全トラック共通の列の最小幅。短い登壇が続くので、題名が1行で読める幅を取る */
const COMMON_COL_MIN_PX = 300;
/** ヘッダー行の高さ */
const HEAD_PX = 44;
/** これより低い枠(px)は「時刻・題名」を1行に畳む（縦に積むと文字が切れる）。
 * 最低の高さ（TIMETABLE_MIN_BLOCK_PX）の枠は必ずこちらになる */
const ONE_LINE_PX = 52;
/** 登壇者の行まで出せる高さ(px) */
const WITH_SPEAKER_PX = 96;
/** 「いま」の線を引き直す間隔。分の表示なので1分ごとで足りる */
const NOW_TICK_MS = 60_000;

/** 読み上げにだけ出す（目には見えない）。
 * 格子は「どの列か」を目で見て分かる作りなので、単独トラックの枠にはトラック名を
 * 書いていない。読み上げでは列が分からず「10:20–10:50 セッションA」としか読めない
 * ので、ここで名前を補う。見える形で足すと狭い枠から題名が押し出される。 */
const SR_ONLY = {
  position: "absolute",
  // sx の 0〜1 は割合として読まれる（1 だと 100% になる）ので単位まで書く
  width: "1px",
  height: "1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
} as const;

/** 枠に出す時間の帯（例 "10:00–10:20"） */
function rangeLabel(block: TimetableBlock): string {
  const end = block.startsAt + block.entry.item.durationMin * 60_000;
  if (block.entry.item.durationMin <= 0) return formatTime(block.startsAt);
  return `${formatTime(block.startsAt)}–${formatTime(end)}`;
}

function speakerLabel(block: TimetableBlock): string {
  const it = block.entry.item;
  return it.speaker
    ? (it.speaker.globalName ?? it.speaker.username)
    : it.speakerName;
}

/** 今の時刻。1分ごとに読み直す（setTimeout のつなぎ。サーバーには問い合わせない） */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      // 分の変わり目にそろえる（表示している時刻と線の位置がずれないように）
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

/** 広い画面のタイムテーブル (#338)。縦軸＝時刻・横軸＝列の格子。
 *
 * - **全トラック共通は先頭の専用の列**（見出し「全体」）。トラックのコマは途中で割らない
 *   ので、「ボードゲームは Lounge 1 で 14:00–18:00」が1つの枠で読める（オーナー 2026-11-26）
 * - セッションの無いトラックの列は既定で隠す（見出しの下のボタンで出せる）
 * - 枠の高さは所要時間に比例する。ただし短いコマは最低1行ぶんまで伸ばし（目盛りの
 *   ほうを伸ばすので他のコマとは重ならない）、何も無い時間は縮める（lib/timetableLayout.ts）
 * - 同じ時刻・同じ列のコマは横に並べる (#345)
 * - 複数トラックにまたがるコマは、またぐ列をつないだ**1つの枠**として描く
 * - 枠はトラック色を薄く敷き、上辺に色の帯。題名がいちばん目立ち、時刻は小さく
 * - 裏方 (#383) は半透明＋斜線＋鍵の印
 * - 開催中は「いま」の横線を引く
 * - 見出し行と時刻列は、縦にも横にもスクロールしても残る（sticky）
 *
 * 位置（列・行）は inline style で当てる。枠ごとに値が違うので、
 * sx に入れるとクラスが枠の数だけ増える。テストからも読みやすい。 */
export function TimetableGrid({
  layout,
  colors,
  onToggleEmptyTracks,
  showingEmptyTracks = false,
}: {
  layout: TimetableLayout;
  /** トラックと同じ並びの色。テーマから導いた値 (lib/trackColors.ts)。
   * `null` は**スタッフ用の列** (#383)。色を持たず無彩色＋斜線で描く */
  colors: Array<string | null>;
  /** 空のトラックの列を出す・隠す。渡されたときだけ切り替えのボタンを出す */
  onToggleEmptyTracks?: () => void;
  showingEmptyTracks?: boolean;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const now = useNow();
  const { tracks, columns, blocks, ticks, rows } = layout;
  if (columns.length === 0 || rows === 0) return null;

  const light = theme.palette.mode === "light";
  const stripe = `repeating-linear-gradient(135deg, ${alpha(
    theme.palette.text.primary,
    0.08,
  )} 0 10px, ${alpha(theme.palette.text.primary, 0.03)} 10px 20px)`;
  // 薄く敷く色の濃さ。明るい背景では淡い色が白に溶けるので、少し濃くする
  const tintBg = (c: string) => alpha(c, light ? 0.14 : 0.18);
  const nowTop = timeToOffsetPx(layout, now);
  const emptyToggle =
    onToggleEmptyTracks &&
    (showingEmptyTracks || layout.hiddenTracks.length > 0) ? (
      <Box
        component="button"
        type="button"
        onClick={onToggleEmptyTracks}
        sx={{
          all: "unset",
          cursor: "pointer",
          fontSize: "0.75rem",
          color: "text.secondary",
          "&:hover, &:focus-visible": { color: "text.primary", textDecoration: "underline" },
        }}
      >
        {showingEmptyTracks
          ? t("schedule.hideEmptyTracks")
          : t("schedule.showEmptyTracks", {
              names: layout.hiddenTracks.map((tr) => tr.name).join(t("schedule.trackNameSeparator")),
            })}
      </Box>
    ) : null;

  return (
    <Box>
      {emptyToggle && <Box sx={{ mb: 0.75, textAlign: "right" }}>{emptyToggle}</Box>}
      {/* 役割とラベル、そしてフォーカスは **スクロールするこの外側** に置く。
          内側に付けると、キーボードだけの人が横スクロールの器にたどり着けない。
          grid で描いているだけで表の構造（行・セル）は持たないので、role は
          region にする。table にすると行やセルが無いことが違反になり、
          読み上げが表として案内したのに中身が読めない状態になる */}
      <Box
        role="region"
        aria-label={t("schedule.timetable")}
        tabIndex={0}
        sx={{
          overflow: "auto",
          maxHeight: { xs: "none", md: "min(960px, 85vh)" },
          overscrollBehaviorX: "contain",
          border: 1,
          borderColor: "divider",
          borderRadius: 2,
          bgcolor: "background.paper",
        }}
      >
        <Box
          sx={{
            display: "grid",
            position: "relative",
            // 横スクロールに逃がすのは、列の最小幅の合計が画面に入らないときだけ。
            // max-content にすると1行に畳んだ長い題名の幅まで列が広がり、広い画面でも横に流れる
            minWidth: `${TIME_COL_PX + columns.reduce((n, c) => n + (c.kind === "common" ? COMMON_COL_MIN_PX : TRACK_COL_MIN_PX), 0)}px`,
            gridTemplateColumns: `${TIME_COL_PX}px ${columns
              .map((c) =>
                c.kind === "common"
                  ? `minmax(${COMMON_COL_MIN_PX}px, 1.35fr)`
                  : `minmax(${TRACK_COL_MIN_PX}px, 1fr)`,
              )
              .join(" ")}`,
            gridTemplateRows: `${HEAD_PX}px ${layout.rowHeights.map((h) => `${h}px`).join(" ")}`,
          }}
        >
          {/* 30分ごとの横線。時 のところは実線で濃く、半時は点線で淡く */}
          {ticks.map((tick) => (
            <Box
              key={`line-${tick.ms}`}
              style={{ gridColumn: "2 / -1", gridRow: String(tick.rowStart + 1) }}
              sx={{
                borderTop: tick.hour ? "1px solid" : "1px dashed",
                borderColor: tick.hour
                  ? alpha(theme.palette.text.primary, light ? 0.16 : 0.2)
                  : alpha(theme.palette.text.primary, light ? 0.07 : 0.09),
                pointerEvents: "none",
              }}
            />
          ))}
          {/* 列の区切り。全体の列は背景を少し変えて、トラックの列と見分ける */}
          {columns.map((col, i) => (
            <Box
              key={`col-${i}`}
              style={{ gridColumn: String(i + 2), gridRow: "2 / -1" }}
              sx={{
                borderLeft: 1,
                borderColor: "divider",
                pointerEvents: "none",
                bgcolor:
                  col.kind === "common"
                    ? alpha(theme.palette.text.primary, light ? 0.025 : 0.035)
                    : "transparent",
              }}
            />
          ))}

          {/* 見出し（横スクロールでも縦スクロールでも残す） */}
          <Box
            style={{ gridColumn: "1", gridRow: "1" }}
            sx={{
              position: "sticky",
              top: 0,
              left: 0,
              zIndex: 6,
              bgcolor: "background.paper",
              borderBottom: 1,
              borderColor: "divider",
            }}
          />
          {columns.map((col, i) => {
            const color = col.kind === "track" ? colors[col.trackIndex] : undefined;
            const name =
              col.kind === "common"
                ? t("schedule.commonColumn")
                : tracks[col.trackIndex]!.name;
            return (
              <Box
                key={`head-${i}`}
                style={{ gridColumn: String(i + 2), gridRow: "1" }}
                sx={{
                  position: "sticky",
                  top: 0,
                  zIndex: 4,
                  bgcolor: "background.paper",
                  borderBottom: 1,
                  borderLeft: 1,
                  borderColor: "divider",
                  display: "flex",
                  alignItems: "center",
                  gap: 0.75,
                  px: 1.5,
                  whiteSpace: "nowrap",
                  // トラックの色を見出しの下辺にも引いて、列と色を結び付ける
                  boxShadow: color ? `inset 0 -3px 0 ${color}` : "none",
                }}
              >
                {col.kind === "track" && (
                  /* スタッフ用の列は色を持たない (#383)。無彩色＋斜線にして、
                     公開トラックの色を1本も食わないようにする */
                  <Box
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      flex: "none",
                      ...(color
                        ? { bgcolor: color }
                        : {
                            backgroundImage: stripe,
                            border: "1px solid",
                            borderColor: "divider",
                          }),
                    }}
                  />
                )}
                {col.kind === "track" && !color && (
                  <LockOutlinedIcon
                    sx={{ fontSize: 14, color: "text.secondary", flex: "none" }}
                    titleAccess={t("schedule.staffTrack")}
                  />
                )}
                <Typography
                  variant="body2"
                  fontWeight={800}
                  noWrap
                  color={col.kind === "common" ? "text.secondary" : "text.primary"}
                >
                  {name}
                </Typography>
              </Box>
            );
          })}

          {/* 時刻の目盛り */}
          {ticks.map((tick) => (
            <Box
              key={`time-${tick.ms}`}
              style={{
                gridColumn: "1",
                gridRow: `${tick.rowStart + 1} / ${tick.rowEnd + 1}`,
              }}
              sx={{
                position: "sticky",
                left: 0,
                zIndex: 3,
                bgcolor: "background.paper",
                borderRight: 1,
                borderColor: "divider",
                textAlign: "right",
                pr: 1,
                pt: "1px",
                whiteSpace: "nowrap",
              }}
            >
              <Typography
                sx={{
                  fontSize: tick.hour ? "0.8rem" : "0.7rem",
                  lineHeight: 1,
                  fontVariantNumeric: "tabular-nums",
                }}
                fontWeight={tick.hour ? 800 : 400}
                color={tick.hour ? "text.primary" : "text.secondary"}
              >
                {formatTime(tick.ms)}
              </Typography>
            </Box>
          ))}

          {/* セッションの枠。重ならない（全トラック共通は専用の列、同じ時刻・同じ列の
              コマは横に並べる。lib/timetableLayout.ts） */}
          {blocks.map((block) => {
            // 色は列ではなくコマで決める。飛び地で枠が割れたときに、同じコマの
            // 片割れが別の色になってしまう
            const color = block.common ? null : (colors[block.colorIndex] ?? null);
            // 色を持たない枠（全トラック共通・裏方・スタッフ用の列のコマ）は
            // 無彩色で描く。トラック色を1本借りると、別の列の予定に見える
            const plain = block.common || block.staffOnly || color === null;
            const tint = color ?? theme.palette.text.secondary;
            const oneLine = block.heightPx < ONE_LINE_PX;
            const speaker = speakerLabel(block);
            const spans = block.colSpan > 1 || block.split;
            const title = block.entry.item.title;
            // トラック名はどの枠にも必ず入れる。全トラック共通と、1行に畳んだ枠は
            // 読み上げにだけ出す（見える形で足すと題名が押し出される）。
            // またぎの広い枠は、列を見ても分からないので目に見える形で添える
            const trackLabel = block.common
              ? t("schedule.allTracks")
              : block.trackNames.join(t("schedule.trackNameSeparator"));
            const visibleTrack = !block.common && spans && !oneLine;
            // 登壇者の行は、時刻・題名（2行）・またぎの印の下に収まるときだけ
            const showSpeaker =
              Boolean(speaker) && block.heightPx >= WITH_SPEAKER_PX + (visibleTrack ? 20 : 0);
            // 同じ列で時刻が重なるコマは横に並べる (#345)。余白 4px を両側に残す
            const lanes = block.laneCount;
            const it = block.entry.item;
            return (
              <Box
                key={block.key}
                data-timetable-block={it.id}
                title={`${rangeLabel(block)} ${title}${speaker ? ` / ${speaker}` : ""}`}
                style={{
                  gridColumn: `${block.colStart + 2} / span ${block.colSpan}`,
                  gridRow: `${block.rowStart + 1} / ${block.rowEnd + 1}`,
                  ...(lanes > 1
                    ? {
                        width: `calc((100% - 8px) / ${lanes} - 3px)`,
                        marginLeft: `calc(4px + (100% - 8px) * ${block.lane} / ${lanes})`,
                        marginRight: 0,
                        justifySelf: "start",
                      }
                    : {}),
                }}
                sx={{
                  position: "relative",
                  zIndex: 1,
                  overflow: "hidden",
                  minWidth: 0,
                  mx: "4px",
                  my: "2px",
                  px: 1,
                  py: oneLine ? 0 : "3px",
                  borderRadius: 1.5,
                  display: oneLine ? "flex" : "block",
                  alignItems: "center",
                  gap: 0.75,
                  ...(plain
                    ? {
                        bgcolor: block.staffOnly
                          ? alpha(theme.palette.background.paper, 0.72)
                          : alpha(theme.palette.text.primary, light ? 0.06 : 0.08),
                        ...(block.staffOnly || (!block.common && color === null)
                          ? { backgroundImage: stripe, border: "1px dashed", borderColor: "divider" }
                          : {}),
                        borderLeft: "3px solid",
                        borderLeftColor: alpha(
                          theme.palette.text.primary,
                          block.staffOnly ? 0.35 : 0.45,
                        ),
                      }
                    : {
                        bgcolor: tintBg(tint),
                        // 上辺の色の帯。左の細線よりも、どの列の色かが遠目に分かる
                        borderTop: "3px solid",
                        borderTopColor: tint,
                        // またぎは内枠線を足して「つないだ1枠」だと分かるようにする
                        boxShadow: spans
                          ? `inset 0 0 0 1px ${alpha(tint, 0.5)}`
                          : `inset 0 0 0 1px ${alpha(tint, light ? 0.22 : 0.16)}`,
                      }),
                  transition: "box-shadow 120ms",
                  "&:hover": {
                    boxShadow: `inset 0 0 0 1px ${alpha(plain ? theme.palette.text.primary : tint, 0.6)}`,
                  },
                }}
              >
                {/* 時刻は小さく。題名がいちばん目立つ。登壇者の行を出す高さが無い枠は、
                    登壇者の名前を時刻の行の後ろに添える（会議では「誰の話か」も大事） */}
                <Typography
                  component={oneLine ? "span" : "div"}
                  noWrap={!oneLine}
                  sx={{
                    fontSize: "0.7rem",
                    lineHeight: 1.4,
                    flex: "none",
                    fontVariantNumeric: "tabular-nums",
                    fontWeight: 600,
                  }}
                  color="text.secondary"
                >
                  {rangeLabel(block)}
                  {!oneLine && !showSpeaker && speaker && (
                    <Box component="span" sx={{ fontWeight: 400 }}>
                      {` · ${speaker}`}
                    </Box>
                  )}
                </Typography>
                <Typography
                  component={oneLine ? "span" : "div"}
                  fontWeight={700}
                  noWrap={oneLine}
                  sx={{
                    fontSize: oneLine ? "0.8rem" : "0.9rem",
                    lineHeight: oneLine ? 1.3 : 1.25,
                    minWidth: 0,
                    flex: oneLine ? "1 1 auto" : undefined,
                    ...(oneLine
                      ? {}
                      : {
                          // 2行まで。長い題名は「…」で切り、全文は枠の title（ホバー・長押し）で読める
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                          overflowWrap: "anywhere",
                        }),
                  }}
                >
                  {title}
                </Typography>
                {/* 裏方の印 (#383)。参加者には出ないコマだと一目で分かるように
                    する。狭い枠に入れるので短い言い方にし、長いほうは title に置く */}
                {block.staffOnly && (
                  <Chip
                    size="small"
                    icon={<LockOutlinedIcon sx={{ fontSize: 11 }} />}
                    label={t("schedule.staffOnly")}
                    title={t("schedule.staffOnlyChip")}
                    sx={{
                      height: 16,
                      fontSize: "0.62rem",
                      flex: "none",
                      mt: oneLine ? 0 : 0.25,
                      "& .MuiChip-icon": { ml: "4px", mr: "-2px" },
                      bgcolor: alpha(theme.palette.text.primary, 0.14),
                    }}
                  />
                )}
                {visibleTrack ? (
                  <Chip
                    size="small"
                    label={trackLabel}
                    sx={{
                      height: 16,
                      fontSize: "0.62rem",
                      mt: 0.25,
                      bgcolor: alpha(tint, 0.28),
                    }}
                  />
                ) : (
                  <Box component="span" sx={SR_ONLY}>
                    {block.common
                      ? trackLabel
                      : t("schedule.trackSrLabel", { name: trackLabel })}
                  </Box>
                )}
                {showSpeaker && (
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 0.625,
                      mt: 0.5,
                      minWidth: 0,
                    }}
                  >
                    {it.speaker && (
                      <Avatar
                        src={it.speaker.avatarUrl ?? undefined}
                        alt=""
                        sx={{ width: 20, height: 20, fontSize: "0.65rem", flex: "none" }}
                      >
                        {speaker.charAt(0)}
                      </Avatar>
                    )}
                    <Typography
                      noWrap
                      sx={{ fontSize: "0.75rem", lineHeight: 1.3, minWidth: 0 }}
                      color="text.secondary"
                    >
                      {speaker}
                    </Typography>
                  </Box>
                )}
              </Box>
            );
          })}

          {/* 開催中の「いま」の線。格子に置いたコマの最初の開始〜最後の終わりの間だけ */}
          {nowTop !== null && (
            <Box
              data-timetable-now
              style={{ top: `${HEAD_PX + nowTop}px` }}
              sx={{
                position: "absolute",
                left: `${TIME_COL_PX}px`,
                right: 0,
                height: 0,
                borderTop: "2px solid",
                borderColor: "error.main",
                // 時刻列（sticky, 3）より手前、見出し行（4・6）より奥
                zIndex: 3,
                pointerEvents: "none",
                "&::before": {
                  content: '""',
                  position: "absolute",
                  left: -5,
                  top: -6,
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  bgcolor: "error.main",
                },
              }}
            >
              <Box
                component="span"
                sx={{
                  // 時刻列の上に重ねる（枠の文字には掛けない）
                  position: "absolute",
                  right: "100%",
                  mr: "2px",
                  top: -9,
                  whiteSpace: "nowrap",
                  px: 0.75,
                  borderRadius: 1,
                  fontSize: "0.68rem",
                  fontWeight: 800,
                  lineHeight: "16px",
                  bgcolor: "error.main",
                  color: theme.palette.getContrastText(theme.palette.error.main),
                }}
              >
                <span aria-hidden>{formatTime(now)}</span>
                <Box component="span" sx={SR_ONLY}>
                  {t("schedule.nowLine", { time: formatTime(now) })}
                </Box>
              </Box>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}
