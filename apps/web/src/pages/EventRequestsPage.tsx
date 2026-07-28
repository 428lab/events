import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Pagination,
  Stack,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { Link as RouterLink } from "react-router-dom";
import { useMe } from "../api/hooks.js";
import { usePublicEventRequests } from "../api/requestHooks.js";
import { RequestCard } from "../components/RequestCard.js";
import { EggTabs } from "../components/EggTabs.js";

/** イベントのたまご一覧（あったらいいな）。 */
export function EventRequestsPage() {
  const [page, setPage] = useState(1);
  const { data: me } = useMe();
  const q = usePublicEventRequests(page);
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
          <Typography variant="h5" fontWeight={700}>
            🥚 イベントのたまご
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

      {q.isError ? (
        <Alert severity="error">読み込めませんでした。再読み込みしてください。</Alert>
      ) : q.isLoading ? (
        <Typography>読み込み中…</Typography>
      ) : requests.length === 0 ? (
        <Typography color="text.secondary">
          まだたまごはありません。最初の「あったらいいな」を投稿してみましょう。
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
    </Box>
  );
}
