import { useMemo, useState } from "react";
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
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import type { VoteChoice } from "@eventer/shared";
import { useMe } from "../api/hooks.js";
import {
  useAddDateOption,
  useDeleteDateOption,
  useEventSchedule,
  useFinalizeDate,
  useVoteDateOption,
} from "../api/scheduleHooks.js";
import { formatDateRange } from "../lib/format.js";

const CHOICES: { value: VoteChoice; label: string }[] = [
  { value: "yes", label: "○" },
  { value: "maybe", label: "△" },
  { value: "no", label: "×" },
];

const dateKey = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** 月グリッドのミニカレンダー。日付タップで複数選択（過去は不可）。候補あり日はドット表示 */
function MiniCalendar({
  selected,
  onToggle,
  optionDays,
}: {
  selected: Set<string>;
  onToggle: (key: string) => void;
  optionDays: Set<string>;
}) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const y = month.getFullYear();
  const m = month.getMonth();
  const firstDow = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_v, i) => i + 1),
  ];

  return (
    <Box sx={{ maxWidth: 340 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <IconButton
          size="small"
          onClick={() => setMonth(new Date(y, m - 1, 1))}
        >
          <ChevronLeftIcon fontSize="small" />
        </IconButton>
        <Typography variant="subtitle2">
          {y}年{m + 1}月
        </Typography>
        <IconButton
          size="small"
          onClick={() => setMonth(new Date(y, m + 1, 1))}
        >
          <ChevronRightIcon fontSize="small" />
        </IconButton>
      </Stack>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 0.25,
          mt: 0.5,
        }}
      >
        {WEEKDAYS.map((w, i) => (
          <Typography
            key={w}
            variant="caption"
            align="center"
            sx={{
              color:
                i === 0 ? "error.main" : i === 6 ? "primary.main" : "text.secondary",
            }}
          >
            {w}
          </Typography>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <Box key={`b${i}`} />;
          const key = dateKey(y, m, d);
          const date = new Date(y, m, d);
          const past = date < today;
          const isSel = selected.has(key);
          return (
            <Box
              key={key}
              onClick={() => !past && onToggle(key)}
              sx={{
                aspectRatio: "1",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "50%",
                cursor: past ? "default" : "pointer",
                opacity: past ? 0.35 : 1,
                bgcolor: isSel ? "primary.main" : "transparent",
                color: isSel ? "primary.contrastText" : "text.primary",
                "&:hover": past
                  ? undefined
                  : { bgcolor: isSel ? "primary.main" : "action.hover" },
                position: "relative",
                userSelect: "none",
                fontSize: 14,
              }}
            >
              {d}
              {optionDays.has(key) && (
                <Box
                  sx={{
                    position: "absolute",
                    bottom: 3,
                    width: 4,
                    height: 4,
                    borderRadius: "50%",
                    bgcolor: isSel ? "primary.contrastText" : "secondary.main",
                  }}
                />
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

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

  // 時間帯は1回指定、日付はカレンダーで複数選択→一括追加
  const [startTime, setStartTime] = useState("19:00");
  const [endTime, setEndTime] = useState("21:00");
  const [selectedDays, setSelectedDays] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);

  const optionDays = useMemo(() => {
    const s = new Set<string>();
    for (const o of data?.options ?? []) {
      const d = new Date(o.startsAt);
      s.add(dateKey(d.getFullYear(), d.getMonth(), d.getDate()));
    }
    return s;
  }, [data]);

  const toggleDay = (key: string) =>
    setSelectedDays((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const addSelected = async () => {
    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return;
    setAdding(true);
    try {
      for (const key of [...selectedDays].sort()) {
        const [yy, mm, dd] = key.split("-").map(Number);
        const s = new Date(yy, mm - 1, dd, sh, sm).getTime();
        let e = new Date(yy, mm - 1, dd, eh, em).getTime();
        if (e <= s) e += 24 * 3600 * 1000; // 終了が開始以前なら翌日跨ぎとみなす
        await addOption.mutateAsync({ startsAt: s, endsAt: e });
      }
      setSelectedDays(new Set());
    } finally {
      setAdding(false);
    }
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
            {isStaff && "下のカレンダーから追加してください。"}
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
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <TextField
                label="開始"
                type="time"
                size="small"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                InputLabelProps={{ shrink: true }}
                sx={{ width: 110 }}
              />
              <Typography variant="body2" color="text.secondary">
                〜
              </Typography>
              <TextField
                label="終了"
                type="time"
                size="small"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                InputLabelProps={{ shrink: true }}
                sx={{ width: 110 }}
              />
            </Stack>
            <Typography variant="caption" color="text.secondary">
              カレンダーの日付をタップして選択（複数可）
            </Typography>
            <MiniCalendar
              selected={selectedDays}
              onToggle={toggleDay}
              optionDays={optionDays}
            />
            <Button
              variant="contained"
              sx={{ mt: 1.5 }}
              disabled={selectedDays.size === 0 || adding}
              onClick={addSelected}
            >
              {adding
                ? "追加中…"
                : `選択した ${selectedDays.size} 日を候補に追加`}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
