import {
  Box,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import { useTranslation } from "react-i18next";
import type {
  PreSurveyQuestion,
  PreSurveyResponseRowView,
} from "@eventer/shared";
import { surveyValueLabel } from "@eventer/shared";
import { usePreSurveyResponses } from "../api/preSurveyHooks.js";
import { downloadCsv } from "../lib/csv.js";
import { formatDateTime } from "../lib/format.js";

/**
 * 開催前アンケートの回答一覧 (#447)。行=1送信、列=回答日時・回答者・各質問。
 *
 * - 値の表示は #152 と同じ `surveyValueLabel` の1か所（複数選択は「、」連結）
 * - 表は **`overflow-x: auto` のコンテナ内で横スクロール**（質問が多くても
 *   ページ全体を横に伸ばさない。スマホでも枠内スクロールで崩れない）
 * - CSV は表と同じデータからクライアント側で生成（BOM 付き・RFC 4180 は
 *   lib/csv.ts の1か所）
 */
export function PreSurveyResponsesTable({
  eventId,
  questions,
  enabled,
}: {
  eventId: string;
  questions: PreSurveyQuestion[];
  enabled: boolean;
}) {
  const { t } = useTranslation();
  const { data } = usePreSurveyResponses(eventId, enabled);
  const rows = data?.rows ?? [];

  const cellsOf = (row: PreSurveyResponseRowView): string[] => [
    formatDateTime(row.createdAt),
    row.respondent ?? t("staffOps.preSurveyAnonRespondent"),
    ...questions.map((q) =>
      surveyValueLabel(q.qtype, row.answers[q.id] ?? ""),
    ),
  ];

  const onDownload = () => {
    downloadCsv(t("staffOps.preSurveyCsvFileName"), [
      [
        t("staffOps.preSurveyColTime"),
        t("staffOps.preSurveyColRespondent"),
        ...questions.map((q) => q.question),
      ],
      ...rows.map(cellsOf),
    ]);
  };

  if (rows.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t("staffOps.preSurveyNoResponses")}
      </Typography>
    );
  }
  return (
    <Box>
      <Button
        size="small"
        startIcon={<DownloadIcon />}
        onClick={onDownload}
        sx={{ mb: 1 }}
      >
        {t("staffOps.preSurveyCsvDownload")}
      </Button>
      {/* 横に長い表はこの枠の中だけでスクロールさせる（ページは伸ばさない） */}
      <Box sx={{ overflowX: "auto" }}>
        <Table size="small" sx={{ minWidth: 480 }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ whiteSpace: "nowrap" }}>
                {t("staffOps.preSurveyColTime")}
              </TableCell>
              <TableCell sx={{ whiteSpace: "nowrap" }}>
                {t("staffOps.preSurveyColRespondent")}
              </TableCell>
              {questions.map((q) => (
                <TableCell key={q.id} sx={{ minWidth: 120 }}>
                  {q.question}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row, i) => (
              <TableRow key={`${row.createdAt}-${i}`}>
                {cellsOf(row).map((cell, j) => (
                  <TableCell
                    key={j}
                    sx={{
                      whiteSpace: j <= 1 ? "nowrap" : "pre-wrap",
                      verticalAlign: "top",
                    }}
                  >
                    {cell}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Box>
  );
}
