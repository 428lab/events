import { Avatar, Box, Chip, Stack, Typography } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import type { MyEventSummary } from "@eventer/shared";
import { useMyPage } from "../api/hooks.js";
import { useMyJoinedCommunities } from "../api/communityHooks.js";
import { EventCard } from "../components/EventCard.js";

const COMMUNITY_ROLE_LABEL: Record<string, string> = {
  owner: "オーナー",
  admin: "管理者",
};

function Section({
  title,
  events,
  emptyText,
}: {
  title: string;
  events: MyEventSummary[];
  emptyText?: string;
}) {
  if (events.length === 0 && !emptyText) return null;
  return (
    <Box>
      <Typography variant="h5" gutterBottom fontWeight={700}>
        {title}
        {events.length > 0 && `（${events.length}）`}
      </Typography>
      {events.length === 0 ? (
        <Typography color="text.secondary">{emptyText}</Typography>
      ) : (
        <Stack spacing={2}>
          {events.map((e) => (
            <EventCard key={e.id} event={e} role={e.myRole} />
          ))}
        </Stack>
      )}
    </Box>
  );
}

export function MyPage() {
  const { data, isLoading } = useMyPage();
  const { data: communities } = useMyJoinedCommunities();
  if (isLoading || !data) return <Typography>読み込み中…</Typography>;

  const pastHosted = data.past.filter((e) => e.myRole === "staff");
  const pastJoined = data.past.filter((e) => e.myRole !== "staff");

  return (
    <Stack spacing={4}>
      {communities && communities.length > 0 && (
        <Box>
          <Typography variant="h5" gutterBottom fontWeight={700}>
            所属コミュニティ
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {communities.map((com) => (
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
      <Section
        title="開催中・開催予定のイベント"
        events={data.ongoing}
        emptyText="参加中のイベントはありません"
      />
      <Section title="主催したイベント" events={pastHosted} />
      <Section
        title="過去に参加したイベント"
        events={pastJoined}
        emptyText={pastHosted.length === 0 ? "まだありません" : undefined}
      />
    </Stack>
  );
}
