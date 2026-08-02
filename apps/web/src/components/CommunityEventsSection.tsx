import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Collapse,
  MenuItem,
  Pagination,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import { useEventSearch, type EventSearchParams } from "../api/hooks.js";
import { EventList, ListColumnsToggle } from "./EventList.js";

/** コミュニティページの1ページ表示件数 */
const PAGE_SIZE = 10;

const dayStart = (d: string) =>
  d ? new Date(`${d}T00:00:00`).getTime() : undefined;
const dayEnd = (d: string) =>
  d ? new Date(`${d}T23:59:59.999`).getTime() : undefined;

type EventsTab = "upcoming" | "past";
type EventSort = "soon" | "recent" | "new";

/** タブごとの既定の並び順（開催予定=近い順 / 過去=新しい順） */
const DEFAULT_SORT: Record<EventsTab, EventSort> = {
  upcoming: "soon",
  past: "recent",
};

/**
 * コミュニティ詳細のイベント一覧。
 * 検索API（communityId 固定）ベースで、開催予定/過去タブ・
 * 絞り込み（キーワード・期間・並び替え）・10件ページングを提供する。
 */
export function CommunityEventsSection({
  communityId,
}: {
  communityId: string;
}) {
  const [tab, setTab] = useState<EventsTab>("upcoming");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<EventSort>(DEFAULT_SORT.upcoming);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  // 「現在」はマウント時に固定（クエリキーを安定させ再取得ループを防ぐ）

  const hasFilters = Boolean(
    q.trim() || from || to || sort !== DEFAULT_SORT[tab],
  );

  const params = useMemo<EventSearchParams>(
    () => ({
      q: q.trim() || undefined,
      // タブが期間の既定値を与える（開催予定: 終了が今以降 / 過去: 開始が今以前）。
      // ユーザーが期間を指定した場合はそちらを優先する。
      // タブは phase で厳密に判定（開催中は upcoming のみ・調整中は upcoming・過去は終了済みのみ）。
      // 期間フィルタはユーザー指定時のみ AND 合成
      phase: tab,
      from: dayStart(from),
      to: dayEnd(to),
      communityId,
      sort,
      page,
      limit: PAGE_SIZE,
    }),
    [tab, q, from, to, communityId, sort, page],
  );
  const search = useEventSearch(params, true);

  const change = (fn: () => void) => {
    setPage(1);
    fn();
  };
  const changeTab = (t: EventsTab) => {
    setTab(t);
    setSort(DEFAULT_SORT[t]);
    setPage(1);
  };
  const clear = () => {
    setQ("");
    setFrom("");
    setTo("");
    setSort(DEFAULT_SORT[tab]);
    setPage(1);
  };

  const total = search.data?.total ?? 0;
  const pageCount = search.data
    ? Math.max(1, Math.ceil(total / (search.data.limit || PAGE_SIZE)))
    : 1;

  const emptyText = hasFilters
    ? "条件に合うイベントはありません。"
    : tab === "upcoming"
      ? "予定されているイベントはありません。"
      : "過去のイベントはありません。";

  return (
    <Box>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1}
        sx={{ mb: 1 }}
      >
        <Typography variant="h6">イベント</Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <Button
            size="small"
            color="inherit"
            startIcon={<SearchIcon />}
            onClick={() => setOpen((o) => !o)}
            sx={{ opacity: 0.85 }}
          >
            絞り込み
          </Button>
          <ListColumnsToggle />
        </Stack>
      </Stack>

      <Tabs
        value={tab}
        onChange={(_e, v: EventsTab) => changeTab(v)}
        sx={{ mb: 2, borderBottom: 1, borderColor: "divider", minHeight: 40 }}
      >
        <Tab label="開催予定" value="upcoming" sx={{ minHeight: 40 }} />
        <Tab label="過去" value="past" sx={{ minHeight: 40 }} />
      </Tabs>

      <Collapse in={open} unmountOnExit>
        <Card variant="outlined" sx={{ mb: 2 }}>
          <CardContent>
            <Stack spacing={2}>
              <TextField
                label="キーワード"
                slotProps={{ inputLabel: { shrink: true } }}
                value={q}
                onChange={(e) => change(() => setQ(e.target.value))}
                placeholder="イベント名・内容で検索"
                fullWidth
                size="small"
              />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField
                  label="開始日（以降）"
                  type="date"
                  value={from}
                  onChange={(e) => change(() => setFrom(e.target.value))}
                  InputLabelProps={{ shrink: true }}
                  size="small"
                  fullWidth
                />
                <TextField
                  label="終了日（まで）"
                  type="date"
                  value={to}
                  onChange={(e) => change(() => setTo(e.target.value))}
                  InputLabelProps={{ shrink: true }}
                  size="small"
                  fullWidth
                />
                <TextField
                  select
                  label="並び替え"
                  value={sort}
                  onChange={(e) =>
                    change(() => setSort(e.target.value as EventSort))
                  }
                  size="small"
                  fullWidth
                >
                  <MenuItem value="soon">開催日が近い順</MenuItem>
                  <MenuItem value="recent">開催日が新しい順</MenuItem>
                  <MenuItem value="new">登録が新しい順</MenuItem>
                </TextField>
              </Stack>
              {hasFilters && (
                <Box>
                  <Button size="small" onClick={clear}>
                    条件をクリア
                  </Button>
                </Box>
              )}
            </Stack>
          </CardContent>
        </Card>
      </Collapse>

      {search.isError ? (
        <Alert severity="error">イベントを読み込めませんでした。再読み込みしてください。</Alert>
      ) : search.isLoading || !search.data ? (
        <Typography>読み込み中…</Typography>
      ) : search.data.events.length === 0 ? (
        <Typography color="text.secondary">{emptyText}</Typography>
      ) : (
        <>
          {hasFilters && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mb: 1 }}
            >
              条件に一致: {total}件
            </Typography>
          )}
          <EventList events={search.data.events} />
          {pageCount > 1 && (
            <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
              <Pagination
                count={pageCount}
                page={page}
                onChange={(_e, p) => setPage(p)}
                color="primary"
              />
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
