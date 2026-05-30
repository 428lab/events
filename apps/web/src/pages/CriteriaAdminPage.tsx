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
import { useEvent } from "../api/hooks.js";
import {
  useCreateCriterion,
  useCriteria,
  useDeleteCriterion,
  useUpdateCriterion,
} from "../api/scoringHooks.js";

export function CriteriaAdminPage() {
  const { id = "" } = useParams();
  const { data: eventData } = useEvent(id);
  const { data: criteria } = useCriteria(id);
  const create = useCreateCriterion(id);
  const update = useUpdateCriterion(id);
  const remove = useDeleteCriterion(id);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [maxLevel, setMaxLevel] = useState(4);

  if (!eventData || !criteria) return <Typography>読み込み中…</Typography>;
  if (eventData.myRole !== "staff") {
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
      <Typography variant="h5" fontWeight={700}>
        採点項目の管理
      </Typography>

      <Stack spacing={2}>
        {criteria.map((c) => (
          <Card key={c.id} variant="outlined">
            <CardContent>
              <Stack direction="row" spacing={2} alignItems="center">
                <TextField
                  label="名称"
                  defaultValue={c.name}
                  onBlur={(e) =>
                    e.target.value !== c.name &&
                    update.mutate({ cid: c.id, input: { name: e.target.value } })
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
            <TextField
              label="名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
            />
            <TextField
              label="説明"
              value={description}
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
