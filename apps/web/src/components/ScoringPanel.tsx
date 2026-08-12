import { Box, Button, Stack, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import type { Score, ScoringCriterion } from "@eventer/shared";
import { usePutScore } from "../api/scoringHooks.js";

export function ScoringPanel({
  eventId,
  entryId,
  criteria,
  myScores,
  disabled,
}: {
  eventId: string;
  entryId: string;
  criteria: ScoringCriterion[];
  myScores: Score[];
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const putScore = usePutScore(eventId);

  const valueFor = (criterionId: string) =>
    myScores.find((s) => s.entryId === entryId && s.criterionId === criterionId)
      ?.value ?? null;

  return (
    <Stack spacing={2.5}>
      {criteria.map((c) => {
        const current = valueFor(c.id);
        return (
          <Box key={c.id}>
            <Typography variant="subtitle2">{c.name}</Typography>
            {c.description && (
              <Typography variant="caption" color="text.secondary">
                {c.description}
              </Typography>
            )}
            <Stack
              direction="row"
              spacing={1}
              flexWrap="wrap"
              useFlexGap
              sx={{ mt: 0.5 }}
            >
              {Array.from({ length: c.maxLevel }, (_, i) => i + 1).map((v) => (
                <Button
                  key={v}
                  size="small"
                  variant={current === v ? "contained" : "outlined"}
                  disabled={disabled || putScore.isPending}
                  onClick={() =>
                    putScore.mutate({
                      entryId,
                      criterionId: c.id,
                      value: v,
                    })
                  }
                  sx={{ minWidth: 44 }}
                >
                  {v}
                </Button>
              ))}
            </Stack>
          </Box>
        );
      })}
      {disabled && (
        <Typography variant="caption" color="text.secondary">
          {t("eventRun.scoringDisabledNote")}
        </Typography>
      )}
    </Stack>
  );
}
