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
import type { SurveyQtype } from "@eventer/shared";
import { SURVEY_TEMPLATES } from "@eventer/shared";
import {
  useEventSurvey,
  useSaveSurveyQuestions,
} from "../api/eventSurveyHooks.js";

const QTYPE_LABEL: Record<SurveyQtype, string> = {
  text: "自由記述",
  select: "単一選択",
  checkbox: "複数選択",
};

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
  const { data: questions } = useEventSurvey(eventId);
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
    const template = SURVEY_TEMPLATES.find((t) => t.key === templateKey);
    if (!template) return;
    if (
      rows.length > 0 &&
      !window.confirm(
        "現在の質問をテンプレートで置き換えますか？（保存すると既存質問の回答は消えます）",
      )
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
    if (r.question.trim().length === 0) return "質問を入力してください";
    if (r.qtype !== "text" && parseOptions(r.optionsText).length === 0) {
      return "選択肢をカンマ区切りで1つ以上入力してください";
    }
    return null;
  };
  const canSave = rows.every((r) => rowError(r) === null);

  const submit = () =>
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

  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>
        参加アンケート
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
        参加登録時に回答してもらう質問です（入館用の氏名・所属の収集など）。必須の質問に未回答の人は参加登録できません。回答はスタッフだけが閲覧できます。
      </Typography>

      <Stack spacing={1.5}>
        {rows.map((row, i) => (
          <Card key={row.key} variant="outlined" sx={{ p: 1.5 }}>
            <Stack direction="row" spacing={1} alignItems="flex-start">
              <Stack spacing={1} sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                  <TextField
                    label="質問"
                    size="small"
                    value={row.question}
                    onChange={(e) => update(i, { question: e.target.value })}
                    inputProps={{ maxLength: 200 }}
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    label="回答形式"
                    select
                    size="small"
                    value={row.qtype}
                    onChange={(e) =>
                      update(i, { qtype: e.target.value as SurveyQtype })
                    }
                    sx={{ width: { xs: "100%", sm: 140 } }}
                  >
                    {(Object.keys(QTYPE_LABEL) as SurveyQtype[]).map((t) => (
                      <MenuItem key={t} value={t}>
                        {QTYPE_LABEL[t]}
                      </MenuItem>
                    ))}
                  </TextField>
                </Stack>
                {row.qtype !== "text" && (
                  <TextField
                    label="選択肢（カンマ区切り）"
                    size="small"
                    value={row.optionsText}
                    onChange={(e) => update(i, { optionsText: e.target.value })}
                    error={parseOptions(row.optionsText).length === 0}
                    helperText="例: 参加, 不参加"
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
                      必須（未回答だと参加登録できない）
                    </Typography>
                  }
                />
              </Stack>
              <Stack spacing={0} sx={{ flexShrink: 0 }}>
                <IconButton
                  size="small"
                  disabled={i === 0}
                  onClick={() => move(i, i - 1)}
                  title="上へ移動"
                >
                  <ArrowUpwardIcon fontSize="small" />
                </IconButton>
                <IconButton
                  size="small"
                  disabled={i === rows.length - 1}
                  onClick={() => move(i, i + 1)}
                  title="下へ移動"
                >
                  <ArrowDownwardIcon fontSize="small" />
                </IconButton>
                <IconButton
                  size="small"
                  onClick={() => {
                    if (
                      row.id &&
                      !window.confirm(
                        "この質問を削除しますか？（保存すると集まった回答も削除されます）",
                      )
                    ) {
                      return;
                    }
                    setRows((rs) => (rs ? rs.filter((_, j) => j !== i) : rs));
                  }}
                  title="この質問を削除"
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Stack>
            </Stack>
          </Card>
        ))}

        {save.isError && (
          <Alert severity="error">アンケートの保存に失敗しました。</Alert>
        )}
        {save.isSuccess && !save.isPending && (
          <Alert severity="success">アンケートを保存しました。</Alert>
        )}

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button
            size="small"
            variant="outlined"
            startIcon={<AddIcon />}
            disabled={rows.length >= 20}
            onClick={() => setRows((rs) => (rs ? [...rs, newRow()] : rs))}
          >
            質問を追加
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<PlaylistAddIcon />}
            onClick={(e) => setTemplateAnchor(e.currentTarget)}
          >
            テンプレから作成
          </Button>
          <Menu
            anchorEl={templateAnchor}
            open={Boolean(templateAnchor)}
            onClose={() => setTemplateAnchor(null)}
          >
            {SURVEY_TEMPLATES.map((t) => (
              <MenuItem key={t.key} onClick={() => applyTemplate(t.key)}>
                {t.name}
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
            アンケートを保存
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}
