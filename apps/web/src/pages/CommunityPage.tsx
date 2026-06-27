import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import { useParams } from "react-router-dom";
import { useMe } from "../api/hooks.js";
import {
  useCommunity,
  useCommunityMembers,
  useJoinCommunity,
  useLeaveCommunity,
} from "../api/communityHooks.js";
import { EventCard } from "../components/EventCard.js";
import { UserLink } from "../components/UserLink.js";
import { Markdown } from "../components/Markdown.js";

export function CommunityPage() {
  const { slug = "" } = useParams();
  const { data: me } = useMe();
  const { data: c, isLoading, isError } = useCommunity(slug);
  const { data: members } = useCommunityMembers(slug);
  const join = useJoinCommunity(slug);
  const leave = useLeaveCommunity(slug);

  if (isError) return <Alert severity="info">コミュニティが見つかりません。</Alert>;
  if (isLoading || !c) return <Typography>読み込み中…</Typography>;

  return (
    <Stack spacing={3}>
      {/* ヘッダー */}
      <Stack direction="row" spacing={2} alignItems="center">
        <Avatar
          src={c.iconUrl ?? undefined}
          variant="rounded"
          sx={{ width: 72, height: 72, fontSize: 32 }}
        >
          {c.name.charAt(0)}
        </Avatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h5" fontWeight={700} noWrap>
            {c.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            @{c.slug} ・ メンバー {c.memberCount} ・ イベント {c.eventCount}
          </Typography>
        </Box>
        {me &&
          (c.isOwner ? (
            <Chip label="オーナー" color="secondary" size="small" />
          ) : c.isMember ? (
            <Button
              variant="outlined"
              disabled={leave.isPending}
              onClick={() => leave.mutate(c.id)}
            >
              フォロー中
            </Button>
          ) : (
            <Button
              variant="contained"
              disabled={join.isPending}
              onClick={() => join.mutate(c.id)}
            >
              フォロー
            </Button>
          ))}
      </Stack>

      {c.description && <Markdown>{c.description}</Markdown>}

      <Divider />

      {/* イベント */}
      <Box>
        <Typography variant="h6" gutterBottom>
          開催予定・開催中のイベント
        </Typography>
        {c.upcomingEvents.length === 0 ? (
          <Typography color="text.secondary">
            予定されているイベントはありません。
          </Typography>
        ) : (
          <Stack spacing={1.5}>
            {c.upcomingEvents.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </Stack>
        )}
      </Box>

      {c.pastEvents.length > 0 && (
        <Box>
          <Typography variant="h6" gutterBottom>
            過去のイベント
          </Typography>
          <Stack spacing={1.5}>
            {c.pastEvents.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </Stack>
        </Box>
      )}

      {/* メンバー */}
      {members && members.length > 0 && (
        <Box>
          <Typography variant="h6" gutterBottom>
            メンバー（{members.length}）
          </Typography>
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
            {members.map((m) => (
              <UserLink
                key={m.userId}
                username={m.username}
                name={m.name}
                avatarUrl={m.avatarUrl}
                withAvatar
                avatarSize={32}
              />
            ))}
          </Stack>
        </Box>
      )}
    </Stack>
  );
}
