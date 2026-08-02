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

  if (!eventData || !criteria) return <Typography>読み込み中…</Typography>;
  if (eventData.myRole !== "staff" && !isAdmin) {
    return <Alert severity="info">採点項目の管理はスタッフ専用です。</Alert>;
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
        current="採点項目"
      />
      <Typography variant="h5" fontWeight={700}>
        採点項目の管理
      </Typography>

      <Stack spacing={2}>
        {criteria.map((c) => (
          <Card key={c.id} variant="outlined">
            <CardContent>
              <Stack direction="row" spacing={2} alignItems="center">
                <BlurCounterField
                  label="名称"
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
                  label="段階"
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
                  aria-label="削除"
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
            項目を追加
          </Typography>
          <Stack spacing={2}>
            <CounterTextField
              label="名称"
              value={name}
              max={100}
              onChange={(e) => setName(e.target.value)}
              fullWidth
            />
            <CounterTextField
              label="説明"
              value={description}
              max={500}
              onChange={(e) => setDescription(e.target.value)}
              fullWidth
            />
            <TextField
              label="段階数"
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
                追加
              </Button>
            </Box>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
