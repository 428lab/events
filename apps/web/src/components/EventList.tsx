import { Box, Stack, ToggleButton, ToggleButtonGroup, Tooltip } from "@mui/material";
import { useTranslation } from "react-i18next";
import ViewAgendaIcon from "@mui/icons-material/ViewAgenda";
import ViewListIcon from "@mui/icons-material/ViewList";
import GridViewIcon from "@mui/icons-material/GridView";
import type { Event, EventRole } from "@eventer/shared";
import { EventCard } from "./EventCard.js";
import { LIST_VIEWS, useListView, type ListView } from "../lib/useListView.js";

/**
 * グリッドの列の決め方 (#488)。素の auto-fill だと広い画面で5列以上に増えて
 * 1枚が読めなくなる。ビューポートではなく**この箱の幅**で決めるので、
 * どこに埋め込んでも同じ規則で並ぶ。
 *   下限 150px: これ未満だと日時が省略される。320px 幅の端末は 1 列に落ちる
 *   上限 3 列 : (100% - gap×2) / 3 を最小幅にすると 4 列目が入らない
 */
export const GRID_COLUMNS =
  "repeat(auto-fill, minmax(max(150px, calc((100% - 24px) / 3)), 1fr))";

const VIEW_ICON = {
  list: <ViewAgendaIcon fontSize="small" />,
  compact: <ViewListIcon fontSize="small" />,
  grid: <GridViewIcon fontSize="small" />,
} as const;

/** 一覧見出し行の右側に置く、見せ方の切替（リスト / コンパクト / グリッド）。 */
export function ListColumnsToggle() {
  const { t } = useTranslation();
  const [view, setView] = useListView();
  return (
    <ToggleButtonGroup
      size="small"
      exclusive
      value={view}
      onChange={(_e, v: ListView | null) => {
        if (v != null) setView(v);
      }}
      aria-label={t("events.view")}
      sx={{ flexShrink: 0 }}
    >
      {LIST_VIEWS.map((v) => (
        <Tooltip key={v} title={t(`events.view_${v}`)}>
          <ToggleButton value={v} aria-label={t(`events.view_${v}`)}>
            {VIEW_ICON[v]}
          </ToggleButton>
        </Tooltip>
      ))}
    </ToggleButtonGroup>
  );
}

/**
 * イベント一覧本体。useListView の設定に応じて
 * リスト（従来）/ コンパクト（横並び固定）/ グリッド（タイル）を切り替える。
 * 各イベントが myRole を持つ場合（マイページ/プロフィール）はそちらを優先する。
 */
export function EventList({
  events,
  role,
}: {
  events: (Event & { myRole?: EventRole })[];
  role?: EventRole;
}) {
  const [view] = useListView();
  if (view === "grid") {
    return (
      <Box
        data-testid="event-list-grid"
        sx={{ display: "grid", gridTemplateColumns: GRID_COLUMNS, gap: 1.5 }}
      >
        {events.map((e) => (
          <EventCard key={e.id} event={e} role={e.myRole ?? role} variant="grid" />
        ))}
      </Box>
    );
  }
  return (
    <Stack
      data-testid={`event-list-${view}`}
      spacing={view === "compact" ? { xs: 1, sm: 2 } : 2}
    >
      {events.map((e) => (
        <EventCard key={e.id} event={e} role={e.myRole ?? role} variant={view} />
      ))}
    </Stack>
  );
}
