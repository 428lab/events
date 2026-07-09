import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  alpha,
} from "@mui/material";
import { useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router-dom";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import type { VoteChoice } from "@eventer/shared";
import { useMe, useUpdateEvent } from "../api/hooks.js";
import { UserLink } from "./UserLink.js";
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
  anonymous,
  finalized,
  visible,
}: {
  eventId: string;
  isStaff: boolean;
  anonymous: boolean;
  /** 日程確定済み（結果の閲覧のみ。回答・候補編集は不可） */
  finalized: boolean;
  /** 確定後も結果を表示する設定（主催者がオンオフ） */
  visible: boolean;
}) {
  const { data: me } = useMe();
  const { data, isLoading } = useEventSchedule(eventId);
  const vote = useVoteDateOption(eventId);
  const addOption = useAddDateOption(eventId);
  const delOption = useDeleteDateOption(eventId);
  const finalize = useFinalizeDate(eventId);
  const updateEvent = useUpdateEvent(eventId);
  const qc = useQueryClient();

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

  // 参加見込みが最多の候補（同率含む）をハイライトする。
  // 調整さんと同じ重み付け: ○=1、△=0.5
  const optionScore = (o: { counts: { yes: number; maybe: number } }) =>
    o.counts.yes + o.counts.maybe * 0.5;
  const maxScore = useMemo(() => {
    const m = Math.max(0, ...(data?.options ?? []).map(optionScore));
    return m > 0 ? m : null;
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

  // 確定済み: 候補が無い（＝日程調整を使っていない）イベントや、
  // 表示オフのイベントでは何も出さない（主催者には設定用に表示する）
  if (finalized) {
    if (isLoading || !data || data.options.length === 0) return null;
    if (!visible && !isStaff) return null;
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          {finalized ? "📅 日程調整の結果" : "📅 日程調整"}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {finalized
            ? "日程は確定済みです。回答の変更はできません。"
            : "候補日ごとに ○（参加）/△（未定）/×（不可）で回答してください。"}
        </Typography>

        {finalized && isStaff && !visible && (
          <Alert severity="info" sx={{ mb: 2 }}>
            この結果は現在あなた（スタッフ）にしか表示されていません。
          </Alert>
        )}

        {isLoading || !data ? (
          <Typography>読み込み中…</Typography>
        ) : data.options.length === 0 ? (
          <Typography color="text.secondary">
            候補日はまだありません。
            {isStaff && "下のカレンダーから追加してください。"}
          </Typography>
        ) : (
          <Stack spacing={1.5}>
            {data.options.map((o) => {
              const isTop = maxScore !== null && optionScore(o) === maxScore;
              return (
              <Box
                key={o.id}
                sx={
                  isTop
                    ? {
                        bgcolor: (t) => alpha(t.palette.warning.main, 0.12),
                        border: 1,
                        borderColor: (t) => alpha(t.palette.warning.main, 0.5),
                        borderRadius: 1.5,
                        px: 1,
                        py: 0.75,
                        mx: -1,
                      }
                    : undefined
                }
              >
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    flexWrap: "wrap",
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 180 }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography fontWeight={600}>
                        {formatDateRange(o.startsAt, o.endsAt)}
                      </Typography>
                      {isTop && (
                        <Chip
                          size="small"
                          color="warning"
                          variant="outlined"
                          label="★ 参加最多"
                          sx={{ fontWeight: 700 }}
                        />
                      )}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {isTop ? (
                        <Box
                          component="span"
                          sx={{ color: "warning.main", fontWeight: 700 }}
                        >
                          ○ {o.counts.yes}
                        </Box>
                      ) : (
                        <>○ {o.counts.yes}</>
                      )}
                      {" ・ △ "}
                      {o.counts.maybe}
                      {" ・ × "}
                      {o.counts.no}
                    </Typography>
                  </Box>
                  {me && !finalized && (
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
                  {isStaff && !finalized && (
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
                {/* 回答者一覧（匿名でない場合のみ。○△×ごとに表示） */}
                {!anonymous && o.voters.length > 0 && (
                  <Stack spacing={0.25} sx={{ mt: 0.5, pl: 0.5 }}>
                    {CHOICES.map((ch) => {
                      const vs = o.voters.filter((v) => v.choice === ch.value);
                      if (vs.length === 0) return null;
                      return (
                        <Stack
                          key={ch.value}
                          direction="row"
                          spacing={1}
                          alignItems="center"
                          flexWrap="wrap"
                          useFlexGap
                        >
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ width: 14, flexShrink: 0 }}
                          >
                            {ch.label}
                          </Typography>
                          {vs.map((v) => (
                            <UserLink
                              key={v.userId}
                              username={v.username}
                              name={v.name}
                              avatarUrl={v.avatarUrl}
                              withAvatar
                              avatarSize={18}
                              sx={{ fontSize: 12 }}
                            />
                          ))}
                        </Stack>
                      );
                    })}
                  </Stack>
                )}
              </Box>
              );
            })}
          </Stack>
        )}

        {!me && !finalized && (
          <Alert
            severity="info"
            sx={{ mt: 2 }}
            action={
              <Button
                color="inherit"
                size="small"
                component={RouterLink}
                to={`/login?next=/events/${eventId}`}
              >
                ログインして回答
              </Button>
            }
          >
            候補日への回答にはログインが必要です。ログイン後この画面に戻ります。
          </Alert>
        )}

        {anonymous && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mt: 1 }}
          >
            回答は匿名です（人数のみ表示）。
          </Typography>
        )}

        {isStaff && finalized && (
          <>
            <Divider sx={{ my: 2 }} />
            <FormControlLabel
              control={
                <Switch
                  checked={visible}
                  disabled={updateEvent.isPending}
                  onChange={(e) =>
                    updateEvent.mutate({ scheduleVisible: e.target.checked })
                  }
                />
              }
              label="日程調整の結果をみんなに表示する（回答してくれた人の一覧など）"
            />
          </>
        )}

        {isStaff && !finalized && (
          <>
            <Divider sx={{ my: 2 }} />
            <FormControlLabel
              control={
                <Switch
                  checked={anonymous}
                  disabled={updateEvent.isPending}
                  onChange={(e) =>
                    updateEvent.mutate(
                      { scheduleAnonymous: e.target.checked },
                      {
                        onSuccess: () =>
                          qc.invalidateQueries({
                            queryKey: ["eventSchedule", eventId],
                          }),
                      },
                    )
                  }
                />
              }
              label="回答者を匿名にする（誰がどれを選んだか表示しない）"
            />
            <Typography variant="subtitle2" gutterBottom sx={{ mt: 1 }}>
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
