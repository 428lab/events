import { Grid, Stack, ToggleButton, ToggleButtonGroup } from "@mui/material";
import ViewAgendaIcon from "@mui/icons-material/ViewAgenda";
import GridViewIcon from "@mui/icons-material/GridView";
import type { Event, EventRole } from "@eventer/shared";
import { EventCard } from "./EventCard.js";
import { useListColumns } from "../lib/useListColumns.js";

/** 一覧見出し行の右側に置く 1列⇔2列 表示切替トグル。 */
export function ListColumnsToggle() {
  const [columns, setColumns] = useListColumns();
  return (
    <ToggleButtonGroup
      size="small"
      exclusive
      value={columns}
      onChange={(_e, v: 1 | 2 | null) => {
        if (v != null) setColumns(v);
      }}
      aria-label="表示列数"
      sx={{ flexShrink: 0 }}
    >
      <ToggleButton value={1} aria-label="1列表示">
        <ViewAgendaIcon fontSize="small" />
      </ToggleButton>
      <ToggleButton value={2} aria-label="2列表示">
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
      <Grid container spacing={1.5}>
        {events.map((e) => (
          <Grid item xs={6} key={e.id}>
            <EventCard event={e} role={e.myRole ?? role} compact />
          </Grid>
        ))}
      </Grid>
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
