import { Box, IconButton, SvgIcon, Tooltip, type SvgIconProps } from "@mui/material";
import GitHubIcon from "@mui/icons-material/GitHub";
import XIcon from "@mui/icons-material/X";
import { useTranslation } from "react-i18next";
import type { ProfileLink } from "@eventer/shared";
import { providerLabel } from "../lib/providers.js";

/** Bluesky の蝶。公式アプリのロゴマークのパスをそのまま使う（手描きだと形が崩れる）。
 * 出典: https://github.com/bluesky-social/social-app/blob/main/src/view/icons/Logomark.tsx
 * MIT, © Bluesky Social PBC。元の viewBox は 0 0 61 54 なので、上下に余白を足して正方形で中央に置く。
 * 形は公式のブランド素材と同じ（https://bsky.social/about/press 、https://commons.wikimedia.org/wiki/File:Bluesky_Logo.svg ） */
function BlueskyIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props} viewBox="0 -3.5 61 61">
      <path d="M13.223 3.602C20.215 8.832 27.738 19.439 30.5 25.13c2.762-5.691 10.284-16.297 17.278-21.528C52.824-.172 61-3.093 61 6.2c0 1.856-1.068 15.59-1.694 17.82-2.178 7.752-10.112 9.73-17.17 8.532 12.337 2.092 15.475 9.021 8.697 15.95-12.872 13.159-18.5-3.302-19.943-7.52-.264-.773-.388-1.135-.39-.827-.002-.308-.126.054-.39.827-1.442 4.218-7.071 20.679-19.943 7.52-6.778-6.929-3.64-13.858 8.697-15.95-7.058 1.197-14.992-.78-17.17-8.532C1.068 21.79 0 8.056 0 6.2 0-3.093 8.176-.172 13.223 3.602Z" />
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
 * rel="me" で「この人のアカウント」であることを示す（相手側の相互リンク確認に使える）。
 *
 * 見た目はアイコンだけ（npub のような長い識別子を並べない）。どのサービスの誰かは
 * aria-label とツールチップで伝える。label はサーバー側で短縮済み（npub は先頭12字…末尾4字） */
export function ProfileLinks({ links }: { links: ProfileLink[] }) {
  const { t } = useTranslation();
  if (links.length === 0) return null;
  return (
    <Box
      component="nav"
      aria-label={t("profile.linksLabel")}
      sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}
    >
      {links.map((l) => {
        const Icon = ICONS[l.provider];
        const name = t("profile.linkTo", { provider: providerLabel(l.provider), label: l.label });
        return (
          <Tooltip key={l.provider} title={name}>
            <IconButton
              component="a"
              href={l.url}
              target="_blank"
              rel="me noopener noreferrer"
              aria-label={name}
              size="small"
              sx={{ border: 1, borderColor: "divider", color: "text.secondary" }}
            >
              <Icon fontSize="small" />
            </IconButton>
          </Tooltip>
        );
      })}
    </Box>
  );
}
