import { useEffect, useRef, useState } from "react";
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
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import { useTranslation } from "react-i18next";
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
import { useAwardEditorSave } from "./useAwardEditorSave.js";
import { CounterTextField } from "./CounterTextField.js";

export function AwardsEditor({ eventId, onBlockedChange }: {
  eventId: string; onBlockedChange: (blocked: boolean) => void;
}) {
  const { t } = useTranslation();
  const { data: awards, refetch, isError } = useAwards(eventId);
  const { data: entries } = useEventEntries(eventId);
  const createRank = useCreateRank(eventId);
  const updateRank = useUpdateRank(eventId);
  const deleteRank = useDeleteRank(eventId);
  const createSpecial = useCreateSpecial(eventId);
  const updateSpecial = useUpdateSpecial(eventId);
  const deleteSpecial = useDeleteSpecial(eventId);
  const setResult = useSetAwardResult(eventId);

  const saving = useAwardEditorSave(onBlockedChange);
  const writesDisabled = saving.busy || isError || Object.values(saving.saves).some((s) => s.phase === "unconfirmed");
  const [resetVersion, setResetVersion] = useState(0);
  const [winnerDrafts, setWinnerDrafts] = useState<Record<string, string>>({});
  const restore = () => {
    if (saving.isBusy()) return;
    void saving.run("restore", async () => {
      const { data: restoredAwards } = await refetch({ throwOnError: true });
      // Unchanged query data may keep its reference, so reset local drag order explicitly.
      if (restoredAwards) setRanks(restoredAwards.ranks);
      setWinnerDrafts({});
      setRankName("");
      setSpecialName("");
      // A failed blur save can leave initial unchanged: remount only award fields.
      setResetVersion((v) => v + 1);
      saving.clear();
    });
  };
  const feedback = (key: string) => {
    const save = saving.saves[key];
    if (!save) return null;
    return <Stack spacing={1} aria-live="polite">
      <Typography variant="body2">{t(save.phase === "pending" ? "eventRun.awardSaving"
        : save.phase === "saved" ? "eventRun.awardSaved"
        : save.phase === "failed" ? "eventRun.awardSaveFailed" : "eventRun.awardUnconfirmed")}</Typography>
      {save.phase === "failed" && <Button disabled={saving.busy} onClick={() => void saving.run(key, save.retry)}>{t("eventRun.retryAwardSave")}</Button>}
      {(save.phase === "failed" || save.phase === "unconfirmed") && <Button disabled={saving.busy} onClick={restore}>
        {t(save.phase === "failed" ? "eventRun.restoreAwards" : "eventRun.reloadAwards")}
      </Button>}
    </Stack>;
  };
  const chooseWinner = (kind: "rank" | "special", id: string, value: string) => {
    const key = `winner:${id}`;
    setWinnerDrafts((prev) => ({ ...prev, [id]: value }));
    void saving.run(key, async () => {
      await setResult.mutateAsync({ ...(kind === "rank" ? { awardRankId: id } : { specialAwardId: id }), entryId: value || null });
      setWinnerDrafts((prev) => { const next = { ...prev }; delete next[id]; return next; });
    });
  };

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
    if (dragIndex.current === null || saving.isBusy()) return;
    dragIndex.current = null;
    void saving.run("order", async () => {
      const results = await Promise.allSettled(ranks.filter((r, idx) => r.rankOrder !== idx + 1)
        .map((r) => updateRank.mutateAsync({ rankId: r.id, input: { rankOrder: ranks.indexOf(r) + 1 } })));
      const failure = results.find((r) => r.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    });
  };

  const entryOptions = entries ?? [];
  const winnerOf = (key: "rank" | "special", id: string) =>
    winnerDrafts[id] ?? awards?.results.find((r) =>
      key === "rank" ? r.awardRankId === id : r.specialAwardId === id,
    )?.entryId ?? "";

  return (
    <Box>
      <Typography variant="body2" sx={{ mb: 2 }}>{t("eventRun.awardSaveHelp")}</Typography>
      {isError && <Alert severity="error" action={<Button onClick={restore}>{t("eventRun.reloadAwards")}</Button>}>{t("eventRun.awardUnconfirmed")}</Alert>}
      {saving.blocked && <Typography role="status" sx={{ mb: 2 }}>{t("eventRun.confirmBeforeCeremony")}</Typography>}
      {feedback("restore")}
      {feedback("order")}
      {Object.keys(saving.saves).filter((key) => key.startsWith("delete:")).map((key) => <Box key={key}>{feedback(key)}</Box>)}
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 3 }}>
        {t("eventRun.awardsEditorTitle")}
      </Typography>

      <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 2 }}>
        {t("eventRun.rankAwardsHeading")}
      </Typography>
      <Stack spacing={2}>
        {ranks.map((r, i) => (
          <Card
            key={`${r.id}:${resetVersion}`}
            variant="outlined"
            draggable={!writesDisabled}
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
                <Stack spacing={3} sx={{ flex: 1, minWidth: 0 }}>
                  <Box>
                    <BlurCounterField
                      fullWidth
                      disabled={writesDisabled}
                      label={t("eventRun.awardName")}
                      initial={r.name}
                      max={100}
                      onSave={(v) =>
                        v !== r.name &&
                        v &&
                        saving.run(`name:${r.id}`, () => updateRank.mutateAsync({ rankId: r.id, input: { name: v } }))
                      }
                    />
                    {feedback(`name:${r.id}`)}
                  </Box>
                  <Box>
                    <BlurCounterField
                      fullWidth
                      disabled={writesDisabled}
                      label={t("eventRun.awardContent")}
                      initial={r.content ?? ""}
                      max={500}
                      onSave={(v) =>
                        v !== (r.content ?? "") &&
                        saving.run(`content:${r.id}`, () => updateRank.mutateAsync({ rankId: r.id, input: { content: v || null } }))
                      }
                    />
                    {feedback(`content:${r.id}`)}
                  </Box>
                  <TextField
                    label={t("eventRun.awardWinner")}
                    select
                    SelectProps={{ displayEmpty: true }}
                    InputLabelProps={{ shrink: true }}
                    size="small"
                    value={winnerOf("rank", r.id)}
                    disabled={saving.busy || saving.blocked || !awards}
                    onChange={(e) => chooseWinner("rank", r.id, e.target.value)}
                  >
                    <MenuItem value="">{t("eventRun.notSelected")}</MenuItem>
                    {entryOptions.map((en) => (
                      <MenuItem key={en.id} value={en.id}>
                        {en.name}
                      </MenuItem>
                    ))}
                  </TextField>
                  {feedback(`winner:${r.id}`)}
                </Stack>
                <IconButton
                  color="error"
                  aria-label={t("common.delete")}
                  disabled={writesDisabled || saving.blocked}
                  onClick={() => void saving.run(`delete:${r.id}`, () => deleteRank.mutateAsync(r.id))}
                >
                  <DeleteIcon />
                </IconButton>
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mt: 2 }}>
        <CounterTextField
          size="small"
          label={t("eventRun.rankAwardNamePlaceholder")}
          value={rankName}
          disabled={writesDisabled}
          max={100}
          onChange={(e) => setRankName(e.target.value)}
          sx={{ flex: 1, minWidth: 0 }}
        />
        <Button
          variant="outlined"
          disabled={!rankName || writesDisabled || !awards}
          onClick={() =>
            saving.run("createRank", async () => { await createRank.mutateAsync({ name: rankName }); setRankName(""); })
          }
        >
          {t("eventRun.addRankAward")}
        </Button>
      </Stack>

      {feedback("createRank")}

      <Typography variant="subtitle2" fontWeight={600} sx={{ mt: 5, mb: 2 }}>
        {t("eventRun.specialAwardsHeading")}
      </Typography>
      <Stack spacing={2}>
        {awards?.specials.map((s) => (
          <Card key={`${s.id}:${resetVersion}`} variant="outlined">
            <CardContent>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Stack spacing={3} sx={{ flex: 1, minWidth: 0 }}>
                  <Box>
                    <BlurCounterField
                      fullWidth
                      disabled={writesDisabled}
                      label={t("eventRun.specialAwardName")}
                      initial={s.name}
                      max={100}
                      onSave={(v) =>
                        v &&
                        v !== s.name &&
                        saving.run(`name:${s.id}`, () => updateSpecial.mutateAsync({ specialId: s.id, input: { name: v } }))
                      }
                    />
                    {feedback(`name:${s.id}`)}
                  </Box>
                  <Box>
                    <BlurCounterField
                      fullWidth
                      disabled={writesDisabled}
                      label={t("eventRun.specialAwardContent")}
                      initial={s.content ?? ""}
                      max={500}
                      onSave={(v) =>
                        v !== (s.content ?? "") &&
                        saving.run(`content:${s.id}`, () => updateSpecial.mutateAsync({ specialId: s.id, input: { content: v || null } }))
                      }
                    />
                    {feedback(`content:${s.id}`)}
                  </Box>
                  <TextField
                    label={t("eventRun.awardWinner")}
                    select
                    SelectProps={{ displayEmpty: true }}
                    InputLabelProps={{ shrink: true }}
                    size="small"
                    value={winnerOf("special", s.id)}
                    disabled={saving.busy || saving.blocked || !awards}
                    onChange={(e) => chooseWinner("special", s.id, e.target.value)}
                  >
                    <MenuItem value="">
                      {t("eventDetail.noRecipient")}
                    </MenuItem>
                    {entryOptions.map((en) => (
                      <MenuItem key={en.id} value={en.id}>
                        {en.name}
                      </MenuItem>
                    ))}
                  </TextField>
                  {feedback(`winner:${s.id}`)}
                </Stack>
                <IconButton
                  color="error"
                  aria-label={t("common.delete")}
                  disabled={writesDisabled || saving.blocked}
                  onClick={() => void saving.run(`delete:${s.id}`, () => deleteSpecial.mutateAsync(s.id))}
                >
                  <DeleteIcon />
                </IconButton>
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mt: 2 }}>
        <CounterTextField
          size="small"
          label={t("eventRun.specialAwardNamePlaceholder")}
          value={specialName}
          disabled={writesDisabled}
          max={100}
          onChange={(e) => setSpecialName(e.target.value)}
          sx={{ flex: 1, minWidth: 0 }}
        />
        <Button
          variant="outlined"
          disabled={!specialName || writesDisabled || !awards}
          onClick={() =>
            saving.run("createSpecial", async () => { await createSpecial.mutateAsync({ name: specialName }); setSpecialName(""); })
          }
        >
          {t("eventRun.addSpecialAward")}
        </Button>
      </Stack>
      {feedback("createSpecial")}
    </Box>
  );
}
