import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  FormControlLabel,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import PlaylistAddIcon from "@mui/icons-material/PlaylistAdd";
import { useTranslation } from "react-i18next";
import type { SurveyQtype } from "@eventer/shared";
import { SURVEY_TEMPLATES } from "@eventer/shared";
import {
  useEventSurvey,
  useSaveSurveyQuestions,
  useSurveyAnswers,
} from "../api/eventSurveyHooks.js";
import { tDynamic } from "../i18n/index.js";

/** 回答形式 (`SurveyQtype`) → 翻訳キー。**選ばせる順番はこの並びが持つ** */
const QTYPE_KEY = {
  text: "eventForm.qtypeText",
  select: "eventForm.qtypeSelect",
  checkbox: "eventForm.qtypeCheckbox",
} as const satisfies Record<SurveyQtype, string>;

/** 編集中の1行。optionsText はカンマ区切りの選択肢入力 */
interface Row {
  key: string;
  id?: string;
  question: string;
  qtype: SurveyQtype;
  optionsText: string;
  required: boolean;
}

function newRow(partial?: Partial<Omit<Row, "key">>): Row {
  return {
    key: crypto.randomUUID(),
    question: "",
    qtype: "text",
    optionsText: "",
    required: false,
    ...partial,
  };
}

/** カンマ（読点も可）区切りの選択肢入力を配列にする */
function parseOptions(text: string): string[] {
  return text
    .split(/[,、]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 20);
}

/** 参加時の事前アンケートの質問編集 (#152)。staff 用。
 * 既存質問は id を保持したまま保存するので、文言修正では回答が消えない。 */
export function SurveyQuestionsEditor({ eventId }: { eventId: string }) {
  const { t } = useTranslation();
  const { data: questions } = useEventSurvey(eventId);
  // 破壊的変更の警告用に回答件数を取得（このコンポーネントは staff ページ内でのみ描画）
  const { data: answersData } = useSurveyAnswers(eventId, true);
  const save = useSaveSurveyQuestions(eventId);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [templateAnchor, setTemplateAnchor] = useState<null | HTMLElement>(null);

  // サーバーの質問が読めたらフォームを初期化（保存後の再取得では上書きしない）
  useEffect(() => {
    if (questions && rows === null) {
      setRows(
        questions.map((q) =>
          newRow({
            id: q.id,
            question: q.question,
            qtype: q.qtype,
            optionsText: q.options.join(", "),
            required: q.required,
          }),
        ),
      );
    }
  }, [questions, rows]);

  if (!rows) return null;

  const update = (i: number, patch: Partial<Row>) =>
    setRows((rs) => (rs ? rs.map((r, j) => (j === i ? { ...r, ...patch } : r)) : rs));

  const move = (from: number, to: number) =>
    setRows((rs) => {
      if (!rs || to < 0 || to >= rs.length) return rs;
      const next = [...rs];
      const [row] = next.splice(from, 1);
      next.splice(to, 0, row);
      return next;
    });

  const applyTemplate = (templateKey: string) => {
    setTemplateAnchor(null);
    const template = SURVEY_TEMPLATES.find((tpl) => tpl.key === templateKey);
    if (!template) return;
    if (
      rows.length > 0 &&
      !window.confirm(t("eventForm.surveyTemplateConfirm"))
    ) {
      return;
    }
    setRows(
      template.questions.map((q) =>
        newRow({
          question: q.question,
          qtype: q.qtype,
          optionsText: q.options.join(", "),
          required: q.required,
        }),
      ),
    );
  };

  const rowError = (r: Row): string | null => {
    if (r.question.trim().length === 0) {
      return t("eventForm.surveyQuestionRequired");
    }
    if (r.qtype !== "text" && parseOptions(r.optionsText).length === 0) {
      return t("eventForm.surveyOptionsRequired");
    }
    return null;
  };
  const canSave = rows.every((r) => rowError(r) === null);

  /** questionId ごとの回答件数 */
  const answerCountOf = (questionId: string): number =>
    (answersData?.rows ?? []).filter((r) => (r.answers[questionId] ?? "") !== "")
      .length;

  const submit = () => {
    // 破壊的変更（回答済み質問の削除・タイプ変更）の影響件数を集計して確認
    if (questions) {
      const keptIds = new Set(rows.map((r) => r.id).filter(Boolean));
      let lost = 0;
      for (const q of questions) {
        if (!keptIds.has(q.id)) lost += answerCountOf(q.id);
        else {
          const row = rows.find((r) => r.id === q.id);
          if (row && row.qtype !== q.qtype) lost += answerCountOf(q.id);
        }
      }
      if (
        lost > 0 &&
        // 単数用と複数用のどちらを使うかは**数だけ**で決まる（日本語は同じ綴り）
        !window.confirm(
          t(lost === 1 ? "eventForm.surveyLoseAnswer" : "eventForm.surveyLoseAnswers", {
            n: lost,
          }),
        )
      ) {
        return;
      }
    }
    save.mutate(
      rows.map((r) => ({
        ...(r.id ? { id: r.id } : {}),
        question: r.question.trim(),
        qtype: r.qtype,
        options: r.qtype === "text" ? [] : parseOptions(r.optionsText),
        required: r.required,
      })),
      { onSuccess: (res) => {
          // 新規質問に付与された id を取り込む（次の保存で回答を保持できるように）
          setRows(
            res.questions.map((q) =>
              newRow({
                id: q.id,
                question: q.question,
                qtype: q.qtype,
                optionsText: q.options.join(", "),
                required: q.required,
              }),
            ),
          );
        } },
    );
  };

  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>
        {t("eventForm.surveyHeading")}
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
        {t("eventForm.surveyHelp")}
        {(answersData?.rows.length ?? 0) > 0 && (
          <>
            <br />
            {t("eventForm.surveyAnswersExist")}
          </>
        )}
      </Typography>

      <Stack spacing={1.5}>
        {rows.map((row, i) => (
          <Card key={row.key} variant="outlined" sx={{ p: 1.5 }}>
            <Stack direction="row" spacing={1} alignItems="flex-start">
              <Stack spacing={1} sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                  <TextField
                    label={t("eventForm.surveyQuestion")}
                    size="small"
                    value={row.question}
                    onChange={(e) => update(i, { question: e.target.value })}
                    inputProps={{ maxLength: 200 }}
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    label={t("eventForm.surveyQtype")}
                    select
                    size="small"
                    value={row.qtype}
                    onChange={(e) =>
                      update(i, { qtype: e.target.value as SurveyQtype })
                    }
                    sx={{ width: { xs: "100%", sm: 140 } }}
                  >
                    {(Object.keys(QTYPE_KEY) as SurveyQtype[]).map((qt) => (
                      <MenuItem key={qt} value={qt}>
                        {t(QTYPE_KEY[qt])}
                      </MenuItem>
                    ))}
                  </TextField>
                </Stack>
                {row.qtype !== "text" && (
                  <TextField
                    label={t("eventForm.surveyOptions")}
                    size="small"
                    value={row.optionsText}
                    onChange={(e) => update(i, { optionsText: e.target.value })}
                    error={parseOptions(row.optionsText).length === 0}
                    helperText={t("eventForm.surveyOptionsExample")}
                    fullWidth
                  />
                )}
                <FormControlLabel
                  control={
                    <Switch
                      size="small"
                      checked={row.required}
                      onChange={(e) => update(i, { required: e.target.checked })}
                    />
                  }
                  label={
                    <Typography variant="body2">
                      {t("eventForm.surveyRequired")}
                    </Typography>
                  }
                />
              </Stack>
              <Stack spacing={0} sx={{ flexShrink: 0 }}>
                <IconButton
                  size="small"
                  disabled={i === 0}
                  onClick={() => move(i, i - 1)}
                  title={t("common.moveUp")}
                >
                  <ArrowUpwardIcon fontSize="small" />
                </IconButton>
                <IconButton
                  size="small"
                  disabled={i === rows.length - 1}
                  onClick={() => move(i, i + 1)}
                  title={t("common.moveDown")}
                >
                  <ArrowDownwardIcon fontSize="small" />
                </IconButton>
                <IconButton
                  size="small"
                  onClick={() => {
                    if (
                      row.id &&
                      !window.confirm(t("eventForm.surveyDeleteConfirm"))
                    ) {
                      return;
                    }
                    setRows((rs) => (rs ? rs.filter((_, j) => j !== i) : rs));
                  }}
                  title={t("eventForm.surveyDeleteQuestion")}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Stack>
            </Stack>
          </Card>
        ))}

        {save.isError && (
          <Alert severity="error">{t("eventForm.surveySaveError")}</Alert>
        )}
        {save.isSuccess && !save.isPending && (
          <Alert severity="success">{t("eventForm.surveySaved")}</Alert>
        )}

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button
            size="small"
            variant="outlined"
            startIcon={<AddIcon />}
            disabled={rows.length >= 20}
            onClick={() => setRows((rs) => (rs ? [...rs, newRow()] : rs))}
          >
            {t("eventForm.surveyAddQuestion")}
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<PlaylistAddIcon />}
            onClick={(e) => setTemplateAnchor(e.currentTarget)}
          >
            {t("eventForm.surveyFromTemplate")}
          </Button>
          <Menu
            anchorEl={templateAnchor}
            open={Boolean(templateAnchor)}
            onClose={() => setTemplateAnchor(null)}
          >
            {SURVEY_TEMPLATES.map((tpl) => (
              <MenuItem key={tpl.key} onClick={() => applyTemplate(tpl.key)}>
                {/* テンプレは足せるので tDynamic。受け皿は定義側の日本語 */}
                {tDynamic(`eventForm.surveyTemplateName_${tpl.key}`, tpl.name)}
              </MenuItem>
            ))}
          </Menu>
          <Box sx={{ flex: 1 }} />
          <Button
            size="small"
            variant="contained"
            onClick={submit}
            disabled={!canSave || save.isPending}
          >
            {t("eventForm.surveySave")}
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}
