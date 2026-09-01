import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  ToggleButton,
  ToggleButtonGroup,
  Card,
  CardContent,
  Chip,
  FormControlLabel,
  IconButton,
  LinearProgress,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import PollOutlinedIcon from "@mui/icons-material/PollOutlined";
import { Link as RouterLink, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { PreSurveyAdminView, SurveyQtype } from "@eventer/shared";
import { ApiError } from "../api/client.js";
import { useEvent } from "../api/hooks.js";
import {
  useClosePreSurvey,
  useDeletePreSurvey,
  usePreSurveyAdmin,
  usePreSurveyResults,
  useReopenPreSurvey,
  useRotatePreSurveyToken,
  useSavePreSurvey,
} from "../api/preSurveyHooks.js";
import { EventBreadcrumbs } from "../components/EventBreadcrumbs.js";
import { PreSurveyResponsesTable } from "../components/PreSurveyResponsesTable.js";
import { PreSurveyAccessCard } from "../components/PreSurveyAccessCard.js";

/** 回答形式 → 翻訳キー（#152 の編集UIと同じ表を使う） */
const QTYPE_KEY = {
  text: "eventForm.qtypeText",
  select: "eventForm.qtypeSelect",
  checkbox: "eventForm.qtypeCheckbox",
} as const satisfies Record<SurveyQtype, string>;

/** 編集中の1問。optionsText はカンマ（読点も可）区切り */
interface Row {
  key: string;
  id?: string;
  question: string;
  qtype: SurveyQtype;
  optionsText: string;
  required: boolean;
}

const parseOptions = (text: string): string[] =>
  text
    .split(/[,、]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

function newRow(): Row {
  return { key: crypto.randomUUID(), question: "", qtype: "text", optionsText: "", required: false };
}

function rowsFrom(view: PreSurveyAdminView): Row[] {
  return view.questions.map((q) => ({
    key: q.id,
    id: q.id,
    question: q.question,
    qtype: q.qtype,
    optionsText: q.options.join(", "),
    required: q.required,
  }));
}

/**
 * 開催前アンケートの管理ページ (#444)。スタッフ専用。
 * 作成/編集（一括保存）・共有URL（コピー・再発行）・締め切り・結果・削除。
 * 回答ページに出るのはここで書いたものだけ（イベント本体の情報は出ない）。
 */
export function EventPreSurveyAdminPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const { data: eventData } = useEvent(id);
  const isStaff = eventData?.myRole === "staff";
  const { data, error, refetch } = usePreSurveyAdmin(id, isStaff);
  const survey = data?.survey ?? null;
  // 「未作成」と言い切れるのは 404 だけ。一時失敗（500・回線断）を未作成扱いに
  // すると、空フォームの保存が既存の質問と回答を全置換で消してしまう（レビュー指摘）
  const notCreated = error instanceof ApiError && error.status === 404;
  const loadFailed = Boolean(error) && !notCreated && !survey;

  const save = useSavePreSurvey(id);
  const rotate = useRotatePreSurveyToken(id);
  const close = useClosePreSurvey(id);
  const reopen = useReopenPreSurvey(id);
  const remove = useDeletePreSurvey(id);
  const results = usePreSurveyResults(id, isStaff && Boolean(survey));

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [notice, setNotice] = useState<string | null>(null);
  // 結果の見せ方 (#447): 集計（既定）か、回答ごとの表か
  const [resultsView, setResultsView] = useState<"summary" | "table">("summary");
  const [failure, setFailure] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const busy =
    save.isPending || rotate.isPending || close.isPending || reopen.isPending || remove.isPending;

  useEffect(() => {
    if (survey && !loaded) {
      setTitle(survey.title);
      setDescription(survey.description);
      setRows(survey.questions.length > 0 ? rowsFrom(survey) : [newRow()]);
      setLoaded(true);
    }
  }, [survey, loaded]);

  if (eventData && !isStaff) {
    return <Alert severity="warning">{t("staffOps.preSurveyStaffOnly")}</Alert>;
  }
  if (loadFailed) {
    // 読み込み失敗時に編集フォームを出さない（空のまま保存→全置換の事故を防ぐ）
    return (
      <Alert
        severity="error"
        action={
          <Button color="inherit" size="small" onClick={() => void refetch()}>
            {t("common.retry")}
          </Button>
        }
      >
        {t("common.loadErrorReload")}
      </Alert>
    );
  }

  const setRow = (key: string, patch: Partial<Row>) =>
    setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (index: number, dir: -1 | 1) =>
    setRows((cur) => {
      const next = [...cur];
      const j = index + dir;
      if (j < 0 || j >= next.length) return cur;
      [next[index], next[j]] = [next[j]!, next[index]!];
      return next;
    });

  const onSave = () => {
    setNotice(null);
    setFailure(null);
    const questions = rows
      .filter((r) => r.question.trim().length > 0)
      .map((r) => ({
        id: r.id,
        question: r.question.trim(),
        qtype: r.qtype,
        options: r.qtype === "text" ? [] : parseOptions(r.optionsText),
        required: r.required,
      }));
    save.mutate(
      { title: title.trim(), description, questions },
      {
        onSuccess: (res) => {
          setNotice(t("staffOps.preSurveySaved"));
          // 応答の id を編集中の行へ反映する。反映しないと（特に新規作成の直後）
          // 次の保存が「id なし＝全部新規」になり、既存質問の全 DELETE →
          // 回答の CASCADE 消滅を引き起こす（レビュー指摘）
          if (res.survey) {
            setRows(
              res.survey.questions.length > 0
                ? rowsFrom(res.survey)
                : [newRow()],
            );
          }
        },
        onError: () => setFailure(t("staffOps.preSurveySaveFailed")),
      },
    );
  };

  const confirmed = (message: string, mutation: { mutate: (v: undefined, o?: object) => void }) => {
    if (!window.confirm(message)) return;
    setNotice(null);
    mutation.mutate(undefined);
  };

  const onDelete = () => {
    if (!window.confirm(t("staffOps.preSurveyDeleteConfirm"))) return;
    setNotice(null);
    remove.mutate(undefined, {
      onSuccess: () => {
        // 消した後のフォームに旧内容を残さない（そのまま保存すると復活してしまう）
        setTitle("");
        setDescription("");
        setRows([newRow()]);
        setLoaded(false);
      },
    });
  };

  const shareUrl = survey
    ? `${window.location.origin}/s/${survey.token}`
    : null;
  const res = results.data?.results;

  return (
    <Stack spacing={2}>
      {eventData && (
        <EventBreadcrumbs
          eventId={id}
          eventTitle={eventData.event.title}
          current={t("staffOps.preSurveyTitle")}
        />
      )}
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="h5" fontWeight={700} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <PollOutlinedIcon />
          {t("staffOps.preSurveyTitle")}
        </Typography>
        <Button size="small" startIcon={<ArrowBackIcon />} component={RouterLink} to={`/events/${id}`}>
          {t("staffOps.backToEventLink")}
        </Button>
        {survey && (
          <Chip
            size="small"
            color={survey.status === "open" ? "success" : "default"}
            label={t("staffOps.preSurveyResponses", { n: survey.responseCount })}
          />
        )}
      </Stack>
      <Typography variant="body2" color="text.secondary">
        {t("staffOps.preSurveyIntro")}
      </Typography>
      {eventData?.event.status === "published" && survey && survey.status === "open" && (
        <Alert severity="info">{t("staffOps.preSurveyPublishedNote")}</Alert>
      )}
      {notice && (
        <Alert severity="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}
      {failure && (
        <Alert severity="error" onClose={() => setFailure(null)}>
          {failure}
        </Alert>
      )}

      {/* 共有URLと状態（作成済みのときだけ） */}
      {survey && shareUrl && (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" gutterBottom>
              {t("staffOps.preSurveyShareHeading")}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
              {t("staffOps.preSurveyShareNote")}
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <TextField size="small" value={shareUrl} sx={{ minWidth: 280, flex: 1 }} InputProps={{ readOnly: true }} />
              <IconButton
                aria-label={t("staffOps.preSurveyCopyUrl")}
                onClick={() => {
                  void navigator.clipboard
                    .writeText(shareUrl)
                    .then(() => setNotice(t("staffOps.preSurveyCopied")));
                }}
              >
                <ContentCopyIcon fontSize="small" />
              </IconButton>
              <Button
                size="small"
                color="inherit"
                disabled={busy}
                onClick={() => confirmed(t("staffOps.preSurveyRotateConfirm"), rotate)}
              >
                {t("staffOps.preSurveyRotate")}
              </Button>
              {survey.status === "open" ? (
                <Button
                  size="small"
                  color="inherit"
                  disabled={busy}
                  onClick={() => confirmed(t("staffOps.preSurveyCloseConfirm"), close)}
                >
                  {t("staffOps.preSurveyClose")}
                </Button>
              ) : (
                <Button size="small" disabled={busy} onClick={() => reopen.mutate(undefined)}>
                  {t("staffOps.preSurveyReopen")}
                </Button>
              )}
              <Button size="small" color="error" disabled={busy} onClick={onDelete}>
                {t("staffOps.preSurveyDelete")}
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      {/* 編集フォーム（未作成なら作成フォームを兼ねる） */}
      <Card variant="outlined">
        <CardContent>
          <Stack spacing={2}>
            {/* ラベル付き・初期値が空の欄は shrink を固定する（#57 と同じ型）。
                webfont（Plus Jakarta Sans, font-display: swap）の適用が初回描画より
                遅れると、枠線の切り欠き（legend）がラベル幅と合わず線が文字を貫通する
                （タブ復帰の再描画で直る、が再現条件）。常時シュリンクなら値あり
                フィールドと同じ描画になり、切り欠きは最初から開いている */}
            <TextField
              label={t("staffOps.preSurveyFormTitle")}
              slotProps={{ inputLabel: { shrink: true } }}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              inputProps={{ maxLength: 100 }}
              fullWidth
            />
            <TextField
              label={t("staffOps.preSurveyFormDescription")}
              slotProps={{ inputLabel: { shrink: true } }}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              inputProps={{ maxLength: 2000 }}
              multiline
              minRows={2}
              fullWidth
            />
            {rows.map((row, i) => (
              <Box key={row.key} sx={{ p: 1.5, border: 1, borderColor: "divider", borderRadius: 1 }}>
                <Stack spacing={1}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <TextField
                      size="small"
                      label={t("eventForm.surveyQuestion")}
                      slotProps={{ inputLabel: { shrink: true } }}
                      value={row.question}
                      onChange={(e) => setRow(row.key, { question: e.target.value })}
                      inputProps={{ maxLength: 200 }}
                      sx={{ flex: 1 }}
                    />
                    <IconButton size="small" disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUpwardIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                      <ArrowDownwardIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      aria-label={t("common.delete")}
                      onClick={() => setRows((cur) => cur.filter((r) => r.key !== row.key))}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <TextField
                      select
                      size="small"
                      value={row.qtype}
                      onChange={(e) => setRow(row.key, { qtype: e.target.value as SurveyQtype })}
                      sx={{ minWidth: 140 }}
                    >
                      {(Object.keys(QTYPE_KEY) as SurveyQtype[]).map((qt) => (
                        <MenuItem key={qt} value={qt}>
                          {t(QTYPE_KEY[qt] as never)}
                        </MenuItem>
                      ))}
                    </TextField>
                    {row.qtype !== "text" && (
                      <TextField
                        size="small"
                        label={t("eventForm.surveyOptions")}
                        slotProps={{ inputLabel: { shrink: true } }}
                        placeholder={t("eventForm.surveyOptionsExample")}
                        value={row.optionsText}
                        onChange={(e) => setRow(row.key, { optionsText: e.target.value })}
                        sx={{ flex: 1, minWidth: 220 }}
                      />
                    )}
                    <FormControlLabel
                      control={
                        <Switch
                          size="small"
                          checked={row.required}
                          onChange={(e) => setRow(row.key, { required: e.target.checked })}
                        />
                      }
                      label={t("preSurvey.required")}
                    />
                  </Stack>
                </Stack>
              </Box>
            ))}
            <Box>
              <Button size="small" startIcon={<AddIcon />} onClick={() => setRows((cur) => [...cur, newRow()])}>
                {t("eventForm.surveyAddQuestion")}
              </Button>
            </Box>
            <Typography variant="caption" color="text.secondary">
              {t("staffOps.preSurveyEditNote")}
            </Typography>
            <Box>
              <Button
                variant="contained"
                disabled={busy || title.trim().length === 0}
                onClick={onSave}
              >
                {notCreated && !survey
                  ? t("staffOps.preSurveyCreate")
                  : t("staffOps.preSurveySave")}
              </Button>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      {/* 結果（staff のみ）。名前は出ない（サーバーが返さない） */}
      {survey && res && (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" gutterBottom>
              {t("staffOps.preSurveyResultsHeading")}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
              {t("staffOps.preSurveyResponses", { n: res.total })} ・{" "}
              {t("staffOps.preSurveyNamedCount", { n: res.named })}
            </Typography>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={resultsView}
              onChange={(_e, v: "summary" | "table" | null) => {
                if (v) setResultsView(v);
              }}
              sx={{ mb: 1.5 }}
            >
              <ToggleButton value="summary">
                {t("staffOps.preSurveyViewSummary")}
              </ToggleButton>
              <ToggleButton value="table">
                {t("staffOps.preSurveyViewTable")}
              </ToggleButton>
            </ToggleButtonGroup>
            {resultsView === "table" ? (
              <PreSurveyResponsesTable
                eventId={id}
                questions={survey.questions}
                enabled={isStaff}
              />
            ) : res.total === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {t("staffOps.preSurveyNoResponses")}
              </Typography>
            ) : (
              <Stack spacing={2}>
                {res.choices.map(({ question, counts, answered }) => (
                  <Box key={question.id}>
                    <Typography variant="subtitle2" gutterBottom>
                      {question.question}
                    </Typography>
                    <Stack spacing={0.5}>
                      {question.options.map((opt, i) => {
                        const n = counts[i] ?? 0;
                        const pct = answered > 0 ? Math.round((n / answered) * 100) : 0;
                        return (
                          <Box key={opt}>
                            <Stack direction="row" justifyContent="space-between">
                              <Typography variant="body2">{opt}</Typography>
                              <Typography variant="body2" color="text.secondary">
                                {n} ({pct}%)
                              </Typography>
                            </Stack>
                            <LinearProgress variant="determinate" value={pct} sx={{ height: 6, borderRadius: 3 }} />
                          </Box>
                        );
                      })}
                    </Stack>
                  </Box>
                ))}
                {res.texts.map(({ question, answers }) => (
                  <Box key={question.id}>
                    <Typography variant="subtitle2" gutterBottom>
                      {question.question}
                    </Typography>
                    <Stack spacing={0.5}>
                      {answers.map((a, i) => (
                        <Typography
                          key={`${a.createdAt}-${i}`}
                          variant="body2"
                          sx={{ whiteSpace: "pre-wrap", borderLeft: 2, borderColor: "divider", pl: 1 }}
                        >
                          {a.value}
                        </Typography>
                      ))}
                    </Stack>
                  </Box>
                ))}
              </Stack>
            )}
          </CardContent>
        </Card>
      )}

      {/* 日毎アクセス (#450)。アンケート作成済みのときだけ */}
      {survey && <PreSurveyAccessCard eventId={id} enabled={isStaff} />}
    </Stack>
  );
}
