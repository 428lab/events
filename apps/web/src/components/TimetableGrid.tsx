import { Box, Chip, Stack, Typography } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { useTranslation } from "react-i18next";
import type { TimetableBlock, TimetableLayout } from "../lib/timetableLayout.js";
import { formatTime } from "../lib/format.js";

/** 時刻列の幅。ここだけ固定で、トラック列は残りを分け合う */
const TIME_COL_PX = 62;
/** トラック列の最小幅。これを下回るなら横スクロールに逃がす */
const TRACK_COL_MIN_PX = 210;
/** ヘッダー行の高さ */
const HEAD_PX = 40;
/** これより低い枠(px)は「時刻・題名」を1行に畳む（縦に積むと文字が切れる）。
 * 最低の高さ（TIMETABLE_MIN_BLOCK_PX）の枠は必ずこちらになる */
const ONE_LINE_PX = 58;

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

/** 広い画面のタイムテーブル (#338)。縦軸＝時刻・横軸＝トラックの格子。
 *
 * - 枠の高さは所要時間に比例する。ただし短いコマは最低1行ぶんまで伸ばし（目盛りの
 *   ほうを伸ばすので他のコマとは重ならない）、何も無い時間は縮める（lib/timetableLayout.ts）
 * - 同じ時刻・同じ列のコマは横に並べる。全トラック共通の帯は、続いているコマを前後に割る
 * - 複数トラックにまたがるコマは、またぐ列をつないだ**1つの枠**として描く
 * - 全トラック共通は全列をまたぐ帯。トラック色を使わず無彩色にして、
 *   「どれか1本の色」と読み違えられないようにする
 * - 裏方 (#383) は半透明＋斜線＋鍵の印。公開のコマと時刻が重なるときは横に並ぶ
 * - 時刻列は横スクロールしても残る（sticky）。トラックが増えたら横スクロール
 *
 * 位置（列・行）は inline style で当てる。枠ごとに値が違うので、
 * sx に入れるとクラスが枠の数だけ増える。テストからも読みやすい。 */
export function TimetableGrid({
  layout,
  colors,
}: {
  layout: TimetableLayout;
  /** トラックと同じ並びの色。テーマから導いた値 (lib/trackColors.ts)。
   * `null` は**スタッフ用の列** (#383)。色を持たず無彩色＋斜線で描く */
  colors: Array<string | null>;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { tracks, blocks, ticks, rows } = layout;
  if (tracks.length === 0 || rows === 0) return null;

  const stripe = `repeating-linear-gradient(135deg, ${alpha(
    theme.palette.text.primary,
    0.08,
  )} 0 10px, ${alpha(theme.palette.text.primary, 0.03)} 10px 20px)`;

  return (
    // 役割とラベル、そしてフォーカスは **スクロールするこの外側** に置く。
    // 内側に付けると、キーボードだけの人が横スクロールの器にたどり着けない。
    // grid で描いているだけで表の構造（行・セル）は持たないので、role は
    // region にする。table にすると行やセルが無いことが違反になり、
    // 読み上げが表として案内したのに中身が読めない状態になる
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
          minWidth: "max-content",
          gridTemplateColumns: `${TIME_COL_PX}px repeat(${tracks.length}, minmax(${TRACK_COL_MIN_PX}px, 1fr))`,
          gridTemplateRows: `${HEAD_PX}px ${layout.rowHeights.map((h) => `${h}px`).join(" ")}`,
        }}
      >
        {/* 30分ごとの横線。時 のところだけ濃くする */}
        {ticks.map((tick) => (
          <Box
            key={`line-${tick.ms}`}
            style={{ gridColumn: "1 / -1", gridRow: String(tick.rowStart + 1) }}
            sx={{
              borderTop: 1,
              borderColor: tick.hour ? "text.disabled" : "divider",
              pointerEvents: "none",
            }}
          />
        ))}
        {/* 列の区切り */}
        {tracks.map((track, i) => (
          <Box
            key={`col-${track.id}`}
            style={{ gridColumn: String(i + 2), gridRow: "2 / -1" }}
            sx={{ borderLeft: 1, borderColor: "divider", pointerEvents: "none" }}
          />
        ))}

        {/* 見出し（横スクロールでも縦スクロールでも残す） */}
        <Box
          style={{ gridColumn: "1", gridRow: "1" }}
          sx={{
            position: "sticky",
            top: 0,
            left: 0,
            zIndex: 5,
            bgcolor: "background.paper",
            borderBottom: 1,
            borderColor: "divider",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Typography variant="caption" color="text.secondary">
            {t("schedule.time")}
          </Typography>
        </Box>
        {tracks.map((track, i) => (
          <Box
            key={`head-${track.id}`}
            style={{ gridColumn: String(i + 2), gridRow: "1" }}
            sx={{
              position: "sticky",
              top: 0,
              zIndex: 3,
              bgcolor: "background.paper",
              borderBottom: 1,
              borderColor: "divider",
              display: "flex",
              alignItems: "center",
              gap: 0.75,
              px: 1.25,
              whiteSpace: "nowrap",
            }}
          >
            {/* スタッフ用の列は色を持たない (#383)。無彩色＋斜線にして、
                公開トラックの色を1本も食わないようにする */}
            <Box
              sx={{
                width: 9,
                height: 9,
                borderRadius: "3px",
                flex: "none",
                ...(colors[i]
                  ? { bgcolor: colors[i]! }
                  : {
                      backgroundImage: stripe,
                      border: "1px solid",
                      borderColor: "divider",
                    }),
              }}
            />
            {!colors[i] && (
              <LockOutlinedIcon
                sx={{ fontSize: 14, color: "text.secondary", flex: "none" }}
                titleAccess={t("schedule.staffTrack")}
              />
            )}
            <Typography variant="body2" fontWeight={700} noWrap>
              {track.name}
            </Typography>
          </Box>
        ))}

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
              zIndex: 2,
              bgcolor: "background.paper",
              borderRight: 1,
              borderColor: "divider",
              textAlign: "right",
              pr: 1,
              whiteSpace: "nowrap",
            }}
          >
            <Typography
              variant="caption"
              fontWeight={tick.hour ? 700 : 400}
              color={tick.hour ? "text.primary" : "text.secondary"}
            >
              {formatTime(tick.ms)}
            </Typography>
          </Box>
        ))}

        {/* セッションの枠。重ならない（同じ時刻・同じ列のコマは横に並べ、全トラック共通の
            帯は他のコマを前後に割る。lib/timetableLayout.ts） */}
        {blocks.map((block) => {
          // 色は列ではなくコマで決める。飛び地で枠が割れたときに、同じコマの
          // 片割れが別の色になってしまう
          const color = colors[block.colorIndex] ?? null;
          // 色を持たない枠（全トラック共通・裏方・スタッフ用の列のコマ）は
          // 無彩色で描く。トラック色を1本借りると、別の列の予定に見える
          const plain = block.common || block.staffOnly || color === null;
          const tint = color ?? theme.palette.primary.main;
          const oneLine = block.heightPx < ONE_LINE_PX;
          const speaker = speakerLabel(block);
          const spans = block.colSpan > 1 || block.split;
          const title = block.continued
            ? `${block.entry.item.title}${t("schedule.continued")}`
            : block.entry.item.title;
          // トラック名はどの枠にも必ず入れる。全トラック共通と、1行に畳んだ枠は
          // 読み上げにだけ出す（見える形で足すと題名が押し出される）。
          // またぎの広い枠は、列を見ても分からないので目に見える形で添える
          const trackLabel = block.common
            ? t("schedule.allTracks")
            : block.trackNames.join(t("schedule.trackNameSeparator"));
          const visibleTrack = !block.common && spans && !oneLine;
          // 同じ列で時刻が重なるコマは横に並べる (#345)。余白 4px を両側に残す
          const lanes = block.laneCount;
          return (
            <Box
              key={block.key}
              data-timetable-block={block.entry.item.id}
              title={`${rangeLabel(block)} ${title}${speaker ? ` / ${speaker}` : ""}`}
              style={{
                gridColumn: `${block.colStart + 2} / span ${block.colSpan}`,
                gridRow: `${block.rowStart + 1} / ${block.rowEnd + 1}`,
                ...(lanes > 1
                  ? {
                      width: `calc((100% - 8px) / ${lanes} - 2px)`,
                      marginLeft: `calc(4px + (100% - 8px) * ${block.lane} / ${lanes})`,
                      marginRight: 0,
                      justifySelf: "start",
                    }
                  : {}),
              }}
              sx={{
                position: "relative",
                zIndex: block.common ? 2 : 1,
                overflow: "hidden",
                minWidth: 0,
                mx: "4px",
                my: "1px",
                px: 0.875,
                py: oneLine ? 0 : "2px",
                borderRadius: 1.5,
                display: oneLine ? "flex" : "block",
                alignItems: "center",
                ...(plain
                  ? {
                      // 全トラック共通は薄い帯。斜線や破線を重ねると短い帯の文字が読みにくい
                      bgcolor: block.staffOnly
                        ? alpha(theme.palette.background.paper, 0.72)
                        : alpha(theme.palette.text.primary, 0.06),
                      ...(block.staffOnly || color === null
                        ? { backgroundImage: stripe, border: "1px dashed", borderColor: "divider" }
                        : {}),
                      borderLeft: "3px solid",
                      borderLeftColor: alpha(
                        theme.palette.text.primary,
                        block.staffOnly ? 0.4 : 0.55,
                      ),
                    }
                  : {
                      bgcolor: alpha(tint, 0.16),
                      borderLeft: "3px solid",
                      borderLeftColor: tint,
                      // またぎは内枠線を足して「つないだ1枠」だと分かるようにする
                      boxShadow: spans
                        ? `inset 0 0 0 1px ${alpha(tint, 0.45)}`
                        : "none",
                    }),
              }}
            >
              <Stack
                direction="row"
                spacing={0.75}
                alignItems="baseline"
                useFlexGap
                sx={{
                  minWidth: 0,
                  width: "100%",
                  flexWrap: oneLine ? "nowrap" : "wrap",
                }}
              >
                {/* 続きの枠は時刻を繰り返さない（同じ時刻が何度も並ぶと読みにくい） */}
                {!block.continued && (
                  <Typography
                    sx={{ fontSize: "0.7rem", lineHeight: 1.35, flex: "none", fontVariantNumeric: "tabular-nums" }}
                    color="text.secondary"
                  >
                    {rangeLabel(block)}
                  </Typography>
                )}
                {oneLine && (
                  <Typography
                    fontWeight={block.continued ? 500 : 600}
                    color={block.continued ? "text.secondary" : undefined}
                    noWrap
                    sx={{ fontSize: "0.8rem", lineHeight: 1.35, minWidth: 0, flex: "1 1 auto" }}
                  >
                    {title}
                  </Typography>
                )}
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
                      alignSelf: "center",
                      flex: "none",
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
                      alignSelf: "baseline",
                      bgcolor: plain
                        ? alpha(theme.palette.text.primary, 0.14)
                        : alpha(tint, 0.3),
                    }}
                  />
                ) : (
                  <Box component="span" sx={SR_ONLY}>
                    {block.common
                      ? trackLabel
                      : t("schedule.trackSrLabel", { name: trackLabel })}
                  </Box>
                )}
              </Stack>
              {!oneLine && (
                <Typography
                  fontWeight={block.continued ? 500 : 600}
                  color={block.continued ? "text.secondary" : undefined}
                  sx={{
                    fontSize: block.continued ? "0.78rem" : "0.85rem",
                    lineHeight: 1.3,
                    overflowWrap: "anywhere",
                  }}
                >
                  {title}
                </Typography>
              )}
              {!oneLine && !block.continued && speaker && (
                <Typography
                  sx={{
                    fontSize: "0.72rem",
                    lineHeight: 1.35,
                    overflowWrap: "anywhere",
                  }}
                  color="text.secondary"
                >
                  {speaker}
                </Typography>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
