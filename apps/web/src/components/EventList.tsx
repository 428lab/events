import { Box, ToggleButton, ToggleButtonGroup } from "@mui/material";
import { useTranslation } from "react-i18next";
import ViewAgendaIcon from "@mui/icons-material/ViewAgenda";
import GridViewIcon from "@mui/icons-material/GridView";
import type { Event, EventRole } from "@eventer/shared";
import { EventCard } from "./EventCard.js";
import { useListColumns } from "../lib/useListColumns.js";

/** 一覧見出し行の右側に置く 1列⇔2列 表示切替トグル。 */
export function ListColumnsToggle() {
  const { t } = useTranslation();
  const [columns, setColumns] = useListColumns();
  return (
    <ToggleButtonGroup
      size="small"
      exclusive
      value={columns}
      onChange={(_e, v: 1 | 2 | null) => {
        if (v != null) setColumns(v);
      }}
      aria-label={t("events.columns")}
      sx={{ flexShrink: 0 }}
    >
      <ToggleButton value={1} aria-label={t("events.columnsOne")}>
        <ViewAgendaIcon fontSize="small" />
      </ToggleButton>
      <ToggleButton value={2} aria-label={t("events.columnsTwo")}>
        <GridViewIcon fontSize="small" />
      </ToggleButton>
    </ToggleButtonGroup>
  );
}

/**
 * イベント一覧本体。useListColumns の設定に応じて
 * 1列（横型カード）⇔ 2列（縦型コンパクトタイル）を切り替える。
 * 各イベントが myRole を持つ場合（マイページ/プロフィール）はそちらを優先する。
 */
export function EventList({
  events,
  role,
  cohostOf,
}: {
  events: (Event & { myRole?: EventRole })[];
  role?: EventRole;
  /** このコミュニティが主催でないイベントを共催 (#625) として示す（コミュニティページ専用） */
  cohostOf?: string;
}) {
  const isCohost = (e: Event) => cohostOf !== undefined && e.communityId !== cohostOf;
  const [columns] = useListColumns();
  if (columns === 2) {
    return (
      <Box
        sx={{
          display: "grid",
          // 横幅に合わせて自動で列数が決まる（1枚あたり最小170px）
          gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
          gap: 1.5,
        }}
      >
        {events.map((e) => (
          <EventCard key={e.id} event={e} role={e.myRole ?? role} cohost={isCohost(e)} compact />
        ))}
      </Box>
    );
  }
  // 横型カードは、器が広い PC（lg 以上）では2列に並べる。1列のままだとカードが横に間延びする
  // （PC で横幅を使う。オーナー指摘 2026-11-22）。lg 未満はこれまでどおり1列
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "repeat(2, minmax(0, 1fr))" }, gap: 2 }}>
      {events.map((e) => (
        <EventCard key={e.id} event={e} role={e.myRole ?? role} cohost={isCohost(e)} />
      ))}
    </Box>
  );
}
