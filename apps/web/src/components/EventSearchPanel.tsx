import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Collapse,
  MenuItem,
  Pagination,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import { useEventSearch, type EventSearchParams } from "../api/hooks.js";
import { useCommunities } from "../api/communityHooks.js";
import { EventCard } from "./EventCard.js";

const dayStart = (d: string) =>
  d ? new Date(`${d}T00:00:00`).getTime() : undefined;
const dayEnd = (d: string) =>
  d ? new Date(`${d}T23:59:59.999`).getTime() : undefined;

/** イベントの検索/絞り込みバー。条件未指定時は children（既定の一覧）を表示。 */
export function EventSearchPanel({ children }: { children: ReactNode }) {
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [communityId, setCommunityId] = useState("");
  const [sort, setSort] = useState<"soon" | "recent" | "new">("soon");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const { data: communities } = useCommunities();

  const hasFilters = Boolean(
    q.trim() || from || to || communityId || sort !== "soon",
  );

  const params = useMemo<EventSearchParams>(
    () => ({
      q: q.trim() || undefined,
      from: dayStart(from),
      to: dayEnd(to),
      communityId: communityId || undefined,
      sort,
      page,
    }),
    [q, from, to, communityId, sort, page],
  );
  const search = useEventSearch(params, hasFilters);

  const change = (fn: () => void) => {
    setPage(1);
    fn();
  };
  const clear = () => {
    setQ("");
    setFrom("");
    setTo("");
    setCommunityId("");
    setSort("soon");
    setPage(1);
  };

  const pageCount = search.data
    ? Math.max(1, Math.ceil(search.data.total / (search.data.limit || 12)))
    : 1;

  return (
    <Stack spacing={3}>
      <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
        <Button
          size="small"
          color="inherit"
          startIcon={<SearchIcon />}
          onClick={() => setOpen((o) => !o)}
          sx={{ opacity: 0.85 }}
        >
          検索・絞り込み
        </Button>
      </Box>

      <Collapse in={open} unmountOnExit>
      <Card variant="outlined">
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
            </Stack>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                select
                label="コミュニティ"
                value={communityId}
                onChange={(e) => change(() => setCommunityId(e.target.value))}
                size="small"
                fullWidth
              >
                <MenuItem value="">すべて</MenuItem>
                {(communities ?? []).map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="並び替え"
                value={sort}
                onChange={(e) =>
                  change(() =>
                    setSort(e.target.value as "soon" | "recent" | "new"),
                  )
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

      {hasFilters ? (
        <Box>
          <Typography variant="h5" fontWeight={700} gutterBottom>
            検索結果（{search.data?.total ?? 0}件）
          </Typography>
          {search.isLoading || !search.data ? (
            <Typography>読み込み中…</Typography>
          ) : search.data.events.length === 0 ? (
            <Typography color="text.secondary">
              条件に合うイベントはありません。
            </Typography>
          ) : (
            <>
              <Stack spacing={2}>
                {search.data.events.map((e) => (
                  <EventCard key={e.id} event={e} />
                ))}
              </Stack>
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
      ) : (
        children
      )}
    </Stack>
  );
}
