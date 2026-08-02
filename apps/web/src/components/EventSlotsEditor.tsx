import { useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import { Link as RouterLink } from "react-router-dom";
import { SELECTION_TYPES, type SelectionType } from "@eventer/shared";
import {
  useCreateSlot,
  useDeleteSlot,
  useDrawSlot,
  useEventSlots,
  useUpdateSlot,
} from "../api/hooks.js";
import { toDateTimeLocal, fromDateTimeLocal } from "../lib/format.js";
import { CounterTextField } from "./CounterTextField.js";
import { BlurCounterField } from "./BlurCounterField.js";

const typeLabel: Record<SelectionType, string> = {
  first_come: "先着順",
  lottery: "抽選",
};

export function EventSlotsEditor({ eventId }: { eventId: string }) {
  const { data: slots } = useEventSlots(eventId);
  const create = useCreateSlot(eventId);
  const update = useUpdateSlot(eventId);
  const remove = useDeleteSlot(eventId);
  const draw = useDrawSlot(eventId);

  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState(10);
  const [selectionType, setSelectionType] = useState<SelectionType>("first_come");

  const add = () => {
    if (!name) return;
    create.mutate(
      { name, capacity, selectionType },
      {
        onSuccess: () => {
          setName("");
          setCapacity(10);
          setSelectionType("first_come");
        },
      },
    );
  };

  return (
    <Box>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{ mb: 1 }}
      >
        <Typography variant="subtitle1">参加枠（定員・先着/抽選）</Typography>
        {slots?.some((s) => s.selectionType === "lottery") && (
          <Button
            size="small"
            variant="outlined"
            component={RouterLink}
            to={`/events/${eventId}/lottery`}
          >
            当選操作・抽選結果
          </Button>
        )}
      </Stack>

      <Stack spacing={1.5}>
        {slots?.map((s) => (
          <Card key={s.id} variant="outlined">
            <CardContent>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems="center">
                <BlurCounterField
                  label="枠名"
                  initial={s.name}
                  max={100}
                  onSave={(v) =>
                    v !== s.name &&
                    v &&
                    update.mutate({ slotId: s.id, input: { name: v } })
                  }
                  sx={{ flex: 1 }}
                />
                <TextField
                  label="定員"
                  type="number"
                  defaultValue={s.capacity}
                  onBlur={(e) =>
                    Number(e.target.value) !== s.capacity &&
                    update.mutate({
                      slotId: s.id,
                      input: { capacity: Number(e.target.value) },
                    })
                  }
                  sx={{ width: 100 }}
                  size="small"
                />
                <TextField
                  label="方式"
                  select
                  value={s.selectionType}
                  onChange={(e) =>
                    update.mutate({
                      slotId: s.id,
                      input: { selectionType: e.target.value as SelectionType },
                    })
                  }
                  sx={{ width: 120 }}
                  size="small"
                >
                  {SELECTION_TYPES.map((t) => (
                    <MenuItem key={t} value={t}>
                      {typeLabel[t]}
                    </MenuItem>
                  ))}
                </TextField>
                <IconButton color="error" onClick={() => remove.mutate(s.id)}>
                  <DeleteIcon />
                </IconButton>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                確定 {s.confirmedCount}/{s.capacity}
                {s.appliedCount > 0 ? ` ・ 抽選申込 ${s.appliedCount}` : ""}
                {s.waitlistCount > 0 ? ` ・ キャンセル待ち ${s.waitlistCount}` : ""}
              </Typography>
              {s.selectionType === "lottery" && (
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={1.5}
                  alignItems={{ sm: "center" }}
                  sx={{ mt: 1.5 }}
                >
                  <TextField
                    label="抽選日時（任意）"
                    type="datetime-local"
                    size="small"
                    defaultValue={toDateTimeLocal(s.drawAt)}
                    InputLabelProps={{ shrink: true }}
                    onBlur={(e) => {
                      const v = fromDateTimeLocal(e.target.value);
                      if (v !== s.drawAt) {
                        update.mutate({ slotId: s.id, input: { drawAt: v } });
                      }
                    }}
                    sx={{ width: 220 }}
                  />
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={draw.isPending || s.appliedCount === 0}
                    onClick={() => draw.mutate(s.id)}
                  >
                    自動抽選（申込 {s.appliedCount} → 定員 {s.capacity}）
                  </Button>
                </Stack>
              )}
            </CardContent>
          </Card>
        ))}
      </Stack>

      {slots && slots.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          まだ参加枠がありません。下の「追加」ボタンで枠を追加できます（枠なしの場合は定員なしで参加できます）。
        </Typography>
      )}

      <Card variant="outlined" sx={{ mt: 2 }}>
        <CardContent>
          <Typography variant="subtitle2" gutterBottom>
            枠を追加
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems="center">
            <CounterTextField
              label="枠名"
              value={name}
              max={100}
              onChange={(e) => setName(e.target.value)}
              sx={{ flex: 1 }}
              size="small"
            />
            <TextField
              label="定員"
              type="number"
              value={capacity}
              onChange={(e) => setCapacity(Number(e.target.value))}
              sx={{ width: 100 }}
              size="small"
            />
            <TextField
              label="方式"
              select
              value={selectionType}
              onChange={(e) => setSelectionType(e.target.value as SelectionType)}
              sx={{ width: 120 }}
              size="small"
            >
              {SELECTION_TYPES.map((t) => (
                <MenuItem key={t} value={t}>
                  {typeLabel[t]}
                </MenuItem>
              ))}
            </TextField>
            <Button
              variant="contained"
              disabled={!name || create.isPending}
              onClick={add}
            >
              追加
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
