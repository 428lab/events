import { useState } from "react";
import {
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
import { useEventEntries } from "../api/hooks.js";
import {
  useAwards,
  useCreateRank,
  useCreateSpecial,
  useDeleteRank,
  useDeleteSpecial,
  useSetAwardResult,
} from "../api/awardHooks.js";

export function AwardsEditor({ eventId }: { eventId: string }) {
  const { data: awards } = useAwards(eventId);
  const { data: entries } = useEventEntries(eventId);
  const createRank = useCreateRank(eventId);
  const deleteRank = useDeleteRank(eventId);
  const createSpecial = useCreateSpecial(eventId);
  const deleteSpecial = useDeleteSpecial(eventId);
  const setResult = useSetAwardResult(eventId);

  const [rankName, setRankName] = useState("");
  const [specialName, setSpecialName] = useState("");

  const winnerOf = (key: "rank" | "special", id: string) =>
    awards?.results.find((r) =>
      key === "rank" ? r.awardRankId === id : r.specialAwardId === id,
    )?.entryId ?? "";

  const entryOptions = entries ?? [];

  return (
    <Box>
      <Typography variant="subtitle1" gutterBottom>
        表彰（ランキング賞・特別枠）
      </Typography>

      <Typography variant="subtitle2" sx={{ mt: 1 }}>
        ランキング賞（上から上位）
      </Typography>
      <Stack spacing={1} sx={{ mt: 1 }}>
        {awards?.ranks.map((r) => (
          <Card key={r.id} variant="outlined">
            <CardContent>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Typography sx={{ flex: 1 }} fontWeight={600}>
                  {r.name}
                </Typography>
                <TextField
                  label="受賞チーム"
                  select
                  size="small"
                  value={winnerOf("rank", r.id)}
                  onChange={(e) =>
                    setResult.mutate({
                      awardRankId: r.id,
                      entryId: e.target.value || null,
                    })
                  }
                  sx={{ minWidth: 200 }}
                >
                  <MenuItem value="">（未選択）</MenuItem>
                  {entryOptions.map((en) => (
                    <MenuItem key={en.id} value={en.id}>
                      {en.name}
                    </MenuItem>
                  ))}
                </TextField>
                <IconButton color="error" onClick={() => deleteRank.mutate(r.id)}>
                  <DeleteIcon />
                </IconButton>
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>
      <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
        <TextField
          size="small"
          label="賞の名前（例: 最優秀賞）"
          value={rankName}
          onChange={(e) => setRankName(e.target.value)}
          sx={{ flex: 1 }}
        />
        <Button
          variant="outlined"
          disabled={!rankName}
          onClick={() =>
            createRank.mutate({ name: rankName }, { onSuccess: () => setRankName("") })
          }
        >
          賞を追加
        </Button>
      </Stack>

      <Typography variant="subtitle2" sx={{ mt: 3 }}>
        特別枠（ランキング外）
      </Typography>
      <Stack spacing={1} sx={{ mt: 1 }}>
        {awards?.specials.map((s) => (
          <Card key={s.id} variant="outlined">
            <CardContent>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Typography sx={{ flex: 1 }} fontWeight={600}>
                  {s.name}
                </Typography>
                <TextField
                  label="受賞チーム"
                  select
                  size="small"
                  value={winnerOf("special", s.id)}
                  onChange={(e) =>
                    setResult.mutate({
                      specialAwardId: s.id,
                      entryId: e.target.value || null,
                    })
                  }
                  sx={{ minWidth: 200 }}
                >
                  <MenuItem value="">（未選択）</MenuItem>
                  {entryOptions.map((en) => (
                    <MenuItem key={en.id} value={en.id}>
                      {en.name}
                    </MenuItem>
                  ))}
                </TextField>
                <IconButton color="error" onClick={() => deleteSpecial.mutate(s.id)}>
                  <DeleteIcon />
                </IconButton>
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>
      <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
        <TextField
          size="small"
          label="特別枠の名前（例: オーディエンス賞）"
          value={specialName}
          onChange={(e) => setSpecialName(e.target.value)}
          sx={{ flex: 1 }}
        />
        <Button
          variant="outlined"
          disabled={!specialName}
          onClick={() =>
            createSpecial.mutate(
              { name: specialName },
              { onSuccess: () => setSpecialName("") },
            )
          }
        >
          特別枠を追加
        </Button>
      </Stack>
    </Box>
  );
}
