import { Alert, Avatar, Box, Stack, Typography } from "@mui/material";
import { useParams } from "react-router-dom";
import { useUserProfile } from "../api/userHooks.js";
import { EventCard } from "../components/EventCard.js";

export function UserProfilePage() {
  const { id = "" } = useParams();
  const { data, isLoading, isError } = useUserProfile(id);

  if (isError) return <Alert severity="info">ユーザーが見つかりません。</Alert>;
  if (isLoading || !data) return <Typography>読み込み中…</Typography>;

  const joined = new Date(data.createdAt).toLocaleDateString("ja-JP");

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={2} alignItems="center">
        <Avatar
          src={data.avatarUrl ?? undefined}
          sx={{ width: 64, height: 64, fontSize: 28 }}
        >
          {data.name.charAt(0)}
        </Avatar>
        <Box>
          <Typography variant="h5" fontWeight={700}>
            {data.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {joined} に登録
          </Typography>
        </Box>
      </Stack>

      <Box>
        <Typography variant="h6" gutterBottom>
          参加・主催したイベント
        </Typography>
        {data.events.length === 0 ? (
          <Typography color="text.secondary">
            公開イベントの実績はまだありません。
          </Typography>
        ) : (
          <Stack spacing={1.5}>
            {data.events.map((e) => (
              <EventCard key={e.id} event={e} role={e.myRole} />
            ))}
          </Stack>
        )}
      </Box>
    </Stack>
  );
}
