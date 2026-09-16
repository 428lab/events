import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  FormControlLabel,
  LinearProgress,
  Switch,
  Link,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { Entry, Event, EventRole } from "@eventer/shared";
import { useEventEntries, useMe, useUpdateSubmission, useSelfEntryParticipation } from "../api/hooks.js";
import { ApiError } from "../api/client.js";

/** 自分のエントリの提出物（発表資料・ソース）の編集フォーム */
function SubmissionEditor({ eventId, entry }: { eventId: string; entry: Entry }) {
  const { t } = useTranslation();
  const update = useUpdateSubmission(eventId);
  const [presentationUrl, setPresentationUrl] = useState(
    entry.submission?.presentationUrl ?? "",
  );
  const [sourceCodeUrl, setSourceCodeUrl] = useState(
    entry.submission?.sourceCodeUrl ?? "",
  );

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          {t("eventDetail.mySubmission")}
        </Typography>
        <Stack spacing={2}>
          <TextField
            label={t("eventDetail.presentationUrl")}
            value={presentationUrl}
            onChange={(e) => setPresentationUrl(e.target.value)}
            fullWidth
          />
          <TextField
            label={t("eventDetail.sourceCodeUrl")}
            value={sourceCodeUrl}
            onChange={(e) => setSourceCodeUrl(e.target.value)}
            fullWidth
          />
          {update.isError && (
            <Alert severity="error">
              {t("eventDetail.submissionSaveFailed")}
            </Alert>
          )}
          {update.isSuccess && (
            <Alert severity="success">{t("eventDetail.submissionSaved")}</Alert>
          )}
          <Box>
            <Button
              variant="contained"
              disabled={update.isPending}
              onClick={() =>
                update.mutate({
                  entryId: entry.id,
                  input: { presentationUrl, sourceCodeUrl },
                })
              }
            >
              {t("common.save")}
            </Button>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

/**
 * コンテストの提出物。自分のぶんの編集フォームと、みんなの提出一覧。
 *
 * 一覧はオンライン・ハイブリッドのイベントだけ。会場開催では発表を見に行けるので
 * リンクを並べる意味が薄い。出し分けごとここに持たせてある。
 */
export function EventSubmissions({
  eventId,
  event,
  contest,
  myRole,
}: {
  eventId: string;
  event: Event;
  contest: boolean;
  myRole: EventRole | null;
}) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const { data: entries } = useEventEntries(eventId);
  const participation = useSelfEntryParticipation(eventId);

  if (!contest) return null;
  const myEntry = entries?.find((e) => me && e.memberUserIds.includes(me.id));
  const myIndividualEntry = entries?.find((e) => e.kind === "individual" && me && e.memberUserIds.includes(me.id));
  const alreadyScored = participation.error instanceof ApiError &&
    (participation.error.body as { error?: string } | null)?.error === "entry_already_scored";
  const showList =
    (event.venueType === "online" || event.venueType === "hybrid") &&
    Boolean(entries);

  return (
    <>
      {myRole === "staff" && event.participationType === "individual" && (
        <Box>
          <FormControlLabel
            label={t("eventDetail.selfScoringParticipation")}
            control={<Switch
              checked={Boolean(myIndividualEntry)}
              disabled={!entries || participation.isPending}
              onChange={(_, checked) => {
                if (checked || window.confirm(t("eventDetail.selfScoringOffConfirm"))) {
                  participation.mutate(checked);
                }
              }}
            />}
          />
          {participation.isPending && <LinearProgress />}
          {participation.isError && <Alert severity="error">
            {t(alreadyScored ? "eventDetail.selfScoringAlreadyScored" : "eventDetail.selfScoringChangeFailed")}
          </Alert>}
        </Box>
      )}
      {myEntry && <SubmissionEditor key={myEntry.id} eventId={eventId} entry={myEntry} />}

      {showList && entries && (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" gutterBottom>
              {t("eventDetail.submissionsHeading")}
            </Typography>
            <Divider sx={{ mb: 1 }} />
            <List dense>
              {entries
                .filter((e) => e.submission)
                .map((e) => (
                  <ListItem key={e.id} disableGutters>
                    <ListItemText
                      primary={e.name}
                      secondary={
                        <>
                          {e.submission?.presentationUrl && (
                            <Link
                              href={e.submission.presentationUrl}
                              target="_blank"
                              rel="noreferrer"
                              sx={{ mr: 2 }}
                            >
                              {t("eventDetail.submissionSlides")}
                            </Link>
                          )}
                          {e.submission?.sourceCodeUrl && (
                            <Link
                              href={e.submission.sourceCodeUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {t("eventDetail.submissionCode")}
                            </Link>
                          )}
                        </>
                      }
                    />
                  </ListItem>
                ))}
            </List>
          </CardContent>
        </Card>
      )}
    </>
  );
}
