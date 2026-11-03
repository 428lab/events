import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import SlideshowIcon from "@mui/icons-material/Slideshow";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useCreateTeamDeck, useEventTeamDecks } from "../api/deckHooks.js";
import { errorCode } from "../lib/errorMessage.js";
import { tDynamic } from "../i18n/index.js";

/**
 * 自分のチームの「チームのスライド」(docs/team-participation.md「チームのスライド」)。
 * まだ無ければ「チームのスライドを作る」（メンバーなら誰でも）、あれば「編集する」「見る」。
 * 編集できるのはそのチームのいまのメンバー（サーバーが判定する）。
 */
export function TeamDeckSection({ eventId, teamId }: { eventId: string; teamId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: decks } = useEventTeamDecks(eventId, true);
  const create = useCreateTeamDeck(eventId);
  const row = decks?.find((d) => d.entryId === teamId);
  return (
    <Box sx={{ borderTop: 1, borderColor: "divider", pt: 1 }}>
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} alignItems="center">
          <SlideshowIcon fontSize="small" color="action" />
          <Typography variant="subtitle2">{t("teams.deckTitle")}</Typography>
        </Stack>
        {!row && <Typography variant="body2" color="text.secondary">{t("teams.deckHelp")}</Typography>}
        {create.isError && (
          <Alert severity="error">{tDynamic(`teams.error_${errorCode(create.error) ?? "default"}`, t("teams.error_default"))}</Alert>
        )}
        {decks === undefined ? null : row ? (
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>{row.deck.title}</Typography>
            {row.canEdit && (
              <Button size="small" variant="contained" component={RouterLink} to={`/decks/${row.deck.id}/edit`}>{t("teams.deckEdit")}</Button>
            )}
            <Button size="small" variant="outlined" component={RouterLink} to={`/d/${row.deck.slug}`} target="_blank">{t("teams.deckView")}</Button>
          </Stack>
        ) : (
          <Box>
            <Button size="small" variant="outlined" disabled={create.isPending} onClick={() => {
              if (!window.confirm(t("teams.deckCreateConfirm"))) return;
              create.mutate(teamId, { onSuccess: (res) => navigate(`/decks/${res.deckId}/edit`) });
            }}>{t("teams.deckCreate")}</Button>
          </Box>
        )}
      </Stack>
    </Box>
  );
}
