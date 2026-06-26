import { Box, Stack, Typography } from "@mui/material";
import { useMyPage } from "../api/hooks.js";
import { EventCard } from "../components/EventCard.js";
import { UsernameCard } from "../components/UsernameCard.js";

export function MyPage() {
  const { data, isLoading } = useMyPage();
  if (isLoading || !data) return <Typography>読み込み中…</Typography>;

  return (
    <Stack spacing={4}>
      <UsernameCard />
      <Box>
        <Typography variant="h5" gutterBottom fontWeight={700}>
          開催中・予定のイベント
        </Typography>
        {data.ongoing.length === 0 ? (
          <Typography color="text.secondary">参加中のイベントはありません</Typography>
        ) : (
          <Stack spacing={2}>
            {data.ongoing.map((e) => (
              <EventCard key={e.id} event={e} role={e.myRole} />
            ))}
          </Stack>
        )}
      </Box>
      <Box>
        <Typography variant="h5" gutterBottom fontWeight={700}>
          過去に参加したイベント
        </Typography>
        {data.past.length === 0 ? (
          <Typography color="text.secondary">まだありません</Typography>
        ) : (
          <Stack spacing={2}>
            {data.past.map((e) => (
              <EventCard key={e.id} event={e} role={e.myRole} />
            ))}
          </Stack>
        )}
      </Box>
    </Stack>
  );
}
