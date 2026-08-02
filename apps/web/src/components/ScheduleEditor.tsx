import { useState } from "react";
import {
  Alert,
  Autocomplete,
  Avatar,
  Box,
  Button,
  Card,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import PlaylistAddIcon from "@mui/icons-material/PlaylistAdd";
import type { SaveScheduleItemInput, ScheduleItem } from "@eventer/shared";
import {
  SCHEDULE_DEFAULT_DURATION_MIN,
  SCHEDULE_TEMPLATES,
  computeScheduleTimes,
} from "@eventer/shared";
import { useEventMembers } from "../api/hooks.js";
import { useSaveEventSchedule } from "../api/eventScheduleHooks.js";
import {
  formatTime,
  fromDateTimeLocal,
  toDateTimeLocal,
} from "../lib/format.js";

/** 編集中の1行（key は React の並び替え用） */
interface Row extends SaveScheduleItemInput {
  key: string;
}

interface MemberOption {
  id: string;
  label: string;
  avatarUrl: string | null;
}

function newRow(partial?: Partial<SaveScheduleItemInput>): Row {
  return {
    key: crypto.randomUUID(),
    title: "",
    description: "",
    durationMin: SCHEDULE_DEFAULT_DURATION_MIN,
    startsAt: null,
    speakerUserId: null,
    speakerName: "",
    ...partial,
  };
}

/** タイムテーブルの編集（staff 用）。行の追加/削除・ドラッグ/ボタンでの並び替え・
 * テンプレートからの作成に対応。時刻プレビューは表示と同じロジックで自動計算する。 */
export function ScheduleEditor({
  eventId,
  eventStartsAt,
  items,
  onClose,
}: {
  eventId: string;
  eventStartsAt: number | null;
  items: ScheduleItem[];
  onClose: () => void;
}) {
  const { data: members } = useEventMembers(eventId, true);
  const save = useSaveEventSchedule(eventId);
  const [rows, setRows] = useState<Row[]>(() =>
    items.map((it) =>
      newRow({
        title: it.title,
        description: it.description,
        durationMin: it.durationMin,
        startsAt: it.startsAt,
        speakerUserId: it.speaker?.id ?? null,
        speakerName: it.speakerName,
      }),
    ),
  );
  const [templateAnchor, setTemplateAnchor] = useState<null | HTMLElement>(null);
  // ドラッグ並び替え：ハンドルを押した行だけ draggable にする（入力操作と干渉させない）
  const [dragKey, setDragKey] = useState<string | null>(null);

  const memberOptions: MemberOption[] = (members ?? []).map((m) => ({
    id: m.user.id,
    label: m.user.globalName ?? m.user.username,
    avatarUrl: m.user.avatarUrl,
  }));

  const times = computeScheduleTimes(rows, eventStartsAt);

  const update = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const move = (from: number, to: number) =>
    setRows((rs) => {
      if (to < 0 || to >= rs.length) return rs;
      const next = [...rs];
      const [row] = next.splice(from, 1);
      next.splice(to, 0, row);
      return next;
    });

  const onDragEnterRow = (i: number) => {
    if (dragKey === null) return;
    const from = rows.findIndex((r) => r.key === dragKey);
    if (from < 0 || from === i) return;
    move(from, i);
  };

  const applyTemplate = (templateKey: string) => {
    setTemplateAnchor(null);
    const template = SCHEDULE_TEMPLATES.find((t) => t.key === templateKey);
    if (!template) return;
    if (
      rows.length > 0 &&
      !window.confirm("現在の内容をテンプレートで置き換えますか？")
    ) {
      return;
    }
    setRows(template.items.map((it) => newRow(it)));
  };

  const canSave = rows.every((r) => r.title.trim().length > 0);

  const submit = () =>
    save.mutate(
      rows.map((r) => ({
        title: r.title.trim(),
        description: r.description,
        durationMin: r.durationMin,
        startsAt: r.startsAt,
        speakerUserId: r.speakerUserId,
        speakerName: r.speakerName,
      })),
      { onSuccess: onClose },
    );

  return (
    <Stack spacing={1.5}>
      {rows.map((row, i) => (
        <Card
          key={row.key}
          variant="outlined"
          draggable={dragKey === row.key}
          onDragStart={(e) => e.dataTransfer.setData("text/plain", row.key)}
          onDragEnter={() => onDragEnterRow(i)}
          onDragOver={(e) => e.preventDefault()}
          onDragEnd={() => setDragKey(null)}
          sx={{ p: 1.5, opacity: dragKey === row.key ? 0.5 : 1 }}
        >
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <Box
              onMouseDown={() => setDragKey(row.key)}
              onMouseUp={() => setDragKey(null)}
              sx={{
                display: { xs: "none", sm: "flex" },
                alignItems: "center",
                alignSelf: "stretch",
                cursor: "grab",
                color: "text.disabled",
                touchAction: "none",
              }}
              title="ドラッグで並び替え"
            >
              <DragIndicatorIcon fontSize="small" />
            </Box>
            <Typography
              variant="body2"
              fontWeight={600}
              sx={{ width: 48, pt: 1.25, flexShrink: 0 }}
            >
              {times[i] !== null ? formatTime(times[i]!) : "--:--"}
            </Typography>
            <Stack spacing={1} sx={{ flex: 1, minWidth: 0 }}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <TextField
                  label="内容"
                  size="small"
                  value={row.title}
                  onChange={(e) => update(i, { title: e.target.value })}
                  inputProps={{ maxLength: 100 }}
                  sx={{ flex: 1 }}
                />
                <TextField
                  label="所要（分）"
                  type="number"
                  size="small"
                  value={row.durationMin}
                  onChange={(e) =>
                    update(i, {
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
                  value={
                    row.speakerUserId
                      ? (memberOptions.find((o) => o.id === row.speakerUserId) ??
                        null)
                      : row.speakerName
                  }
                  onChange={(_, v) => {
                    if (v && typeof v !== "string") {
                      update(i, { speakerUserId: v.id, speakerName: "" });
                    } else {
                      update(i, {
                        speakerUserId: null,
                        speakerName: typeof v === "string" ? v : "",
                      });
                    }
                  }}
                  onInputChange={(_, v, reason) => {
                    // 手入力はフリーテキスト扱い（メンバーへのリンクは解除）
                    if (reason === "input") {
                      update(i, { speakerUserId: null, speakerName: v });
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
                      label="担当（メンバー or 自由入力）"
                      inputProps={{ ...params.inputProps, maxLength: 100 }}
                    />
                  )}
                  sx={{ width: { xs: "100%", sm: 240 } }}
                />
                <TextField
                  label="開始時刻を指定（任意）"
                  type="datetime-local"
                  size="small"
                  value={toDateTimeLocal(row.startsAt)}
                  onChange={(e) =>
                    update(i, { startsAt: fromDateTimeLocal(e.target.value) })
                  }
                  InputLabelProps={{ shrink: true }}
                  sx={{ width: { xs: "100%", sm: 220 } }}
                />
              </Stack>
              <TextField
                label="説明（任意）"
                size="small"
                multiline
                minRows={1}
                value={row.description}
                onChange={(e) => update(i, { description: e.target.value })}
                inputProps={{ maxLength: 1000 }}
                fullWidth
              />
            </Stack>
            <Stack spacing={0} sx={{ flexShrink: 0 }}>
              <IconButton
                size="small"
                disabled={i === 0}
                onClick={() => move(i, i - 1)}
                title="上へ移動"
              >
                <ArrowUpwardIcon fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                disabled={i === rows.length - 1}
                onClick={() => move(i, i + 1)}
                title="下へ移動"
              >
                <ArrowDownwardIcon fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                title="この行を削除"
              >
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Stack>
          </Stack>
        </Card>
      ))}

      {save.isError && (
        <Alert severity="error">タイムテーブルの保存に失敗しました。</Alert>
      )}

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Button
          size="small"
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={() => setRows((rs) => [...rs, newRow()])}
        >
          行を追加
        </Button>
        <Button
          size="small"
          variant="outlined"
          startIcon={<PlaylistAddIcon />}
          onClick={(e) => setTemplateAnchor(e.currentTarget)}
        >
          テンプレから作成
        </Button>
        <Menu
          anchorEl={templateAnchor}
          open={Boolean(templateAnchor)}
          onClose={() => setTemplateAnchor(null)}
        >
          {SCHEDULE_TEMPLATES.map((t) => (
            <MenuItem key={t.key} onClick={() => applyTemplate(t.key)}>
              {t.name}
            </MenuItem>
          ))}
        </Menu>
        <Box sx={{ flex: 1 }} />
        <Button size="small" onClick={onClose} disabled={save.isPending}>
          キャンセル
        </Button>
        <Button
          size="small"
          variant="contained"
          onClick={submit}
          disabled={!canSave || save.isPending}
        >
          保存
        </Button>
      </Stack>
    </Stack>
  );
}
