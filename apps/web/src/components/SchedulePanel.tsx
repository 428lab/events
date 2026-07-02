import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  IconButton,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import type { VoteChoice } from "@eventer/shared";
import { useMe } from "../api/hooks.js";
import {
  useAddDateOption,
  useDeleteDateOption,
  useEventSchedule,
  useFinalizeDate,
  useVoteDateOption,
} from "../api/scheduleHooks.js";
import { formatDateRange, fromDateTimeLocal } from "../lib/format.js";

const CHOICES: { value: VoteChoice; label: string }[] = [
  { value: "yes", label: "○" },
  { value: "maybe", label: "△" },
  { value: "no", label: "×" },
];

export function SchedulePanel({
  eventId,
  isStaff,
}: {
  eventId: string;
  isStaff: boolean;
}) {
  const { data: me } = useMe();
  const { data, isLoading } = useEventSchedule(eventId);
  const vote = useVoteDateOption(eventId);
  const addOption = useAddDateOption(eventId);
  const delOption = useDeleteDateOption(eventId);
  const finalize = useFinalizeDate(eventId);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const add = () => {
    const s = fromDateTimeLocal(start);
    const e = fromDateTimeLocal(end);
    if (s == null || e == null) return;
    addOption.mutate(
      { startsAt: s, endsAt: e },
      {
        onSuccess: () => {
          setStart("");
          setEnd("");
        },
      },
    );
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          📅 日程調整
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          候補日ごとに ○（参加）/△（未定）/×（不可）で回答してください。
        </Typography>

        {isLoading || !data ? (
          <Typography>読み込み中…</Typography>
        ) : data.options.length === 0 ? (
          <Typography color="text.secondary">
            候補日はまだありません。
            {isStaff && "下のフォームから追加してください。"}
          </Typography>
        ) : (
          <Stack spacing={1.5}>
            {data.options.map((o) => (
              <Box
                key={o.id}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  flexWrap: "wrap",
                }}
              >
                <Box sx={{ flex: 1, minWidth: 180 }}>
                  <Typography fontWeight={600}>
                    {formatDateRange(o.startsAt, o.endsAt)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    ○ {o.counts.yes} ・ △ {o.counts.maybe} ・ × {o.counts.no}
                  </Typography>
                </Box>
                {me && (
                  <ToggleButtonGroup
                    size="small"
                    exclusive
                    value={data.myVotes[o.id] ?? null}
                    onChange={(_e, v) =>
                      v && vote.mutate({ optionId: o.id, choice: v })
                    }
                  >
                    {CHOICES.map((ch) => (
                      <ToggleButton key={ch.value} value={ch.value}>
                        {ch.label}
                      </ToggleButton>
                    ))}
                  </ToggleButtonGroup>
                )}
                {isStaff && (
                  <>
                    <Button
                      size="small"
                      variant="outlined"
                      color="secondary"
                      disabled={finalize.isPending}
                      onClick={() => {
                        if (window.confirm("この日程に決定しますか？"))
                          finalize.mutate(o.id);
                      }}
                    >
                      この日程に決定
                    </Button>
                    <Tooltip title="候補を削除">
                      <IconButton
                        size="small"
                        onClick={() => delOption.mutate(o.id)}
                      >
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </>
                )}
              </Box>
            ))}
          </Stack>
        )}

        {!me && (
          <Alert severity="info" sx={{ mt: 2 }}>
            回答するにはログインしてください。
          </Alert>
        )}

        {isStaff && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" gutterBottom>
              候補日を追加
            </Typography>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              alignItems={{ sm: "center" }}
            >
              <TextField
                label="開始"
                type="datetime-local"
                size="small"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label="終了"
                type="datetime-local"
                size="small"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
              <Button
                variant="contained"
                onClick={add}
                disabled={!start || !end || addOption.isPending}
              >
                追加
              </Button>
            </Stack>
          </>
        )}
      </CardContent>
    </Card>
  );
}
