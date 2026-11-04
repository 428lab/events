import { Box, Stack, Tooltip, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import type { DeckPeer } from "../lib/useDeckSync.js";

/**
 * 「いま編集中」（docs/team-deck-live-sync.md §6.4・PR4）。同じチームのスライドを開いている
 * ほかのメンバーを、名前（文字）と色の点で出す。色は名前の横にも出すので、色だけに頼らない。
 */

/** 人ごとの色。userId から決めるので、どのタブでも同じ人は同じ色になる */
const COLORS = ["#e11d48", "#d97706", "#059669", "#0891b2", "#7c3aed", "#db2777", "#65a30d", "#2563eb"];
export function peerColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function DeckPresenceList({ peers }: { peers: DeckPeer[] }) {
  const { t } = useTranslation();
  const names = peers.map((p) => t("studio.deckPresenceName", { name: p.name })).join(t("studio.deckPresenceSeparator"));
  return (
    <Stack direction="row" spacing={0.75} alignItems="center" role="status" aria-label={t("studio.deckPresence", { names })}>
      <Typography variant="caption" color="text.secondary">{t("studio.deckPresenceLabel")}</Typography>
      {peers.map((p) => (
        <Tooltip key={p.userId} title={t("studio.deckPresenceName", { name: p.name })}>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Box component="span" aria-hidden sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: peerColor(p.userId), flexShrink: 0 }} />
            <Typography variant="caption">{t("studio.deckPresenceName", { name: p.name })}</Typography>
          </Stack>
        </Tooltip>
      ))}
    </Stack>
  );
}

/** そのページで、ほかのメンバーが選んでいる要素と色（キャンバスの枠用） */
export function peerOutlinesOn(peers: DeckPeer[], slideId: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of peers) {
    for (const s of p.selections) {
      if (s.slideId !== slideId) continue;
      for (const id of s.elementIds) if (!out.has(id)) out.set(id, peerColor(p.userId));
    }
  }
  return out;
}
