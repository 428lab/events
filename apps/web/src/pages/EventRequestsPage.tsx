import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  InputAdornment,
  Link,
  Pagination,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EggIcon from "@mui/icons-material/Egg";
import RssFeedIcon from "@mui/icons-material/RssFeed";
import SearchIcon from "@mui/icons-material/Search";
import { Link as RouterLink } from "react-router-dom";
import { useMe } from "../api/hooks.js";
import { usePublicEventRequests } from "../api/requestHooks.js";
import { RequestCard } from "../components/RequestCard.js";
import { EggTabs } from "../components/EggTabs.js";

/** イベントのたまご一覧（あったらいいな）。 */
export function EventRequestsPage() {
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [sort, setSort] = useState<"new" | "popular">("new");
  // 入力から少し待って検索（タイプ毎のリクエストを抑える）
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(keyword.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [keyword]);

  const { data: me } = useMe();
  const q = usePublicEventRequests(page, { q: debouncedQ || undefined, sort });
  const requests = q.data?.requests ?? [];
  const total = q.data?.total ?? 0;
  const limit = q.data?.limit ?? 20;
  const pageCount = Math.max(1, Math.ceil(total / limit));

  return (
    <Box>
      <EggTabs value="requests" />
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography
            variant="h5"
            fontWeight={700}
            sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
          >
            <EggIcon fontSize="medium" />
            イベントのたまご
          </Typography>
          <Typography variant="body2" color="text.secondary">
            「こんなイベントがあったらいいな」を投稿して、賛同を集めよう。誰かが「開催します」したらイベントに孵ります
          </Typography>
        </Box>
        {me && (
          <Button
            component={RouterLink}
            to="/requests/new"
            variant="contained"
            startIcon={<AddIcon />}
            sx={{ flexShrink: 0 }}
          >
            投稿
          </Button>
        )}
      </Stack>

      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        sx={{ mb: 2 }}
        alignItems={{ xs: "stretch", sm: "center" }}
      >
        <TextField
          size="small"
          placeholder="キーワードで検索（タイトル・説明）"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          fullWidth
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
        <ToggleButtonGroup
          exclusive
          size="small"
          value={sort}
          onChange={(_e, v: "new" | "popular" | null) => {
            if (v) {
              setSort(v);
              setPage(1);
            }
          }}
          sx={{ flexShrink: 0 }}
        >
          <ToggleButton value="new">新着順</ToggleButton>
          <ToggleButton value="popular">人気順</ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {q.isError ? (
        <Alert severity="error">読み込めませんでした。再読み込みしてください。</Alert>
      ) : q.isLoading ? (
        <Typography>読み込み中…</Typography>
      ) : requests.length === 0 ? (
        <Typography color="text.secondary">
          {debouncedQ
            ? "条件に合うたまごが見つかりませんでした。"
            : "まだたまごはありません。最初の「あったらいいな」を投稿してみましょう。"}
        </Typography>
      ) : (
        <Stack spacing={2}>
          {requests.map((r) => (
            <RequestCard key={r.id} request={r} />
          ))}
        </Stack>
      )}
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

      {/* フィード購読導線（/feed/* はワーカー直配信なので通常の <a>） */}
      <Stack
        direction="row"
        spacing={1.5}
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
        sx={{ mt: 4, pt: 3, borderTop: 1, borderColor: "divider" }}
      >
        <RssFeedIcon fontSize="small" sx={{ color: "text.secondary" }} />
        <Typography variant="body2" color="text.secondary">
          たまごをフィードで購読:
        </Typography>
        <Link href="/feed/requests.rss" target="_blank" rel="noopener" variant="body2">
          RSS
        </Link>
        <Link href="/feed/requests.json" target="_blank" rel="noopener" variant="body2">
          JSON Feed
        </Link>
      </Stack>
    </Box>
  );
}
