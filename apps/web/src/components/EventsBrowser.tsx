import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
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
import { errorMessage } from "../lib/errorMessage.js";

/** 一覧の1ページ表示件数 */
const PAGE_SIZE = 10;

const dayStart = (d: string) =>
  d ? new Date(`${d}T00:00:00`).getTime() : undefined;
const dayEnd = (d: string) =>
  d ? new Date(`${d}T23:59:59.999`).getTime() : undefined;

type EventsTab = "upcoming" | "scheduling" | "past";
type EventSort = "soon" | "recent" | "new";

/** タブごとの既定の並び順（開催予定=近い順 / 調整中=登録が新しい順 / 過去=新しい順） */
const DEFAULT_SORT: Record<EventsTab, EventSort> = {
  upcoming: "soon",
  // 日程調整中は開催日が未定のため登録順 (#234)
  scheduling: "new",
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
  const { t } = useTranslation();
  const { data: communities } = useCommunities();
  return (
    <TextField
      select
      label={t("events.filterCommunity")}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      size="small"
      fullWidth
      sx={{ maxWidth: { sm: 320 } }}
    >
      <MenuItem value="">{t("events.filterCommunityAll")}</MenuItem>
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
 * 検索APIベースで、開催予定/日程調整中/過去タブ・絞り込み（キーワード・期間・
 * コミュニティ・並び替え）・10件ページング・列切替を提供する。
 * communityId を渡すとそのコミュニティのイベントに固定される
 * （コミュニティ選択の絞り込みは非表示）。
 */
export function EventsBrowser({
  communityId,
  title,
  actions,
}: {
  /** 指定時はそのコミュニティのイベントに固定 */
  communityId?: string;
  /** 見出し（既定: イベント） */
  title?: string;
  /** 見出し行の右端に置く追加アクション（作成ボタン等） */
  actions?: ReactNode;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<EventsTab>("upcoming");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [communityFilter, setCommunityFilter] = useState("");
  const [sort, setSort] = useState<EventSort>(DEFAULT_SORT.upcoming);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);

  // 日程調整中は開催日が未定（内部的に0）のため、日付フィルタと開催日ソートは
  // 意味を成さない (#234)。タブ中は適用せず、UIからも隠す
  const dateFilters = tab !== "scheduling";

  const hasFilters = Boolean(
    q.trim() ||
      (dateFilters && (from || to)) ||
      (!communityId && communityFilter) ||
      sort !== DEFAULT_SORT[tab],
  );

  const params = useMemo<EventSearchParams>(
    () => ({
      q: q.trim() || undefined,
      // タブは phase で厳密に判定（開催予定=日程確定のみ / 調整中=専用タブ #234 / 過去=終了済みのみ）。
      // 期間フィルタはユーザー指定時のみ AND 合成
      phase: tab,
      from: dateFilters ? dayStart(from) : undefined,
      to: dateFilters ? dayEnd(to) : undefined,
      communityId: communityId ?? (communityFilter || undefined),
      sort,
      page,
      limit: PAGE_SIZE,
    }),
    [tab, q, from, to, dateFilters, communityId, communityFilter, sort, page],
  );
  const search = useEventSearch(params, true);

  const change = (fn: () => void) => {
    setPage(1);
    fn();
  };
  const changeTab = (next: EventsTab) => {
    setTab(next);
    setSort(DEFAULT_SORT[next]);
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
    ? t("events.emptyFiltered")
    : tab === "upcoming"
      ? t("events.emptyUpcoming")
      : tab === "scheduling"
        ? t("events.emptyScheduling")
        : t("events.emptyPast");

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
          {title ?? t("events.title")}
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
            {t("events.filter")}
          </Button>
          <Tooltip title={t("events.filter")}>
            <IconButton
              size="small"
              onClick={() => setOpen((o) => !o)}
              aria-label={t("events.filter")}
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
        <Tab
          label={t("events.tabUpcoming")}
          value="upcoming"
          sx={{ minHeight: 40 }}
        />
        <Tab
          label={t("events.tabScheduling")}
          value="scheduling"
          sx={{ minHeight: 40 }}
        />
        <Tab label={t("events.tabPast")} value="past" sx={{ minHeight: 40 }} />
      </Tabs>

      <Collapse in={open} unmountOnExit>
        <Card variant="outlined" sx={{ mb: 2 }}>
          <CardContent>
            <Stack spacing={2}>
              <TextField
                label={t("events.filterKeyword")}
                slotProps={{ inputLabel: { shrink: true } }}
                value={q}
                onChange={(e) => change(() => setQ(e.target.value))}
                placeholder={t("events.filterKeywordPlaceholder")}
                fullWidth
                size="small"
              />
              {dateFilters && (
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField
                  label={t("events.filterFrom")}
                  type="date"
                  value={from}
                  onChange={(e) => change(() => setFrom(e.target.value))}
                  InputLabelProps={{ shrink: true }}
                  size="small"
                  fullWidth
                />
                <TextField
                  label={t("events.filterTo")}
                  type="date"
                  value={to}
                  onChange={(e) => change(() => setTo(e.target.value))}
                  InputLabelProps={{ shrink: true }}
                  size="small"
                  fullWidth
                />
                <TextField
                  select
                  label={t("events.sort")}
                  value={sort}
                  onChange={(e) =>
                    change(() => setSort(e.target.value as EventSort))
                  }
                  size="small"
                  fullWidth
                >
                  <MenuItem value="soon">{t("events.sortSoon")}</MenuItem>
                  <MenuItem value="recent">{t("events.sortRecent")}</MenuItem>
                  <MenuItem value="new">{t("events.sortNew")}</MenuItem>
                </TextField>
              </Stack>
              )}
              {!communityId && (
                <CommunityFilterField
                  value={communityFilter}
                  onChange={(id) => change(() => setCommunityFilter(id))}
                />
              )}
              {hasFilters && (
                <Box>
                  <Button size="small" onClick={clear}>
                    {t("events.clearFilters")}
                  </Button>
                </Box>
              )}
            </Stack>
          </CardContent>
        </Card>
      </Collapse>

      {search.isError ? (
        <Alert severity="error">
          {errorMessage(search.error, { default: t("events.loadError") })}
        </Alert>
      ) : search.isLoading || !search.data ? (
        <Typography>{t("common.loading")}</Typography>
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
              {t("events.matchCount", { n: total })}
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
