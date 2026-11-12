import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  FormControlLabel,
  Stack,
  Switch,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useCreateDeck, useMyDecks, useMyTeamDecks, useSetDeckProfile } from "../api/deckHooks.js";
import type { DeckSummary } from "@eventer/shared";
import { formatDateTime } from "../lib/format.js";

export function DecksPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: decks, isLoading } = useMyDecks();
  // チームのスライド（いまメンバーのチームのもの）。自分の一覧とは分けて「チーム: ○○」で出す
  const { data: teamDecks } = useMyTeamDecks();
  const create = useCreateDeck();

  const newDeck = () =>
    create.mutate(
      { title: "" },
      { onSuccess: (d) => navigate(`/decks/${d.id}/edit`) },
    );

  return (
    <Stack spacing={3}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap spacing={1}>
        <Typography variant="h5" fontWeight={700}>
          {t("nav.decks")}
        </Typography>
        <Button onClick={() => navigate("/decks/import")}>{t("deckImport.title")}</Button>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={newDeck}
          disabled={create.isPending}
        >
          {t("studio.newDeck")}
        </Button>
      </Stack>

      {teamDecks && teamDecks.length > 0 && (
        <Stack spacing={1.5}>
          <Typography variant="subtitle1" fontWeight={700}>{t("studio.deckTeamDecksHeading")}</Typography>
          {/* 終わったイベントのチームのスライドは見るだけ（編集画面は 403 になる）ので閲覧を開く */}
          {teamDecks.map((d) => <DeckCard key={d.id} deck={d} onOpen={() => navigate(d.team?.ended ? `/d/${d.slug}` : `/decks/${d.id}/edit`)} />)}
        </Stack>
      )}

      {isLoading || !decks ? (
        <Typography>{t("common.loading")}</Typography>
      ) : decks.length === 0 ? (
        <Typography color="text.secondary">
          {t("studio.decksEmpty", { action: t("studio.newDeck") })}
        </Typography>
      ) : (
        <Stack spacing={1.5}>
          {decks.map((d) => <DeckCard key={d.id} deck={d} onOpen={() => navigate(`/decks/${d.id}/edit`)} />)}
        </Stack>
      )}
    </Stack>
  );
}

function DeckCard({ deck: d, onOpen }: { deck: DeckSummary; onOpen: () => void }) {
  const { t } = useTranslation();
  const setProfile = useSetDeckProfile();
  return (
    <Card variant="outlined">
      <CardActionArea onClick={onOpen}>
        <CardContent>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              flexWrap: "wrap",
            }}
          >
            <Typography sx={{ fontWeight: 700, flex: 1, minWidth: 0 }} noWrap>
              {d.title || t("studio.untitledDeck")}
            </Typography>
            {d.team && (
              <Chip size="small" color="primary" variant="outlined" sx={{ maxWidth: "100%" }}
                label={t("studio.deckTeamEvent", { name: d.team.name, event: d.team.eventTitle })} />
            )}
            <Typography variant="caption" color="text.secondary">
              {t(
                d.slideCount === 1
                  ? "studio.pageCountOne"
                  : "studio.pageCount",
                { n: d.slideCount },
              )}
              {t("common.dotSeparator")}
              {t("studio.updatedAt", {
                time: formatDateTime(d.updatedAt),
              })}
            </Typography>
          </Box>
        </CardContent>
      </CardActionArea>
      {/* プロフィールに載せる（docs/slide-editor.md「プロフィールに載せる」）と表示回数 */}
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ px: 2, pb: 1 }} flexWrap="wrap" useFlexGap>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={d.profileShown === true}
              disabled={setProfile.isPending}
              onChange={(e) => setProfile.mutate({ deckId: d.id, show: e.target.checked })}
            />
          }
          label={<Typography variant="body2">{t("studio.deckProfileShow")}</Typography>}
        />
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: "text.secondary" }}>
          <VisibilityOutlinedIcon sx={{ fontSize: 16 }} aria-hidden />
          <Typography variant="caption">{t("studio.deckViews", { n: d.views ?? 0 })}</Typography>
        </Stack>
      </Stack>
    </Card>
  );
}
