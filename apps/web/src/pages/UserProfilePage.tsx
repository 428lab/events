import { Alert, Avatar, Box, Chip, Stack, Typography } from "@mui/material";
import { Link as RouterLink, useParams } from "react-router-dom";
import type { UserProfile } from "@eventer/shared";
import { useUserProfile } from "../api/userHooks.js";
import { EventCard } from "../components/EventCard.js";

const COMMUNITY_ROLE_LABEL: Record<string, string> = {
  owner: "オーナー",
  admin: "管理者",
};

export function UserProfilePage() {
  const { id = "" } = useParams();
  const { data, isLoading, isError } = useUserProfile(id);

  if (isError) return <Alert severity="info">ユーザーが見つかりません。</Alert>;
  if (isLoading || !data) return <Typography>読み込み中…</Typography>;

  const joined = new Date(data.createdAt).toLocaleDateString("ja-JP");
  const hosted = data.events.filter((e) => e.myRole === "staff");
  const joinedEvents = data.events.filter((e) => e.myRole !== "staff");

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

      {data.communities.length > 0 && (
        <Box>
          <Typography variant="h6" gutterBottom>
            所属コミュニティ
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {data.communities.map((com) => (
              <Chip
                key={com.id}
                component={RouterLink}
                to={`/c/${com.slug}`}
                clickable
                avatar={
                  <Avatar src={com.iconUrl ?? undefined} variant="rounded">
                    {com.name.charAt(0)}
                  </Avatar>
                }
                label={
                  COMMUNITY_ROLE_LABEL[com.role]
                    ? `${com.name}・${COMMUNITY_ROLE_LABEL[com.role]}`
                    : com.name
                }
              />
            ))}
          </Stack>
        </Box>
      )}

      {data.events.length === 0 ? (
        <Typography color="text.secondary">
          公開イベントの実績はまだありません。
        </Typography>
      ) : (
        <>
          <Section title="主催・運営したイベント" events={hosted} />
          <Section title="参加したイベント" events={joinedEvents} />
        </>
      )}
    </Stack>
  );
}

function Section({
  title,
  events,
}: {
  title: string;
  events: UserProfile["events"];
}) {
  if (events.length === 0) return null;
  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        {title}（{events.length}）
      </Typography>
      <Stack spacing={1.5}>
        {events.map((e) => (
          <EventCard key={e.id} event={e} role={e.myRole} />
        ))}
      </Stack>
    </Box>
  );
}
