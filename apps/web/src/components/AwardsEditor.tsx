import { useEffect, useRef, useState } from "react";
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
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import type { AwardRank } from "@eventer/shared";
import { useEventEntries } from "../api/hooks.js";
import {
  useAwards,
  useCreateRank,
  useCreateSpecial,
  useDeleteRank,
  useDeleteSpecial,
  useSetAwardResult,
  useUpdateRank,
  useUpdateSpecial,
} from "../api/awardHooks.js";
import { BlurCounterField } from "./BlurCounterField.js";
import { CounterTextField } from "./CounterTextField.js";

/** onBlur 保存の賞編集フィールド（ローカル編集状態＋文字数カウンタ） */

export function AwardsEditor({ eventId }: { eventId: string }) {
  const { data: awards } = useAwards(eventId);
  const { data: entries } = useEventEntries(eventId);
  const createRank = useCreateRank(eventId);
  const updateRank = useUpdateRank(eventId);
  const deleteRank = useDeleteRank(eventId);
  const createSpecial = useCreateSpecial(eventId);
  const updateSpecial = useUpdateSpecial(eventId);
  const deleteSpecial = useDeleteSpecial(eventId);
  const setResult = useSetAwardResult(eventId);

  const [rankName, setRankName] = useState("");
  const [specialName, setSpecialName] = useState("");

  // ドラッグ並び替え用のローカル順序
  const [ranks, setRanks] = useState<AwardRank[]>([]);
  useEffect(() => {
    if (awards) setRanks(awards.ranks);
  }, [awards]);
  const dragIndex = useRef<number | null>(null);

  const onDragOver = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    const from = dragIndex.current;
    if (from === null || from === i) return;
    setRanks((prev) => {
      const a = [...prev];
      const [moved] = a.splice(from, 1);
      a.splice(i, 0, moved);
      return a;
    });
    dragIndex.current = i;
  };
  const onDrop = () => {
    dragIndex.current = null;
    // 新しい並び順を rank_order に反映（1 が最上位）
    ranks.forEach((r, idx) => {
      if (r.rankOrder !== idx + 1) {
        updateRank.mutate({ rankId: r.id, input: { rankOrder: idx + 1 } });
      }
    });
  };

  const entryOptions = entries ?? [];
  const winnerOf = (key: "rank" | "special", id: string) =>
    awards?.results.find((r) =>
      key === "rank" ? r.awardRankId === id : r.specialAwardId === id,
    )?.entryId ?? "";

  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 3 }}>
        表彰（ランキング賞・特別枠）
      </Typography>

      <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 2 }}>
        ランキング賞（ドラッグで並び替え・上が上位）
      </Typography>
      <Stack spacing={2}>
        {ranks.map((r, i) => (
          <Card
            key={r.id}
            variant="outlined"
            draggable
            onDragStart={() => (dragIndex.current = i)}
            onDragOver={(e) => onDragOver(e, i)}
            onDrop={onDrop}
            onDragEnd={onDrop}
          >
            <CardContent>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <DragIndicatorIcon
                  sx={{ cursor: "grab", color: "text.disabled" }}
                />
                <Stack spacing={3} sx={{ flex: 1 }}>
                  <BlurCounterField
                    label="賞の名前"
                    initial={r.name}
                    max={100}
                    onSave={(v) =>
                      v !== r.name &&
                      v &&
                      updateRank.mutate({
                        rankId: r.id,
                        input: { name: v },
                      })
                    }
                  />
                  <BlurCounterField
                    label="賞の内容（任意）"
                    initial={r.content ?? ""}
                    max={500}
                    onSave={(v) =>
                      v !== (r.content ?? "") &&
                      updateRank.mutate({
                        rankId: r.id,
                        input: { content: v || null },
                      })
                    }
                  />
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
                  >
                    <MenuItem value="">（未選択）</MenuItem>
                    {entryOptions.map((en) => (
                      <MenuItem key={en.id} value={en.id}>
                        {en.name}
                      </MenuItem>
                    ))}
                  </TextField>
                </Stack>
                <IconButton color="error" onClick={() => deleteRank.mutate(r.id)}>
                  <DeleteIcon />
                </IconButton>
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>
      <Stack direction="row" spacing={1.5} sx={{ mt: 2 }}>
        <CounterTextField
          size="small"
          label="賞の名前（例: 最優秀賞）"
          value={rankName}
          max={100}
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

      <Typography variant="subtitle2" fontWeight={600} sx={{ mt: 5, mb: 2 }}>
        特別枠（ランキング外）
      </Typography>
      <Stack spacing={2}>
        {awards?.specials.map((s) => (
          <Card key={s.id} variant="outlined">
            <CardContent>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Stack spacing={3} sx={{ flex: 1 }}>
                  <BlurCounterField
                    label="特別枠の名前"
                    initial={s.name}
                    max={100}
                    onSave={(v) =>
                      v &&
                      v !== s.name &&
                      updateSpecial.mutate({
                        specialId: s.id,
                        input: { name: v },
                      })
                    }
                  />
                  <BlurCounterField
                    label="賞品・賞の内容（任意）"
                    initial={s.content ?? ""}
                    max={500}
                    onSave={(v) =>
                      v !== (s.content ?? "") &&
                      updateSpecial.mutate({
                        specialId: s.id,
                        input: { content: v || null },
                      })
                    }
                  />
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
                  >
                    <MenuItem value="">該当者なし</MenuItem>
                    {entryOptions.map((en) => (
                      <MenuItem key={en.id} value={en.id}>
                        {en.name}
                      </MenuItem>
                    ))}
                  </TextField>
                </Stack>
                <IconButton color="error" onClick={() => deleteSpecial.mutate(s.id)}>
                  <DeleteIcon />
                </IconButton>
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>
      <Stack direction="row" spacing={1.5} sx={{ mt: 2 }}>
        <CounterTextField
          size="small"
          label="特別枠の名前（例: オーディエンス賞）"
          value={specialName}
          max={100}
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
