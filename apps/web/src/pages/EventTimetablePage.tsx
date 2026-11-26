import { Box, Button, Chip, Stack, Typography, useMediaQuery } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ChecklistIcon from "@mui/icons-material/Checklist";
import { Link as RouterLink, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useEvent } from "../api/hooks.js";
import { useEventSchedule } from "../api/eventScheduleHooks.js";
import { formatDateTime } from "../lib/format.js";
import { buildTimetableLayout } from "../lib/timetableLayout.js";
import { trackColorsForTracks } from "../lib/trackColors.js";
import { TimetableGrid } from "../components/TimetableGrid.js";
import { TimetableTrackTabs } from "../components/TimetableTrackTabs.js";

/** マルチトラックのタイムテーブル画面 (#338)。
 *
 * 既存の時刻順一覧（イベント詳細の EventSchedule）はそのまま残し、
 * 「並行して走っているのが見える」ことだけをこの画面が引き受ける。
 * 導線はトラックが2本以上あるときだけ出る（1本以下では格子にする意味がない）。 */
export function EventTimetablePage() {
  const { id = "" } = useParams();
  const { t } = useTranslation();
  const theme = useTheme();
  const { data: eventData } = useEvent(id);
  const { data } = useEventSchedule(id);
  // 広い画面は格子、狭い画面はトラック選択のタブ＋縦一覧。
  // 3本のトラックを並べるだけで 700px 近く要るので md で切り替える
  const wide = useMediaQuery(theme.breakpoints.up("md"));

  if (!eventData || !data) return <Typography>{t("common.loading")}</Typography>;

  const event = eventData.event;
  // 日程調整中は開始時刻が無い＝どのコマも時刻が決まらない。壊れずに
  // 「時刻未定」として並ぶ（computeScheduleTimes が null を返す）
  const layout = buildTimetableLayout(
    data.items,
    data.tracks,
    event.scheduling ? null : event.startsAt,
  );
  // 色は**公開トラックの本数だけ**で作る (#383)。スタッフ用の列を本数に
  // 混ぜると、同じトラックが参加者と運営で別の色になる
  const colors = trackColorsForTracks(
    theme.palette.primary.main,
    theme.palette.secondary.main,
    layout.tracks,
  );

  return (
    <Stack spacing={2}>
      <Box>
        <Button
          component={RouterLink}
          to={`/events/${id}`}
          size="small"
          startIcon={<ArrowBackIcon />}
        >
          {t("schedule.backToEvent")}
        </Button>
      </Box>
      <Box>
        <Typography variant="h5">{t("schedule.timetable")}</Typography>
        <Typography variant="body2" color="text.secondary">
          {event.title}
        </Typography>
      </Box>

      {/* 準備の段取り (#393) との行き来。**データでは繋がない**（設計 3.6）ので
          リンクだけ。コマが1つも無いときは、時刻を持たない準備の仕事を
          ここに置こうとして迷うので、線引きを添える */}
      {eventData.myRole === "staff" && (
        <Box>
          <Button
            component={RouterLink}
            to={`/events/${id}/todos`}
            size="small"
            startIcon={<ChecklistIcon />}
          >
            {t("staffOps.todoFromTimetable")}
          </Button>
          {layout.cards.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              {t("staffOps.todoScopeNote")}
            </Typography>
          )}
        </Box>
      )}

      {layout.tracks.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t("schedule.noTracks")}
        </Typography>
      ) : layout.cards.length === 0 && wide ? (
        <Typography variant="body2" color="text.secondary">
          {t("schedule.noTimedSessions")}
        </Typography>
      ) : wide ? (
        <>
          <TimetableGrid layout={layout} colors={colors} />
          {/* 場所（トラック）の色の凡例。カードの左の線と場所の札が同じ色。
              裏方の凡例は、裏方が実際に届いているときだけ出す (#383) */}
          <Legend
            layout={layout}
            colors={colors}
            withStaff={
              layout.entries.some((e) => e.staffOnly) ||
              layout.tracks.some((track) => track.visibility === "staff")
            }
          />
        </>
      ) : (
        <TimetableTrackTabs layout={layout} colors={colors} />
      )}

      {/* 格子に置けなかったコマ。日程調整中のイベントはここに全部並ぶ */}
      {wide && layout.undated.length > 0 && (
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            {t("schedule.undatedHeading")}
          </Typography>
          <Stack spacing={0.5}>
            {layout.undated.map((e) => (
              <Typography key={e.item.id} variant="body2">
                {e.item.title}
                {e.item.durationMin > 0 && (
                  <Typography component="span" variant="caption" color="text.secondary">
                    {" "}
                    {t("schedule.durationMin", { n: e.item.durationMin })}
                  </Typography>
                )}
              </Typography>
            ))}
          </Stack>
        </Box>
      )}

      {/* 時刻はあるが、他のコマから離れすぎていて表に載らなかったコマ。
          ほとんどが年や日付の打ち間違いなので、直せるよう日付まで出す */}
      {wide && layout.outOfRange.length > 0 && (
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            {t("schedule.outOfRangeHeading")}
          </Typography>
          <Stack spacing={0.5}>
            {layout.outOfRange.map((e) => (
              <Typography key={e.item.id} variant="body2">
                {e.item.title}
                <Typography component="span" variant="caption" color="text.secondary">
                  {` ${formatDateTime(e.startsAt)}`}
                </Typography>
              </Typography>
            ))}
          </Stack>
        </Box>
      )}

      {/* 未割り当て（ネタ出し中）。サーバーが staff にしか返さないので、
          ここに出るのは編集できる人だけ (#338) */}
      {layout.unassigned.length > 0 && (
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            {t("schedule.unassignedHeading")}{" "}
            <Chip
              size="small"
              variant="outlined"
              label={t("schedule.notShownToParticipants")}
              sx={{ height: 18, fontSize: "0.7rem" }}
            />
          </Typography>
          <Stack spacing={0.5}>
            {layout.unassigned.map((it) => (
              <Typography key={it.id} variant="body2" color="text.secondary">
                {it.title}
              </Typography>
            ))}
          </Stack>
        </Box>
      )}
    </Stack>
  );
}

/** 場所の色の凡例。トラックは列で分けず、カードの左の線と場所の札の色で示すので、
 * 色と名前の対応をここに並べる（色だけでは5本を超えると区別が付かないので名前も出す）。
 * `withStaff` は裏方 (#383) が実際に届いているときだけ true になる */
function Legend({
  layout,
  colors,
  withStaff,
}: {
  layout: ReturnType<typeof buildTimetableLayout>;
  colors: Array<string | null>;
  withStaff: boolean;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const light = theme.palette.mode === "light";
  const used = new Set(layout.cards.flatMap((c) => c.trackIndexes));
  const swatch = (color: string, dashed = false) => (
    <Box
      component="span"
      sx={{
        display: "inline-block",
        width: 22,
        height: 14,
        borderRadius: "3px",
        mr: 0.75,
        verticalAlign: "-2px",
        border: "1px solid",
        borderStyle: dashed ? "dashed" : "solid",
        borderColor: alpha(theme.palette.text.primary, 0.2),
        borderLeft: `5px solid ${color}`,
        bgcolor: alpha(color, light ? 0.08 : 0.14),
      }}
    />
  );
  return (
    <Stack
      direction="row"
      spacing={2}
      flexWrap="wrap"
      useFlexGap
      sx={{ color: "text.secondary", fontSize: "0.8rem", alignItems: "center" }}
    >
      {layout.cards.some((c) => c.common) && (
        <Box component="span">
          {swatch(theme.palette.primary.main)}
          {t("schedule.allTracks")}
        </Box>
      )}
      {layout.tracks.map((track, i) =>
        used.has(i) ? (
          <Box component="span" key={track.id}>
            {swatch(colors[i] ?? theme.palette.text.secondary)}
            {track.name}
          </Box>
        ) : null,
      )}
      {withStaff && (
        <Box component="span">
          {swatch(theme.palette.text.secondary, true)}
          {t("schedule.staffOnlyChip")}
        </Box>
      )}
    </Stack>
  );
}
