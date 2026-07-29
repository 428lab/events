import {
  Avatar,
  Box,
  Button,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { useMyFollowing, useSetFollow } from "../api/userHooks.js";

function FollowingRow({
  user,
}: {
  user: {
    id: string;
    username: string;
    globalName: string | null;
    avatarUrl: string | null;
  };
}) {
  const setFollow = useSetFollow(user.username);
  const name = user.globalName ?? user.username;
  return (
    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ py: 1 }}>
      <Avatar
        component={RouterLink}
        to={`/users/${user.username}`}
        src={user.avatarUrl ?? undefined}
        sx={{ width: 40, height: 40, textDecoration: "none" }}
      >
        {name.charAt(0)}
      </Avatar>
      <Box
        component={RouterLink}
        to={`/users/${user.username}`}
        sx={{
          flex: 1,
          minWidth: 0,
          color: "inherit",
          textDecoration: "none",
          "&:hover": { textDecoration: "underline" },
        }}
      >
        <Typography fontWeight={600} noWrap>
          {name}
        </Typography>
        <Typography variant="body2" color="text.secondary" noWrap>
          @{user.username}
        </Typography>
      </Box>
      <Button
        size="small"
        variant="outlined"
        disabled={setFollow.isPending}
        onClick={() => setFollow.mutate(false)}
        sx={{ flexShrink: 0 }}
      >
        フォロー中
      </Button>
    </Stack>
  );
}

/** フォロー中の一覧（本人のみ）。X と同様に行リストで表示。 */
export function FollowingPage() {
  const { data: following, isLoading } = useMyFollowing();

  return (
    <Box sx={{ maxWidth: 600 }}>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        フォロー中{following ? `（${following.length}）` : ""}
      </Typography>
      {isLoading ? (
        <Typography>読み込み中…</Typography>
      ) : !following || following.length === 0 ? (
        <Typography color="text.secondary">
          まだ誰もフォローしていません。気になる人のプロフィールからフォローしてみましょう。
        </Typography>
      ) : (
        <Stack divider={<Divider flexItem />}>
          {following.map((u) => (
            <FollowingRow key={u.id} user={u} />
          ))}
        </Stack>
      )}
    </Box>
  );
}
