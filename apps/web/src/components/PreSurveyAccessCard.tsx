import {
  Box,
  Card,
  CardContent,
  Stack,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import type { PreSurveyAccessRow } from "@eventer/shared";
import { addDays, diffDays } from "@eventer/shared";
import { usePreSurveyAccess } from "../api/preSurveyHooks.js";

/** 期間内の抜けた日を 0 で埋める（新しい順のまま）。サーバーは疎な行だけを
 * 返し、連続日付はここ（表示側）の責務。加減算は shared の addDays を使う */
export function fillDayGaps(rows: PreSurveyAccessRow[]): PreSurveyAccessRow[] {
  if (rows.length <= 1) return rows;
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const newest = rows[0].day;
  const oldest = rows[rows.length - 1].day;
  const out: PreSurveyAccessRow[] = [];
  for (let back = 0; back <= diffDays(oldest, newest); back++) {
    const day = addDays(newest, -back);
    out.push(byDay.get(day) ?? { day, views: 0, responses: 0 });
  }
  return out;
}

/**
 * 開催前アンケートの日毎アクセス (#450)。日付・表示数・回答数の表と、
 * 推移が見える CSS のみの簡易バー（チャートライブラリは入れない）。
 * 保存されているのは日毎の件数だけで、個人を特定する情報は無い（注記を表示）。
 */
export function PreSurveyAccessCard({
  eventId,
  enabled,
}: {
  eventId: string;
  enabled: boolean;
}) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = usePreSurveyAccess(eventId, enabled);
  // 取得中は何も出さず、失敗は短く伝える（黙って消えると「アクセス0」と誤読される）
  if (isLoading) return null;
  if (isError || !data) {
    return (
      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" gutterBottom>
            {t("staffOps.preSurveyAccessHeading")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("common.loadErrorReload")}
          </Typography>
        </CardContent>
      </Card>
    );
  }
  const rows = fillDayGaps(data.rows);
  const max = Math.max(1, ...rows.map((r) => r.views));

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          {t("staffOps.preSurveyAccessHeading")}
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
          {t("staffOps.preSurveyAccessNote")}
        </Typography>
        {rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t("staffOps.preSurveyAccessEmpty")}
          </Typography>
        ) : (
          <Stack spacing={0.5}>
            {/* 見出し行 */}
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="caption" color="text.secondary" sx={{ width: 92 }}>
                {t("staffOps.preSurveyAccessDay")}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                {t("staffOps.preSurveyAccessViews")}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ width: 48, textAlign: "right" }}>
                {t("staffOps.preSurveyAccessResponses")}
              </Typography>
            </Stack>
            {rows.map((r) => (
              <Stack key={r.day} direction="row" spacing={1} alignItems="center">
                <Typography variant="body2" sx={{ width: 92, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                  {r.day}
                </Typography>
                {/* CSSのみの簡易バー（最大表示数を100%として比率で塗る） */}
                <Box sx={{ flex: 1, display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
                  <Box
                    sx={{
                      height: 10,
                      borderRadius: 5,
                      bgcolor: "primary.main",
                      opacity: 0.7,
                      width: `${(r.views / max) * 100}%`,
                      minWidth: r.views > 0 ? 4 : 0,
                    }}
                  />
                  <Typography variant="body2" sx={{ flexShrink: 0 }}>
                    {r.views}
                  </Typography>
                </Box>
                <Typography variant="body2" sx={{ width: 48, textAlign: "right", flexShrink: 0 }}>
                  {r.responses}
                </Typography>
              </Stack>
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
