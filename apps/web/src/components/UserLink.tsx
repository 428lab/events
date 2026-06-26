import { Avatar, Box } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";

/** ユーザー名（任意でアイコン付き）を公開プロフィール /users/:username へリンク表示。
 * username が無い（チーム等で特定できない）場合はリンクせずテキスト表示。 */
export function UserLink({
  username,
  name,
  avatarUrl,
  withAvatar = false,
  avatarSize = 24,
  sx,
}: {
  username?: string | null;
  name: string;
  avatarUrl?: string | null;
  withAvatar?: boolean;
  avatarSize?: number;
  sx?: SxProps<Theme>;
}) {
  const avatar = withAvatar ? (
    <Avatar
      src={avatarUrl ?? undefined}
      sx={{ width: avatarSize, height: avatarSize }}
    >
      {name.charAt(0)}
    </Avatar>
  ) : null;

  const base = {
    display: "inline-flex",
    alignItems: "center",
    gap: 0.75,
    minWidth: 0,
  } as const;

  if (!username) {
    return (
      <Box sx={{ ...base, ...sx } as SxProps<Theme>}>
        {avatar}
        <span>{name}</span>
      </Box>
    );
  }
  return (
    <Box
      component={RouterLink}
      to={`/users/${username}`}
      sx={
        {
          ...base,
          color: "inherit",
          textDecoration: "none",
          "&:hover .ul-name": { textDecoration: "underline" },
          ...sx,
        } as SxProps<Theme>
      }
    >
      {avatar}
      <span className="ul-name">{name}</span>
    </Box>
  );
}
