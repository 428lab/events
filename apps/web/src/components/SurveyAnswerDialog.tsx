import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { SurveyQuestion } from "@eventer/shared";
import { parseCheckboxValue } from "@eventer/shared";
import {
  useMySurveyAnswers,
  useSubmitSurveyAnswers,
} from "../api/eventSurveyHooks.js";

/** 事前アンケートの回答フォーム (#152)。参加登録前の回答と、参加後の編集に共用。 */
export function SurveyAnswerDialog({
  eventId,
  questions,
  open,
  onClose,
  onSubmitted,
  submitLabel = "回答して参加する",
}: {
  eventId: string;
  questions: SurveyQuestion[];
  open: boolean;
  onClose: () => void;
  /** 回答の保存に成功したら呼ばれる（参加フローはここで join を続行） */
  onSubmitted?: () => void;
  submitLabel?: string;
}) {
  const { data: myAnswers } = useMySurveyAnswers(eventId, open);
  const submit = useSubmitSurveyAnswers(eventId);
  // questionId → 値（checkbox は string[]、それ以外は string）
  const [values, setValues] = useState<Record<string, string | string[]>>({});
  const [showErrors, setShowErrors] = useState(false);

  // 開いたときに自分の既存回答でプリフィルする（読込完了後に一度だけ。入力中の上書き防止）
  useEffect(() => {
    if (!open || myAnswers === undefined) return;
    const byId = new Map(myAnswers.map((a) => [a.questionId, a.value]));
    setValues(
      Object.fromEntries(
        questions.map((q) => {
          const saved = byId.get(q.id) ?? "";
          return [
            q.id,
            q.qtype === "checkbox" ? parseCheckboxValue(saved) : saved,
          ];
        }),
      ),
    );
    setShowErrors(false);
    submit.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, myAnswers, questions]);

  const isEmpty = (q: SurveyQuestion) => {
    const v = values[q.id];
    return Array.isArray(v) ? v.length === 0 : !(v ?? "").trim();
  };
  const missingRequired = questions.filter((q) => q.required && isEmpty(q));

  const handleSubmit = () => {
    if (missingRequired.length > 0) {
      setShowErrors(true);
      return;
    }
    submit.mutate(
      questions.map((q) => {
        const v = values[q.id] ?? (q.qtype === "checkbox" ? [] : "");
        return {
          questionId: q.id,
          value: Array.isArray(v) ? v : v.trim(),
        };
      }),
      {
        onSuccess: () => {
          onClose();
          onSubmitted?.();
        },
      },
    );
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>参加アンケート</DialogTitle>
      <DialogContent>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
          回答はこのイベントのスタッフだけが閲覧できます。
        </Typography>
        <Stack spacing={2.5}>
          {questions.map((q) => {
            const error = showErrors && q.required && isEmpty(q);
            const label = q.required ? `${q.question} *` : q.question;
            if (q.qtype === "select") {
              return (
                <FormControl key={q.id} error={error}>
                  <FormLabel sx={{ fontSize: 14 }}>{label}</FormLabel>
                  <RadioGroup
                    value={(values[q.id] as string) ?? ""}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [q.id]: e.target.value }))
                    }
                  >
                    {q.options.map((o) => (
                      <FormControlLabel
                        key={o}
                        value={o}
                        control={<Radio size="small" />}
                        label={o}
                      />
                    ))}
                  </RadioGroup>
                  {error && (
                    <Typography variant="caption" color="error">
                      選択してください
                    </Typography>
                  )}
                </FormControl>
              );
            }
            if (q.qtype === "checkbox") {
              const selected = (values[q.id] as string[]) ?? [];
              return (
                <FormControl key={q.id} error={error}>
                  <FormLabel sx={{ fontSize: 14 }}>{label}</FormLabel>
                  <FormGroup>
                    {q.options.map((o) => (
                      <FormControlLabel
                        key={o}
                        control={
                          <Checkbox
                            size="small"
                            checked={selected.includes(o)}
                            onChange={(e) =>
                              setValues((v) => ({
                                ...v,
                                [q.id]: e.target.checked
                                  ? [...selected, o]
                                  : selected.filter((x) => x !== o),
                              }))
                            }
                          />
                        }
                        label={o}
                      />
                    ))}
                  </FormGroup>
                  {error && (
                    <Typography variant="caption" color="error">
                      1つ以上選択してください
                    </Typography>
                  )}
                </FormControl>
              );
            }
            return (
              <TextField
                key={q.id}
                label={label}
                size="small"
                value={(values[q.id] as string) ?? ""}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [q.id]: e.target.value }))
                }
                error={error}
                helperText={error ? "入力してください" : undefined}
                inputProps={{ maxLength: 500 }}
                fullWidth
              />
            );
          })}
          {submit.isError && (
            <Alert severity="error">回答の送信に失敗しました。</Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submit.isPending}>
          キャンセル
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={submit.isPending}
        >
          {submitLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
