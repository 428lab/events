import { Box, Chip, SvgIcon, type SvgIconProps } from "@mui/material";
import GitHubIcon from "@mui/icons-material/GitHub";
import XIcon from "@mui/icons-material/X";
import { useTranslation } from "react-i18next";
import type { ProfileLink } from "@eventer/shared";
import { providerLabel } from "../lib/providers.js";

/** Bluesky の蝶（MUI のアイコンに無いので最小のパスで描く） */
function BlueskyIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props} viewBox="0 0 24 24">
      <path d="M5.2 3.6C7.6 5.4 10.2 9 11.2 11.1c.3.6.5 1 .8 1.4.3-.4.5-.8.8-1.4 1-2.1 3.6-5.7 6-7.5C20.6 2.3 23.3 1.4 23.3 4.4c0 .6-.4 5-.6 5.7-.7 2.5-3.3 3.2-5.6 2.8 4 .7 5 2.9 2.8 5.2-4.2 4.3-6-1.1-6.5-2.5l-.2-.6-.2.6c-.5 1.4-2.3 6.8-6.5 2.5-2.2-2.3-1.2-4.5 2.8-5.2-2.3.4-4.9-.3-5.6-2.8-.2-.7-.6-5.1-.6-5.7 0-3 2.7-2.1 4.4-.8z" />
    </SvgIcon>
  );
}

/** Nostr（紫の丸に N。公式の単一ロゴが無いので文字で表す） */
function NostrIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props} viewBox="0 0 24 24">
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-3.5 5h1.9l3.9 6.1V7h1.9v10h-1.9l-3.9-6.1V17H8.5z" />
    </SvgIcon>
  );
}

const ICONS: Record<ProfileLink["provider"], typeof GitHubIcon | typeof BlueskyIcon> = {
  github: GitHubIcon,
  x: XIcon,
  bluesky: BlueskyIcon,
  nostr: NostrIcon,
};

/** 公開プロフィールの「連携しているアカウント」(docs/profile-social-links.md)。
 * 本人がオンにした連携だけがサーバーから届く。外部サイトなので新しいタブで開き、
 * rel="me" で「この人のアカウント」であることを示す（相手側の相互リンク確認に使える） */
export function ProfileLinks({ links }: { links: ProfileLink[] }) {
  const { t } = useTranslation();
  if (links.length === 0) return null;
  return (
    <Box
      component="nav"
      aria-label={t("profile.linksLabel")}
      sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}
    >
      {links.map((l) => {
        const Icon = ICONS[l.provider];
        return (
          <Chip
            key={l.provider}
            component="a"
            href={l.url}
            target="_blank"
            rel="me noopener noreferrer"
            clickable
            variant="outlined"
            icon={<Icon fontSize="small" />}
            label={l.label}
            aria-label={t("profile.linkTo", { provider: providerLabel(l.provider), label: l.label })}
            sx={{ maxWidth: "100%" }}
          />
        );
      })}
    </Box>
  );
}
