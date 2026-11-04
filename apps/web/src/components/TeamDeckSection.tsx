import { useState } from "react";
import { Alert, Box, Button, Stack, TextField, Typography } from "@mui/material";
import SlideshowIcon from "@mui/icons-material/Slideshow";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  useCreateTeamDeck,
  useEventTeamDecks,
  useIssueTeamDeckAgentToken,
  useRevokeTeamDeckAgentToken,
  type IssuedTeamDeckAgentToken,
} from "../api/deckHooks.js";
import { errorCode } from "../lib/errorMessage.js";
import { formatDateTime } from "../lib/format.js";
import { tDynamic } from "../i18n/index.js";
import { DeckExportMenu } from "./DeckExportMenu.js";

/**
 * 自分のチームの「チームのスライド」(docs/team-participation.md「チームのスライド」)。
 * まだ無ければ「チームのスライドを作る」（メンバーなら誰でも）、あれば「編集する」「見る」。
 * 編集できるのはそのチームのいまのメンバー（サーバーが判定する）。イベントが終わったら
 * 見るだけ（ended）: 作るボタンも出さない（サーバーも event_ended で止める）。
 *
 * 「AIに書いてもらう」（docs/agent-deck-token.md「チームのスライド」）: メンバーがトークンを発行すると、
 * AI が書いている間はメンバーも編集できない。メンバーなら誰でも取り消せて、取り消せばすぐ編集できる。
 * 平文のトークンは発行直後の応答にしか無いので、この画面の state にだけ置く。
 */
export function TeamDeckSection({ eventId, teamId, ended = false }: { eventId: string; teamId: string; ended?: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: decks } = useEventTeamDecks(eventId, true);
  const create = useCreateTeamDeck(eventId);
  const issue = useIssueTeamDeckAgentToken(eventId);
  const revoke = useRevokeTeamDeckAgentToken(eventId);
  const [issued, setIssued] = useState<IssuedTeamDeckAgentToken | null>(null);
  const [copied, setCopied] = useState(false);
  const row = decks?.find((d) => d.entryId === teamId);
  const agent = row?.agent ?? null;
  const failed = create.isError ? create.error : issue.isError ? issue.error : revoke.isError ? revoke.error : null;
  const instruction = issued
    ? t("deckAgent.instruction", { specUrl: issued.specUrl, token: issued.token, expires: formatDateTime(issued.expiresAt) })
    : "";

  function onIssue() {
    if (!window.confirm(t("teams.deckAgentConfirm"))) return;
    setCopied(false);
    issue.mutate(teamId, { onSuccess: (res) => setIssued(res) });
  }
  function onRevoke() {
    if (!window.confirm(t("teams.deckAgentRevokeConfirm"))) return;
    revoke.mutate(teamId, { onSuccess: () => setIssued(null) });
  }
  async function copy() {
    try { await navigator.clipboard.writeText(instruction); setCopied(true); } catch { setCopied(false); }
  }
  const minutes = agent ? Math.max(1, Math.ceil((agent.expiresAt - Date.now()) / 60_000)) : 0;

  return (
    <Box sx={{ borderTop: 1, borderColor: "divider", pt: 1 }}>
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} alignItems="center">
          <SlideshowIcon fontSize="small" color="action" />
          <Typography variant="subtitle2">{t("teams.deckTitle")}</Typography>
        </Stack>
        {!row && !ended && <Typography variant="body2" color="text.secondary">{t("teams.deckHelp")}</Typography>}
        {failed && (
          <Alert severity="error">{tDynamic(`teams.error_${errorCode(failed) ?? "default"}`, t("teams.error_default"))}</Alert>
        )}
        {agent && !ended && (
          // ボタンは文の下に置く（Alert の action に入れると、狭い画面で文の幅が 0 になる）
          <Alert severity="info" sx={{ "& .MuiAlert-message": { minWidth: 0, flex: 1 } }}>
            <Stack spacing={1} alignItems="flex-start">
              <span>
                {agent.issuedBy
                  ? t("teams.deckAgentWriting", { name: agent.issuedBy.name, minutes })
                  : t("teams.deckAgentWritingNoName", { minutes })}
              </span>
              <Button color="inherit" size="small" variant="outlined" disabled={revoke.isPending} onClick={onRevoke}
                sx={{ maxWidth: "100%", whiteSpace: "normal", textAlign: "left" }}>{t("teams.deckAgentRevoke")}</Button>
            </Stack>
          </Alert>
        )}
        {issued && agent && (
          <Stack spacing={1}>
            <TextField label={t("teams.deckAgentInstructionLabel")} value={instruction} multiline minRows={4}
              slotProps={{ input: { readOnly: true, sx: { fontFamily: "monospace" } } }} />
            <Box>
              <Button size="small" onClick={() => void copy()}>{t("teams.deckAgentCopy")}</Button>
              {copied && <Typography component="span" variant="caption" sx={{ ml: 1 }}>{t("common.copied")}</Typography>}
            </Box>
          </Stack>
        )}
        {decks === undefined ? null : row ? (
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>{row.deck.title}</Typography>
            {row.canEdit && (
              <Button size="small" variant="contained" component={RouterLink} to={`/decks/${row.deck.id}/edit`}>{t("teams.deckEdit")}</Button>
            )}
            <Button size="small" variant="outlined" component={RouterLink} to={`/d/${row.deck.slug}`} target="_blank">{t("teams.deckView")}</Button>
            {/* イベントが終わって編集できなくなっても、ここから書き出せる */}
            <DeckExportMenu slug={row.deck.slug} />
            {row.canEdit && (
              <Button size="small" variant="outlined" disabled={issue.isPending} onClick={onIssue}>{t("teams.deckAgentIssue")}</Button>
            )}
          </Stack>
        ) : ended ? (
          <Typography variant="body2" color="text.secondary">{t("teams.deckNone")}</Typography>
        ) : (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button size="small" variant="outlined" disabled={create.isPending} onClick={() => {
              if (!window.confirm(t("teams.deckCreateConfirm"))) return;
              create.mutate(teamId, { onSuccess: (res) => navigate(`/decks/${res.deckId}/edit`) });
            }}>{t("teams.deckCreate")}</Button>
            {/* スライドがまだ無くても、AI に土台を書いてもらえる（発行のときにスライドを作る） */}
            <Button size="small" variant="outlined" disabled={issue.isPending} onClick={onIssue}>{t("teams.deckAgentIssue")}</Button>
          </Stack>
        )}
      </Stack>
    </Box>
  );
}
