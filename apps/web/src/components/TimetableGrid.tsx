import { Box, Chip, Stack, Typography } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import type { TimetableBlock, TimetableLayout } from "../lib/timetableLayout.js";
import { TIMETABLE_SLOT_PX } from "../lib/timetableLayout.js";
import { formatTime } from "../lib/format.js";

/** 時刻列の幅。ここだけ固定で、トラック列は残りを分け合う */
const TIME_COL_PX = 62;
/** トラック列の最小幅。これを下回るなら横スクロールに逃がす */
const TRACK_COL_MIN_PX = 210;
/** ヘッダー行の高さ */
const HEAD_PX = 40;
/** これより短い枠は1行に畳む（縦に積むと文字が切れる） */
const SHORT_SLOTS = 5;

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
 * - 枠の高さ＝所要時間。空き時間はそのまま隙間になる
 * - 複数トラックにまたがるコマは、またぐ列をつないだ**1つの枠**として描く
 * - 全トラック共通は全列をまたぐ帯。トラック色を使わず無彩色＋斜線にして、
 *   「どれか1本の色」と読み違えられないようにする
 * - 時刻列は横スクロールしても残る（sticky）。トラックが増えたら横スクロール
 *
 * 位置（列・行）は inline style で当てる。枠ごとに値が違うので、
 * sx に入れるとクラスが枠の数だけ増える。テストからも読みやすい。 */
export function TimetableGrid({
  layout,
  colors,
}: {
  layout: TimetableLayout;
  /** トラックと同じ並びの色。テーマから導いた値 (lib/trackColors.ts) */
  colors: string[];
}) {
  const theme = useTheme();
  const { tracks, blocks, ticks, rows } = layout;
  if (tracks.length === 0 || rows === 0) return null;

  const stripe = `repeating-linear-gradient(135deg, ${alpha(
    theme.palette.text.primary,
    0.08,
  )} 0 10px, ${alpha(theme.palette.text.primary, 0.03)} 10px 20px)`;

  return (
    <Box
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
        role="table"
        aria-label="タイムテーブル"
        sx={{
          display: "grid",
          minWidth: "max-content",
          gridTemplateColumns: `${TIME_COL_PX}px repeat(${tracks.length}, minmax(${TRACK_COL_MIN_PX}px, 1fr))`,
          gridTemplateRows: `${HEAD_PX}px repeat(${rows}, ${TIMETABLE_SLOT_PX}px)`,
        }}
      >
        {/* 30分ごとの横線。時 のところだけ濃くする */}
        {ticks.map((t) => (
          <Box
            key={`line-${t.ms}`}
            style={{ gridColumn: "1 / -1", gridRow: String(t.rowStart + 1) }}
            sx={{
              borderTop: 1,
              borderColor: t.hour ? "text.disabled" : "divider",
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
            時刻
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
            <Box
              sx={{
                width: 9,
                height: 9,
                borderRadius: "3px",
                flex: "none",
                bgcolor: colors[i] ?? "primary.main",
              }}
            />
            <Typography variant="body2" fontWeight={700} noWrap>
              {track.name}
            </Typography>
          </Box>
        ))}

        {/* 時刻の目盛り */}
        {ticks.map((t) => (
          <Box
            key={`time-${t.ms}`}
            style={{
              gridColumn: "1",
              gridRow: `${t.rowStart + 1} / ${t.rowEnd + 1}`,
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
              fontWeight={t.hour ? 700 : 400}
              color={t.hour ? "text.primary" : "text.secondary"}
            >
              {formatTime(t.ms)}
            </Typography>
          </Box>
        ))}

        {/* セッションの枠 */}
        {blocks.map((block) => {
          const color = colors[block.colStart] ?? theme.palette.primary.main;
          const short = block.rowEnd - block.rowStart <= SHORT_SLOTS;
          const speaker = speakerLabel(block);
          const spans = block.colSpan > 1 || block.split;
          return (
            <Box
              key={block.key}
              data-timetable-block={block.entry.item.id}
              style={{
                gridColumn: `${block.colStart + 2} / span ${block.colSpan}`,
                gridRow: `${block.rowStart + 1} / ${block.rowEnd + 1}`,
              }}
              sx={{
                position: "relative",
                zIndex: 1,
                overflow: "hidden",
                mx: "4px",
                my: "1px",
                px: 0.875,
                py: "2px",
                borderRadius: 1.5,
                ...(block.common
                  ? {
                      // 無彩色の斜線＋破線。トラック色を一切使わないことで、
                      // 「どれか1本のトラックの色」と読み違えられない
                      backgroundImage: stripe,
                      border: "1px dashed",
                      borderColor: "divider",
                      borderLeft: "3px solid",
                      borderLeftColor: alpha(theme.palette.text.primary, 0.55),
                    }
                  : {
                      bgcolor: alpha(color, 0.16),
                      borderLeft: "3px solid",
                      borderLeftColor: color,
                      // またぎは内枠線を足して「つないだ1枠」だと分かるようにする
                      boxShadow: spans
                        ? `inset 0 0 0 1px ${alpha(color, 0.45)}`
                        : "none",
                    }),
              }}
            >
              {/* 短い枠は1行に畳む。それ以外も「時刻とラベル」を同じ行に置いて
                  行数を節約する（30分の枠でも担当まで入る高さに収める） */}
              <Stack
                direction="row"
                spacing={0.75}
                alignItems="baseline"
                sx={{ flexWrap: "wrap" }}
                useFlexGap
              >
                <Typography
                  sx={{ fontSize: "0.66rem", lineHeight: 1.35 }}
                  color="text.secondary"
                >
                  {rangeLabel(block)}
                </Typography>
                {short && (
                  <Typography
                    fontWeight={600}
                    sx={{
                      fontSize: "0.78rem",
                      lineHeight: 1.3,
                      overflowWrap: "anywhere",
                    }}
                  >
                    {block.entry.item.title}
                  </Typography>
                )}
                {(block.common || spans) && (
                  <Chip
                    size="small"
                    label={block.common ? "全トラック共通" : block.trackNames.join("・")}
                    sx={{
                      height: 16,
                      fontSize: "0.62rem",
                      alignSelf: "baseline",
                      bgcolor: block.common
                        ? alpha(theme.palette.text.primary, 0.14)
                        : alpha(color, 0.3),
                    }}
                  />
                )}
              </Stack>
              {!short && (
                <Typography
                  fontWeight={600}
                  sx={{
                    fontSize: "0.78rem",
                    lineHeight: 1.3,
                    overflowWrap: "anywhere",
                  }}
                >
                  {block.entry.item.title}
                </Typography>
              )}
              {!short && speaker && (
                <Typography
                  sx={{
                    fontSize: "0.69rem",
                    lineHeight: 1.35,
                    overflowWrap: "anywhere",
                  }}
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
