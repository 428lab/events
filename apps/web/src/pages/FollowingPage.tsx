import {
  Avatar,
  Box,
  Button,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
        {t("profile.following")}
      </Button>
    </Stack>
  );
}

/** フォロー中の一覧（本人のみ）。X と同様に行リストで表示。 */
export function FollowingPage() {
  const { t } = useTranslation();
  const { data: following, isLoading } = useMyFollowing();

  return (
    <Box sx={{ maxWidth: 600 }}>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        {following
          ? t("profile.followingHeading", { n: following.length })
          : t("profile.following")}
      </Typography>
      {isLoading ? (
        <Typography>{t("common.loading")}</Typography>
      ) : !following || following.length === 0 ? (
        <Typography color="text.secondary">
          {t("profile.noFollowing")}
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
