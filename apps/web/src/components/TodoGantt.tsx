import { Box, Stack, Typography } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { useTranslation } from "react-i18next";
import {
  TODO_LABEL_PX,
  TODO_ROW_PX,
  dependencyLines,
  type GanttLayout,
  type TodoDerived,
} from "../lib/todoGantt.js";
import { todoAssigneeLabel } from "./TodoRow.js";

/** 見出し行の高さ */
const HEAD_PX = 30;
/** 日付を1日ずつ書ける列幅の下限。これより細いと数字が読めないので月の目盛りだけ */
const DAY_LABEL_MIN_PX = 18;

/**
 * 準備の段取りのガント (#393)。**外部ライブラリを足さない**（設計 8.3）。
 *
 * 位置は `lib/todoGantt.ts` の純関数が全部決めている。ここは CSS Grid に流し込む
 * だけで、**DOM を測らない**（`ResizeObserver` も ref も無い）。
 *
 * 帯の `gridColumn` / `gridRow` は inline style で当てる。帯ごとに値が違うので、
 * `sx` に入れるとクラスが帯の数だけ増える（`TimetableGrid.tsx` と同じ理由）。
 *
 * 依存の線は**選んだ行のときだけ**描く（案D3）。常に描くと狭い画面で必ず絡まり、
 * 絡まった線は無いのと同じになる。
 */
export function TodoGantt({
  layout,
  derived,
  selectedId,
  onSelect,
}: {
  layout: GanttLayout;
  derived: TodoDerived[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  if (layout.days === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t("staffOps.todoGanttEmpty")}
      </Typography>
    );
  }

  const rows = derived.length;
  const { dayPx } = layout;
  const showDayNumbers = dayPx >= DAY_LABEL_MIN_PX;
  const lines = dependencyLines(layout, derived, selectedId);
  const byId = new Map(derived.map((d) => [d.todo.id, d]));

  return (
    <Stack spacing={0.5}>
      {/* 役割・ラベル・フォーカスは**スクロールするこの外側**に置く。内側に付けると
          キーボードだけの人が横スクロールの器にたどり着けない。格子で描いているだけで
          表の構造（行・セル）は持たないので role は region にする */}
      <Box
        role="region"
        aria-label={t("staffOps.todoGanttTitle")}
        tabIndex={0}
        sx={{
          overflow: "auto",
          maxHeight: { xs: "none", md: "min(560px, 60vh)" },
          overscrollBehaviorX: "contain",
          border: 1,
          borderColor: "divider",
          borderRadius: 2,
          bgcolor: "background.paper",
        }}
      >
        <Box
          sx={{
            display: "grid",
            minWidth: "max-content",
            gridTemplateColumns: `${TODO_LABEL_PX}px repeat(${layout.days}, ${dayPx}px)`,
            gridTemplateRows: `${HEAD_PX}px repeat(${rows}, ${TODO_ROW_PX}px)`,
          }}
        >
          {/* 土日の網掛け。帯より下に敷く */}
          {layout.columns.map((col, i) =>
            col.isWeekend ? (
              <Box
                key={`we-${col.date}`}
                style={{ gridColumn: String(i + 2), gridRow: "2 / -1" }}
                sx={{
                  bgcolor: alpha(theme.palette.text.primary, 0.05),
                  pointerEvents: "none",
                }}
              />
            ) : null,
          )}

          {/* 今日の縦線。遅れを読む基準なので、帯より上に出す */}
          {layout.todayCol !== null && (
            <Box
              style={{
                gridColumn: String(layout.todayCol + 2),
                gridRow: "1 / -1",
              }}
              sx={{
                position: "relative",
                zIndex: 4,
                borderLeft: "2px solid",
                borderLeftColor: alpha(theme.palette.primary.main, 0.7),
                pointerEvents: "none",
              }}
            />
          )}

          {/* 見出しの角。横にも縦にもスクロールで残す */}
          <Box
            style={{ gridColumn: "1", gridRow: "1" }}
            sx={{
              position: "sticky",
              top: 0,
              left: 0,
              zIndex: 8,
              bgcolor: "background.paper",
              borderBottom: 1,
              borderRight: 1,
              borderColor: "divider",
            }}
          />
          {/* 日付の目盛り。細い列では月が変わるところだけ書く */}
          {layout.columns.map((col, i) => (
            <Box
              key={`head-${col.date}`}
              style={{ gridColumn: String(i + 2), gridRow: "1" }}
              sx={{
                position: "sticky",
                top: 0,
                zIndex: 6,
                bgcolor: "background.paper",
                borderBottom: 1,
                borderColor: "divider",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                whiteSpace: "nowrap",
              }}
            >
              <Typography
                sx={{ fontSize: "0.6rem", lineHeight: 1 }}
                fontWeight={col.monthStart !== null ? 700 : 400}
                color={col.isToday ? "primary.main" : "text.secondary"}
              >
                {col.monthStart !== null
                  ? t("staffOps.todoGanttMonth", { n: col.monthStart })
                  : showDayNumbers
                    ? col.date.slice(8, 10)
                    : ""}
              </Typography>
            </Box>
          ))}

          {/* 題名の列。横スクロールしても残る */}
          {derived.map((d, row) => (
            <Box
              key={`label-${d.todo.id}`}
              style={{ gridColumn: "1", gridRow: String(row + 2) }}
              onClick={() => onSelect(d.todo.id)}
              sx={{
                position: "sticky",
                left: 0,
                zIndex: 5,
                bgcolor:
                  selectedId === d.todo.id
                    ? "action.selected"
                    : "background.paper",
                borderRight: 1,
                borderTop: 1,
                borderColor: "divider",
                display: "flex",
                alignItems: "center",
                px: 1,
                cursor: "pointer",
                overflow: "hidden",
              }}
            >
              <Typography
                noWrap
                sx={{
                  fontSize: "0.72rem",
                  textDecoration:
                    d.todo.status === "done" ? "line-through" : undefined,
                  color:
                    d.todo.status === "done" ? "text.secondary" : undefined,
                }}
              >
                {d.todo.title}
              </Typography>
            </Box>
          ))}

          {/* 帯 */}
          {layout.bars.map((bar) => {
            const d = byId.get(bar.todoId);
            if (!d) return null;
            const done = d.todo.status === "done";
            const selected = selectedId === bar.todoId;
            return (
              <Box
                key={`bar-${bar.todoId}`}
                data-todo-bar={bar.todoId}
                style={{
                  gridColumn: `${bar.startCol + 2} / span ${bar.span}`,
                  gridRow: String(bar.rowIndex + 2),
                }}
                onClick={() => onSelect(bar.todoId)}
                title={[d.todo.title, todoAssigneeLabel(d.todo)].join(
                  t("common.dotSeparator"),
                )}
                sx={{
                  position: "relative",
                  zIndex: 2,
                  my: "4px",
                  px: "3px",
                  display: "flex",
                  alignItems: "center",
                  gap: "2px",
                  overflow: "hidden",
                  cursor: "pointer",
                  borderRadius: "3px",
                  // 遅れは左端に赤（設計 8.3）。色だけに頼らないよう一覧側にも
                  // 「遅れ」のチップが並ぶ
                  borderLeft: "3px solid",
                  borderLeftColor: d.overdue
                    ? theme.palette.error.main
                    : alpha(theme.palette.primary.main, done ? 0.9 : 0.6),
                  // done は塗りつぶし、待ちは薄い塗り＋鍵（#383 が裏方に使った印）
                  bgcolor: alpha(
                    theme.palette.primary.main,
                    done ? 0.5 : d.blocked ? 0.08 : 0.22,
                  ),
                  ...(d.blocked && !done
                    ? { border: "1px dashed", borderColor: "divider" }
                    : {}),
                  ...(selected
                    ? {
                        outline: "2px solid",
                        outlineColor: theme.palette.primary.main,
                      }
                    : {}),
                }}
              >
                {d.blocked && !done && (
                  <LockOutlinedIcon
                    sx={{ fontSize: 11, flex: "none", color: "text.secondary" }}
                    titleAccess={t("staffOps.todoBlockedChip")}
                  />
                )}
                <Typography
                  noWrap
                  sx={{
                    fontSize: "0.66rem",
                    lineHeight: 1.2,
                    textDecoration: done ? "line-through" : undefined,
                  }}
                >
                  {d.todo.title}
                </Typography>
              </Box>
            );
          })}

          {/* 依存の線。選んだ行のときだけ出る。座標は layout が決めているので
              ここは `points` を並べるだけ（DOM 計測は無い） */}
          {lines.length > 0 && (
            <Box
              component="svg"
              aria-hidden
              style={{
                gridColumn: "2 / -1",
                gridRow: "2 / -1",
                width: layout.days * dayPx,
                height: rows * TODO_ROW_PX,
              }}
              sx={{ position: "relative", zIndex: 3, pointerEvents: "none" }}
            >
              {lines.map((line) => (
                <polyline
                  key={line.key}
                  points={line.points.map(([x, y]) => `${x},${y}`).join(" ")}
                  fill="none"
                  stroke={theme.palette.text.primary}
                  strokeWidth={1.5}
                  strokeOpacity={0.75}
                />
              ))}
            </Box>
          )}
        </Box>
      </Box>

      <Stack
        direction="row"
        spacing={1.5}
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
        sx={{ color: "text.secondary" }}
      >
        {layout.todayCol !== null && (
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Box
              sx={{
                width: "2px",
                height: 12,
                bgcolor: alpha(theme.palette.primary.main, 0.7),
              }}
            />
            <Typography variant="caption">
              {t("staffOps.todoGanttToday")}
            </Typography>
          </Stack>
        )}
        <Typography variant="caption">
          {t("staffOps.todoGanttSelectHint")}
        </Typography>
        {/* 窓から外れた項目は**消さずに一覧へ落とす**（設計 8.3）。
            年の打ち間違い1件で全部が外れるのを防ぐ窓の切り方の裏返し */}
        {layout.outsideIds.length > 0 && (
          <Typography variant="caption">
            {t("staffOps.todoGanttOutside", { n: layout.outsideIds.length })}
          </Typography>
        )}
        {/* 全項目が窓より長いときのフォールバックで、帯を窓の端で切った印。
            切ったことを黙らない（帯の長さ＝期間だと読まれるため） */}
        {layout.clippedIds.length > 0 && (
          <Typography variant="caption">
            {t("staffOps.todoGanttClipped", { n: layout.clippedIds.length })}
          </Typography>
        )}
      </Stack>
    </Stack>
  );
}
