import { useCallback, useEffect, useState } from "react";
import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import type { Score, ScoringCriterion } from "@eventer/shared";
import { useSaveScores } from "../api/scoringHooks.js";
import { errorMessage } from "../lib/errorMessage.js";
import { useDeckLeaveWarning } from "../lib/useDeckLeaveWarning.js";

/** 採点ページ・発表画面で、未保存の採点があるかをまとめて持つ。あればページを離れる前に確かめる
 * （閉じる・再読み込み・アプリ内リンク・戻る。スライド編集と同じ仕組み） */
export function useUnsavedScores(): (entryId: string, dirty: boolean) => void {
  const { t } = useTranslation();
  const [dirtyEntries, setDirtyEntries] = useState<ReadonlySet<string>>(new Set());
  useDeckLeaveWarning(dirtyEntries.size > 0, t("eventRun.scoreLeaveConfirm"));
  return useCallback((entryId: string, dirty: boolean) => {
    setDirtyEntries((prev) => {
      if (prev.has(entryId) === dirty) return prev;
      const next = new Set(prev);
      if (dirty) next.add(entryId); else next.delete(entryId);
      return next;
    });
  }, []);
}

/** 1つのエントリーの採点。点数を押しても通信しない（画面の中で選ぶだけ）。
 * 「採点を保存」で、変えた項目をまとめて1回で保存する（書き込み回数を使わない。
 * オーナー決定 2026-11-08）。未保存の変更があるあいだは onDirtyChange(true) を返し、
 * ページ側がページを離れるときに確かめる */
export function ScoringPanel({
  eventId,
  entryId,
  criteria,
  myScores,
  disabled,
  disabledNote,
  onDirtyChange,
}: {
  eventId: string;
  entryId: string;
  criteria: ScoringCriterion[];
  myScores: Score[];
  disabled?: boolean;
  /** 押せないときの説明。省略時は自己採点・締切の説明 */
  disabledNote?: string;
  onDirtyChange?: (entryId: string, dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const save = useSaveScores(eventId);
  // 保存前に選んだ点数（criterionId → value）。保存済みの値と同じなら持たない
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [saved, setSaved] = useState(false);

  const savedValue = (criterionId: string) =>
    myScores.find((s) => s.entryId === entryId && s.criterionId === criterionId)
      ?.value ?? null;
  const changed = Object.entries(draft).filter(([criterionId, value]) => savedValue(criterionId) !== value);
  const dirty = changed.length > 0;

  useEffect(() => {
    onDirtyChange?.(entryId, dirty);
  }, [dirty, entryId, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(entryId, false), [entryId, onDirtyChange]);

  const choose = (criterionId: string, value: number) => {
    setSaved(false);
    save.reset();
    setDraft((d) => ({ ...d, [criterionId]: value }));
  };

  const submit = () =>
    save.mutate(
      { entryId, scores: changed.map(([criterionId, value]) => ({ criterionId, value })) },
      {
        onSuccess: () => {
          setDraft({});
          setSaved(true);
        },
      },
    );

  return (
    <Stack spacing={2.5}>
      {criteria.map((c) => {
        const current = draft[c.id] ?? savedValue(c.id);
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
                  aria-pressed={current === v}
                  disabled={disabled || save.isPending}
                  onClick={() => choose(c.id, v)}
                  sx={{ minWidth: 44 }}
                >
                  {v}
                </Button>
              ))}
            </Stack>
          </Box>
        );
      })}
      {disabled ? (
        <Typography variant="caption" color="text.secondary">
          {disabledNote ?? t("eventRun.scoringDisabledNote")}
        </Typography>
      ) : (
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
          <Button variant="contained" disabled={!dirty || save.isPending} onClick={submit}>
            {t(save.isPending ? "eventRun.scoreSaving" : "eventRun.scoreSave")}
          </Button>
          {dirty && !save.isPending && (
            <Typography variant="body2" color="warning.main">{t("eventRun.scoreUnsaved")}</Typography>
          )}
          {saved && !dirty && (
            <Typography variant="body2" color="success.main">{t("eventRun.scoreSaved")}</Typography>
          )}
        </Stack>
      )}
      {save.isError && <Alert severity="error">{errorMessage(save.error)}</Alert>}
    </Stack>
  );
}
