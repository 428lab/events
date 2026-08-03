import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Collapse,
  IconButton,
  MenuItem,
  Pagination,
  Tooltip,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import { useEventSearch, type EventSearchParams } from "../api/hooks.js";
import { useCommunities } from "../api/communityHooks.js";
import { EventList, ListColumnsToggle } from "./EventList.js";

/** 一覧の1ページ表示件数 */
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

/** コミュニティ絞り込みセレクト。表示されたときだけ一覧を取得する */
function CommunityFilterField({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const { data: communities } = useCommunities();
  return (
    <TextField
      select
      label="コミュニティ"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      size="small"
      fullWidth
      sx={{ maxWidth: { sm: 320 } }}
    >
      <MenuItem value="">すべて</MenuItem>
      {(communities ?? []).map((c) => (
        <MenuItem key={c.id} value={c.id}>
          {c.name}
        </MenuItem>
      ))}
    </TextField>
  );
}

/**
 * イベント一覧ブラウザ（サイト共通）。
 * 検索APIベースで、開催予定/過去タブ・絞り込み（キーワード・期間・
 * コミュニティ・並び替え）・10件ページング・列切替を提供する。
 * communityId を渡すとそのコミュニティのイベントに固定される
 * （コミュニティ選択の絞り込みは非表示）。
 */
export function EventsBrowser({
  communityId,
  title = "イベント",
  actions,
}: {
  /** 指定時はそのコミュニティのイベントに固定 */
  communityId?: string;
  /** 見出し（既定: イベント） */
  title?: string;
  /** 見出し行の右端に置く追加アクション（作成ボタン等） */
  actions?: ReactNode;
}) {
  const [tab, setTab] = useState<EventsTab>("upcoming");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [communityFilter, setCommunityFilter] = useState("");
  const [sort, setSort] = useState<EventSort>(DEFAULT_SORT.upcoming);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);

  const hasFilters = Boolean(
    q.trim() ||
      from ||
      to ||
      (!communityId && communityFilter) ||
      sort !== DEFAULT_SORT[tab],
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
      communityId: communityId ?? (communityFilter || undefined),
      sort,
      page,
      limit: PAGE_SIZE,
    }),
    [tab, q, from, to, communityId, communityFilter, sort, page],
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
    setCommunityFilter("");
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
      {/* 狭い画面ではボタン群ごと折り返す（縮小でボタン文字が縦書きに潰れないように） */}
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1}
        flexWrap="wrap"
        useFlexGap
        sx={{ mb: 1 }}
      >
        <Typography variant="h6" sx={{ whiteSpace: "nowrap" }}>
          {title}
        </Typography>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{ flexShrink: 0, "& .MuiButton-root": { whiteSpace: "nowrap" } }}
        >
          {/* モバイルはアイコンのみ、sm以上は文字付き */}
          <Button
            size="small"
            color="inherit"
            startIcon={<SearchIcon />}
            onClick={() => setOpen((o) => !o)}
            sx={{ opacity: 0.85, display: { xs: "none", sm: "inline-flex" } }}
          >
            絞り込み
          </Button>
          <Tooltip title="絞り込み">
            <IconButton
              size="small"
              onClick={() => setOpen((o) => !o)}
              aria-label="絞り込み"
              sx={{ display: { xs: "inline-flex", sm: "none" }, opacity: 0.85 }}
            >
              <SearchIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <ListColumnsToggle />
          {actions}
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
              {!communityId && (
                <CommunityFilterField
                  value={communityFilter}
                  onChange={(id) => change(() => setCommunityFilter(id))}
                />
              )}
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
