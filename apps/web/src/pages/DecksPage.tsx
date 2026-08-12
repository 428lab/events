import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Stack,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useCreateDeck, useMyDecks } from "../api/deckHooks.js";
import { formatDateTime } from "../lib/format.js";

export function DecksPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: decks, isLoading } = useMyDecks();
  const create = useCreateDeck();

  const newDeck = () =>
    create.mutate(
      { title: "" },
      { onSuccess: (d) => navigate(`/decks/${d.id}/edit`) },
    );

  return (
    <Stack spacing={3}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h5" fontWeight={700}>
          {t("nav.decks")}
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={newDeck}
          disabled={create.isPending}
        >
          {t("studio.newDeck")}
        </Button>
      </Stack>

      {isLoading || !decks ? (
        <Typography>{t("common.loading")}</Typography>
      ) : decks.length === 0 ? (
        <Typography color="text.secondary">
          {t("studio.decksEmpty", { action: t("studio.newDeck") })}
        </Typography>
      ) : (
        <Stack spacing={1.5}>
          {decks.map((d) => (
            <Card key={d.id} variant="outlined">
              <CardActionArea onClick={() => navigate(`/decks/${d.id}/edit`)}>
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
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
