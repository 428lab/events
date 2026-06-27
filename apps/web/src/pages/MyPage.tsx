import { Box, Stack, Typography } from "@mui/material";
import type { MyEventSummary } from "@eventer/shared";
import { useMyPage } from "../api/hooks.js";
import { EventCard } from "../components/EventCard.js";

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
  if (isLoading || !data) return <Typography>読み込み中…</Typography>;

  const pastHosted = data.past.filter((e) => e.myRole === "staff");
  const pastJoined = data.past.filter((e) => e.myRole !== "staff");

  return (
    <Stack spacing={4}>
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
