import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  Chip,
  Pagination,
  Stack,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import PlaceIcon from "@mui/icons-material/Place";
import GroupsIcon from "@mui/icons-material/Groups";
import { Link as RouterLink } from "react-router-dom";
import type { Venue } from "@eventer/shared";
import { useMe } from "../api/hooks.js";
import {
  usePublicVenues,
  useVenueWanted,
  venueImageUrl,
} from "../api/venueHooks.js";
import { EventCard } from "../components/EventCard.js";
import { RequestCard } from "../components/RequestCard.js";

function VenueCard({ venue }: { venue: Venue }) {
  const img = venueImageUrl(venue);
  return (
    <Card>
      <CardActionArea
        component={RouterLink}
        to={`/venues/${venue.id}`}
        sx={{ display: "flex", alignItems: "stretch", justifyContent: "flex-start" }}
      >
        <Box
          sx={{
            flexShrink: 0,
            width: 140,
            minHeight: 100,
            bgcolor: "action.hover",
            ...(img
              ? {
                  backgroundImage: `url(${img})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }
              : {
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 36,
                }),
          }}
        >
          {!img && "🏟️"}
        </Box>
        <Box sx={{ p: 2, minWidth: 0 }}>
          <Typography fontWeight={700} sx={{ wordBreak: "break-word" }}>
            {venue.name}
          </Typography>
          <Stack direction="row" spacing={1.5} sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap>
            <Stack direction="row" spacing={0.5} alignItems="center">
              <PlaceIcon sx={{ fontSize: 16, color: "text.secondary" }} />
              <Typography variant="body2" color="text.secondary">
                {venue.area}
              </Typography>
            </Stack>
            {venue.capacity != null && (
              <Stack direction="row" spacing={0.5} alignItems="center">
                <GroupsIcon sx={{ fontSize: 16, color: "text.secondary" }} />
                <Typography variant="body2" color="text.secondary">
                  〜{venue.capacity}人
                </Typography>
              </Stack>
            )}
            {venue.status === "closed" && (
              <Chip size="small" label="受付停止中" />
            )}
          </Stack>
          {venue.description && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                mt: 0.5,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {venue.description}
            </Typography>
          )}
        </Box>
      </CardActionArea>
    </Card>
  );
}

/** 会場一覧（提供受付中・未ログイン可）。 */
export function VenuesPage() {
  const [page, setPage] = useState(1);
  const { data: me } = useMe();
  const q = usePublicVenues(page);
  const venues = q.data?.venues ?? [];
  const total = q.data?.total ?? 0;
  const limit = q.data?.limit ?? 20;
  const pageCount = Math.max(1, Math.ceil(total / limit));

  return (
    <Box>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="h5" fontWeight={700}>
            🏟️ 会場
          </Typography>
          <Typography variant="body2" color="text.secondary">
            イベントに使える会場。会場を持っている人は登録して主催者とつながれます
          </Typography>
        </Box>
        {me && (
          <Button
            component={RouterLink}
            to="/venues/new"
            variant="contained"
            startIcon={<AddIcon />}
            sx={{ flexShrink: 0 }}
          >
            会場を登録
          </Button>
        )}
      </Stack>

      {q.isError ? (
        <Alert severity="error">読み込めませんでした。再読み込みしてください。</Alert>
      ) : q.isLoading ? (
        <Typography>読み込み中…</Typography>
      ) : venues.length === 0 ? (
        <Typography color="text.secondary">
          まだ会場はありません。最初の会場を登録してみましょう。
        </Typography>
      ) : (
        <Stack spacing={2}>
          {venues.map((v) => (
            <VenueCard key={v.id} venue={v} />
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

      <WantedSection />
    </Box>
  );
}

/** 会場を探しているイベント・たまご（会場オーナー向けの募集一覧） */
function WantedSection() {
  const { data } = useVenueWanted();
  const events = data?.events ?? [];
  const requests = data?.requests ?? [];
  if (events.length === 0 && requests.length === 0) return null;
  return (
    <Box sx={{ mt: 5 }}>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        🔍 会場を探しています
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        会場を提供できる場合は、各ページの「会場を提供できます」からオファーを送れます
      </Typography>
      <Stack spacing={2}>
        {events.map((e) => (
          <EventCard key={e.id} event={e} />
        ))}
        {requests.map((r) => (
          <RequestCard key={r.id} request={r} />
        ))}
      </Stack>
    </Box>
  );
}
