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
import { SELECTION_TYPES, type SelectionType } from "@eventer/shared";
import {
  useCreateSlot,
  useDeleteSlot,
  useDrawSlot,
  useEventSlots,
  useUpdateSlot,
} from "../api/hooks.js";

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
      <Typography variant="subtitle1" gutterBottom>
        参加枠（定員・先着/抽選）
      </Typography>

      <Stack spacing={1.5}>
        {slots?.map((s) => (
          <Card key={s.id} variant="outlined">
            <CardContent>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems="center">
                <TextField
                  label="枠名"
                  defaultValue={s.name}
                  onBlur={(e) =>
                    e.target.value !== s.name &&
                    update.mutate({ slotId: s.id, input: { name: e.target.value } })
                  }
                  sx={{ flex: 1 }}
                  size="small"
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
                <Box sx={{ mt: 1 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={draw.isPending || s.appliedCount === 0}
                    onClick={() => draw.mutate(s.id)}
                  >
                    抽選を実行（申込 {s.appliedCount} 人 → 定員 {s.capacity}）
                  </Button>
                </Box>
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
            <TextField
              label="枠名"
              value={name}
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
