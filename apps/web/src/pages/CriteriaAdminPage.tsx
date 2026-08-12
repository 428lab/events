import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useEvent, useIsAdmin } from "../api/hooks.js";
import {
  useCreateCriterion,
  useCriteria,
  useDeleteCriterion,
  useUpdateCriterion,
} from "../api/scoringHooks.js";
import { CounterTextField } from "../components/CounterTextField.js";
import { BlurCounterField } from "../components/BlurCounterField.js";
import { EventBreadcrumbs } from "../components/EventBreadcrumbs.js";

export function CriteriaAdminPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const { data: eventData } = useEvent(id);
  const isAdmin = useIsAdmin();
  const { data: criteria } = useCriteria(id);
  const create = useCreateCriterion(id);
  const update = useUpdateCriterion(id);
  const remove = useDeleteCriterion(id);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [maxLevel, setMaxLevel] = useState(4);

  if (!eventData || !criteria)
    return <Typography>{t("common.loading")}</Typography>;
  if (eventData.myRole !== "staff" && !isAdmin) {
    return <Alert severity="info">{t("eventRun.criteriaStaffOnly")}</Alert>;
  }

  const add = () => {
    if (!name) return;
    create.mutate(
      { name, description: description || null, maxLevel },
      {
        onSuccess: () => {
          setName("");
          setDescription("");
          setMaxLevel(4);
        },
      },
    );
  };

  return (
    <Stack spacing={3}>
      <EventBreadcrumbs
        eventId={id}
        eventTitle={eventData.event.title}
        current={t("eventDetail.criteria")}
      />
      <Typography variant="h5" fontWeight={700}>
        {t("eventRun.criteriaTitle")}
      </Typography>

      <Stack spacing={2}>
        {criteria.map((c) => (
          <Card key={c.id} variant="outlined">
            <CardContent>
              <Stack direction="row" spacing={2} alignItems="center">
                <BlurCounterField
                  label={t("eventRun.criterionName")}
                  initial={c.name}
                  max={100}
                  onSave={(v) =>
                    v !== c.name &&
                    v &&
                    update.mutate({ cid: c.id, input: { name: v } })
                  }
                  sx={{ flex: 1 }}
                />
                <TextField
                  size="small"
                  label={t("eventRun.criterionLevel")}
                  select
                  value={c.maxLevel}
                  onChange={(e) =>
                    update.mutate({
                      cid: c.id,
                      input: { maxLevel: Number(e.target.value) },
                    })
                  }
                  sx={{ width: 100 }}
                >
                  {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                    <MenuItem key={n} value={n}>
                      {n}
                    </MenuItem>
                  ))}
                </TextField>
                <IconButton
                  color="error"
                  onClick={() => remove.mutate(c.id)}
                  aria-label={t("eventRun.delete")}
                >
                  <DeleteIcon />
                </IconButton>
              </Stack>
              {c.description && (
                <Typography variant="caption" color="text.secondary">
                  {c.description}
                </Typography>
              )}
            </CardContent>
          </Card>
        ))}
      </Stack>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" gutterBottom>
            {t("eventRun.criterionAddHeading")}
          </Typography>
          <Stack spacing={2}>
            <CounterTextField
              label={t("eventRun.criterionName")}
              value={name}
              max={100}
              onChange={(e) => setName(e.target.value)}
              fullWidth
            />
            <CounterTextField
              label={t("eventRun.criterionDescription")}
              value={description}
              max={500}
              onChange={(e) => setDescription(e.target.value)}
              fullWidth
            />
            <TextField
              label={t("eventRun.criterionLevelCount")}
              select
              value={maxLevel}
              onChange={(e) => setMaxLevel(Number(e.target.value))}
              sx={{ width: 120 }}
            >
              {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <MenuItem key={n} value={n}>
                  {n}
                </MenuItem>
              ))}
            </TextField>
            <Box>
              <Button
                variant="contained"
                disabled={!name || create.isPending}
                onClick={add}
              >
                {t("common.add")}
              </Button>
            </Box>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
