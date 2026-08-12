import {
  Alert,
  Card,
  CardContent,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { UserLink } from "../components/UserLink.js";
import { useEntryUserResolver } from "../lib/entryUser.js";
import { useEvent } from "../api/hooks.js";
import { useScoreResults } from "../api/scoringHooks.js";
import { EventBreadcrumbs } from "../components/EventBreadcrumbs.js";

export function ScoreResultsPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const { data: eventData } = useEvent(id);
  const { data: results } = useScoreResults(id);
  const resolveUser = useEntryUserResolver(id);

  if (!eventData || !results) {
    return <Typography>{t("common.loading")}</Typography>;
  }

  return (
    <Stack spacing={3}>
      <EventBreadcrumbs
        eventId={id}
        eventTitle={eventData.event.title}
        current={t("eventRun.resultsTitle")}
      />
      <Typography variant="h5" fontWeight={700}>
        {t("eventRun.resultsTitle")}
      </Typography>

      {!results.available ? (
        <Alert severity="info">{t("eventRun.resultsNotPublished")}</Alert>
      ) : results.entries.length === 0 ? (
        <Typography color="text.secondary">
          {t("eventRun.resultsEmpty")}
        </Typography>
      ) : (
        <Card variant="outlined">
          <CardContent sx={{ p: { xs: 1, sm: 2 } }}>
            <TableContainer sx={{ overflowX: "auto" }}>
            <Table size="small" sx={{ width: "auto", minWidth: "100%" }}>
              <TableHead>
                <TableRow>
                  <TableCell>{t("eventRun.rankColumn")}</TableCell>
                  <TableCell>{t("eventRun.teamColumn")}</TableCell>
                  {results.criteria.map((c) => (
                    <TableCell key={c.id} align="right">
                      {c.name}
                    </TableCell>
                  ))}
                  <TableCell align="right">
                    {t("eventRun.totalColumn")}
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {results.entries.map((e, i) => (
                  <TableRow key={e.entryId}>
                    <TableCell>
                      {i < 3 ? (
                        <Chip
                          size="small"
                          color={i === 0 ? "secondary" : "default"}
                          label={t("eventRun.rankNth", { n: i + 1 })}
                        />
                      ) : (
                        t("eventRun.rankNth", { n: i + 1 })
                      )}
                    </TableCell>
                    <TableCell>
                      <UserLink
                        username={resolveUser(e.entryId)?.username}
                        name={e.entryName}
                      />
                    </TableCell>
                    {results.criteria.map((c) => (
                      <TableCell key={c.id} align="right">
                        {e.perCriterion[c.id] ?? 0}
                      </TableCell>
                    ))}
                    <TableCell align="right">
                      <strong>{e.total}</strong>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </TableContainer>
          </CardContent>
        </Card>
      )}
    </Stack>
  );
}
