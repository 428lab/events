import type { DragEvent } from "react";
import {
  Autocomplete,
  Avatar,
  Box,
  Button,
  Card,
  Chip,
  IconButton,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import type { Row, TrackRow } from "./scheduleEditorModel.js";
import {
  setCommon,
  setUnassigned,
  toggleTrack,
} from "./scheduleEditorModel.js";
import { formatTime, fromDateTimeLocal, toDateTimeLocal } from "../lib/format.js";

export interface MemberOption {
  id: string;
  label: string;
  avatarUrl: string | null;
}

/** タイムテーブル編集の1行（1コマ）。
 * 既存の 所要/担当/開始時刻 はそのままに、下部にトラックの行を足している (#338)。
 * トラックの操作は**すべてタップだけで完結**する（チップ・スイッチ・ボタン）。 */
export function ScheduleItemRow({
  row,
  time,
  memberOptions,
  tracks,
  dragging,
  onDragHandleDown,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onChange,
  onMove,
  onDelete,
  canMoveUp,
  canMoveDown,
}: {
  row: Row;
  time: number | null;
  memberOptions: MemberOption[];
  tracks: TrackRow[];
  dragging: boolean;
  onDragHandleDown: () => void;
  onDragStart: (e: DragEvent) => void;
  onDragEnter: () => void;
  onDragEnd: () => void;
  onChange: (next: Row) => void;
  onMove: (delta: number) => void;
  onDelete: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const { t } = useTranslation();
  const update = (patch: Partial<Row>) => onChange({ ...row, ...patch });

  /** 担当欄に表示する値。メンバー一覧に居ないリンク（退会申請中など #250）は
   * プレースホルダで見せる。null（＝空欄）にすると、リンクが外れたように見えて
   * staff がうっかり上書きしてしまう */
  const speakerValue: MemberOption | string = row.speakerUserId
    ? (memberOptions.find((o) => o.id === row.speakerUserId) ?? {
        id: row.speakerUserId,
        label: t("schedule.hiddenMember"),
        avatarUrl: null,
      })
    : row.speakerName;

  const unassigned = row.placement === "unassigned";

  return (
    <Card
      variant="outlined"
      draggable={dragging}
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragEnd={onDragEnd}
      sx={{ p: 1.5, opacity: dragging ? 0.5 : 1 }}
    >
      <Stack direction="row" spacing={1} alignItems="flex-start">
        <Box
          onMouseDown={onDragHandleDown}
          onMouseUp={onDragEnd}
          sx={{
            display: { xs: "none", sm: "flex" },
            alignItems: "center",
            alignSelf: "stretch",
            cursor: "grab",
            color: "text.disabled",
            touchAction: "none",
          }}
          title={t("schedule.dragToReorder")}
        >
          <DragIndicatorIcon fontSize="small" />
        </Box>
        <Typography
          variant="body2"
          fontWeight={600}
          color={unassigned ? "text.disabled" : "text.primary"}
          sx={{ width: 48, pt: 1.25, flexShrink: 0 }}
        >
          {time !== null ? formatTime(time) : "--:--"}
        </Typography>
        <Stack spacing={1} sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <TextField
              label={t("schedule.content")}
              size="small"
              value={row.title}
              onChange={(e) => update({ title: e.target.value })}
              inputProps={{ maxLength: 100 }}
              sx={{ flex: 1 }}
            />
            <TextField
              label={t("schedule.durationLabel")}
              type="number"
              size="small"
              value={row.durationMin}
              onChange={(e) =>
                update({
                  durationMin: Math.max(
                    0,
                    Math.min(1440, Math.floor(Number(e.target.value) || 0)),
                  ),
                })
              }
              sx={{ width: { xs: "100%", sm: 100 } }}
            />
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <Autocomplete
              freeSolo
              size="small"
              options={memberOptions}
              value={speakerValue}
              onChange={(_, v) => {
                if (v && typeof v !== "string") {
                  update({ speakerUserId: v.id, speakerName: "" });
                } else {
                  update({
                    speakerUserId: null,
                    speakerName: typeof v === "string" ? v : "",
                  });
                }
              }}
              onInputChange={(_, v, reason) => {
                // 手入力はフリーテキスト扱い（メンバーへのリンクは解除）
                if (reason === "input") {
                  update({ speakerUserId: null, speakerName: v });
                }
              }}
              getOptionLabel={(o) => (typeof o === "string" ? o : o.label)}
              renderOption={(props, o) => (
                <li {...props} key={o.id}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Avatar
                      src={o.avatarUrl ?? undefined}
                      sx={{ width: 22, height: 22, fontSize: 12 }}
                    >
                      {o.label.charAt(0)}
                    </Avatar>
                    <span>{o.label}</span>
                  </Stack>
                </li>
              )}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label={t("schedule.speakerFieldLabel")}
                  inputProps={{ ...params.inputProps, maxLength: 100 }}
                />
              )}
              sx={{ width: { xs: "100%", sm: 240 } }}
            />
            <TextField
              label={t("schedule.startsAtLabel")}
              type="datetime-local"
              size="small"
              value={toDateTimeLocal(row.startsAt)}
              onChange={(e) =>
                update({ startsAt: fromDateTimeLocal(e.target.value) })
              }
              InputLabelProps={{ shrink: true }}
              sx={{ width: { xs: "100%", sm: 220 } }}
            />
          </Stack>
          <TextField
            label={t("schedule.descriptionLabel")}
            size="small"
            multiline
            minRows={1}
            value={row.description}
            onChange={(e) => update({ description: e.target.value })}
            inputProps={{ maxLength: 1000 }}
            fullWidth
          />
          <TextField
            label={t("schedule.materialUrlLabel")}
            size="small"
            type="url"
            value={row.materialUrl}
            onChange={(e) => update({ materialUrl: e.target.value })}
            error={
              row.materialUrl.trim() !== "" &&
              !/^https?:\/\//.test(row.materialUrl.trim())
            }
            helperText={
              row.materialUrl.trim() !== "" &&
              !/^https?:\/\//.test(row.materialUrl.trim())
                ? t("eventForm.materialUrlInvalid")
                : undefined
            }
            inputProps={{ maxLength: 500 }}
            fullWidth
          />

          {/* 配置（トラック）の行 #338 */}
          <Stack
            direction="row"
            spacing={0.75}
            alignItems="center"
            flexWrap="wrap"
            useFlexGap
          >
            {(tracks.length > 0 || unassigned) && (
              <Typography variant="caption" color="text.secondary">
                {t("schedule.tracks")}
              </Typography>
            )}
            {unassigned ? (
              <>
                <Chip
                  size="small"
                  color="default"
                  variant="outlined"
                  label={t("schedule.unassignedChip")}
                />
                {/* 配置＝まず全トラック共通に置き、そこからチップで絞る */}
                <Button size="small" onClick={() => onChange(setCommon(row))}>
                  {t("schedule.place")}
                </Button>
              </>
            ) : (
              <>
                {tracks.map((track) => {
                  const on =
                    row.placement === "tracks" &&
                    row.trackKeys.includes(track.key);
                  return (
                    <Chip
                      key={track.key}
                      size="small"
                      label={
                        track.name.trim() === ""
                          ? t("schedule.unnamedTrack")
                          : track.name
                      }
                      color={on ? "primary" : "default"}
                      variant={on ? "filled" : "outlined"}
                      onClick={() => onChange(toggleTrack(row, track.key))}
                      aria-pressed={on}
                    />
                  );
                })}
                {tracks.length > 0 && (
                  <Stack direction="row" alignItems="center" spacing={0.25}>
                    <Switch
                      size="small"
                      checked={row.placement === "all"}
                      onChange={(e) =>
                        onChange(
                          e.target.checked
                            ? setCommon(row)
                            : // 個別に切り替えるときは先頭のトラックへ置く。
                              // ここで空にすると未割り当てへ飛んでしまう
                              toggleTrack(setCommon(row), tracks[0]!.key),
                        )
                      }
                      inputProps={{ "aria-label": t("schedule.commonToggle") }}
                    />
                    <Typography variant="caption">
                      {t("schedule.commonToggle")}
                    </Typography>
                  </Stack>
                )}
                <Button size="small" onClick={() => onChange(setUnassigned(row))}>
                  {t("schedule.backToUnassigned")}
                </Button>
              </>
            )}
          </Stack>
        </Stack>
        <Stack spacing={0} sx={{ flexShrink: 0 }}>
          <IconButton
            size="small"
            disabled={!canMoveUp}
            onClick={() => onMove(-1)}
            title={t("common.moveUp")}
          >
            <ArrowUpwardIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            disabled={!canMoveDown}
            onClick={() => onMove(1)}
            title={t("common.moveDown")}
          >
            <ArrowDownwardIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={onDelete} title={t("schedule.deleteRow")}>
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Stack>
      </Stack>
    </Card>
  );
}
