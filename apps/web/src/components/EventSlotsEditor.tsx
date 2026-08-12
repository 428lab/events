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
import { useTranslation } from "react-i18next";
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

/** 枠の選び方 (`SelectionType`) → 翻訳キー。並びは SELECTION_TYPES が持つ */
const TYPE_KEY = {
  first_come: "eventForm.slotTypeFirstCome",
  lottery: "eventForm.slotTypeLottery",
} as const satisfies Record<SelectionType, string>;

export function EventSlotsEditor({ eventId }: { eventId: string }) {
  const { t } = useTranslation();
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
        <Typography variant="subtitle1">
          {t("eventForm.slotsEditorHeading")}
        </Typography>
        {/* 先着枠でも申込者の管理は要る（当日キャンセルの繰り上げ）ので、
            抽選枠の有無ではなく参加枠の有無で出す (#286) */}
        {(slots?.length ?? 0) > 0 && (
          <Button
            size="small"
            variant="outlined"
            component={RouterLink}
            to={`/events/${eventId}/lottery`}
          >
            {t("eventForm.manageApplicants")}
          </Button>
        )}
      </Stack>

      <Stack spacing={1.5}>
        {slots?.map((s) => (
          <Card key={s.id} variant="outlined">
            <CardContent>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems="center">
                <BlurCounterField
                  label={t("eventForm.slotName")}
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
                  label={t("eventForm.slotCapacity")}
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
                  label={t("eventForm.slotSelection")}
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
                  {SELECTION_TYPES.map((type) => (
                    <MenuItem key={type} value={type}>
                      {t(TYPE_KEY[type])}
                    </MenuItem>
                  ))}
                </TextField>
                <IconButton color="error" onClick={() => remove.mutate(s.id)}>
                  <DeleteIcon />
                </IconButton>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {t("eventForm.slotConfirmedOfCapacity", {
                  n: s.confirmedCount,
                  total: s.capacity,
                })}
                {s.appliedCount > 0
                  ? t("common.dotSeparator") +
                    t("eventForm.slotAppliedCount", { n: s.appliedCount })
                  : ""}
                {s.waitlistCount > 0
                  ? t("common.dotSeparator") +
                    t("eventForm.slotWaitlistCount", { n: s.waitlistCount })
                  : ""}
              </Typography>
              {s.selectionType === "lottery" && (
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={1.5}
                  alignItems={{ sm: "center" }}
                  sx={{ mt: 1.5 }}
                >
                  <TextField
                    label={t("eventForm.slotDrawAt")}
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
                    {t("eventForm.slotDraw", {
                      n: s.appliedCount,
                      total: s.capacity,
                    })}
                  </Button>
                </Stack>
              )}
            </CardContent>
          </Card>
        ))}
      </Stack>

      {slots && slots.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t("eventForm.slotsEmpty")}
        </Typography>
      )}

      <Card variant="outlined" sx={{ mt: 2 }}>
        <CardContent>
          <Typography variant="subtitle2" gutterBottom>
            {t("eventForm.slotAddHeading")}
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems="center">
            <CounterTextField
              label={t("eventForm.slotName")}
              value={name}
              max={100}
              onChange={(e) => setName(e.target.value)}
              sx={{ flex: 1 }}
              size="small"
            />
            <TextField
              label={t("eventForm.slotCapacity")}
              type="number"
              value={capacity}
              onChange={(e) => setCapacity(Number(e.target.value))}
              sx={{ width: 100 }}
              size="small"
            />
            <TextField
              label={t("eventForm.slotSelection")}
              select
              value={selectionType}
              onChange={(e) => setSelectionType(e.target.value as SelectionType)}
              sx={{ width: 120 }}
              size="small"
            >
              {SELECTION_TYPES.map((type) => (
                <MenuItem key={type} value={type}>
                  {t(TYPE_KEY[type])}
                </MenuItem>
              ))}
            </TextField>
            <Button
              variant="contained"
              disabled={!name || create.isPending}
              onClick={add}
            >
              {t("eventForm.slotAdd")}
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
