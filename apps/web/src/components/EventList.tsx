import { Box, Stack, ToggleButton, ToggleButtonGroup } from "@mui/material";
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
}: {
  events: (Event & { myRole?: EventRole })[];
  role?: EventRole;
}) {
  const [columns] = useListColumns();
  if (columns === 2) {
    return (
      <Box
        sx={{
          display: "grid",
          // 列数は上限を決め打つ (#488)。auto-fill だと広い画面で5列以上に増え、
          // 1枚が小さくなりすぎてタイトルも日時も読めなくなっていた
          gridTemplateColumns: {
            xs: "repeat(2, minmax(0, 1fr))",
            md: "repeat(3, minmax(0, 1fr))",
          },
          gap: 1.5,
        }}
      >
        {events.map((e) => (
          <EventCard key={e.id} event={e} role={e.myRole ?? role} compact />
        ))}
      </Box>
    );
  }
  return (
    <Stack spacing={2}>
      {events.map((e) => (
        <EventCard key={e.id} event={e} role={e.myRole ?? role} />
      ))}
    </Stack>
  );
}
