import { Chip } from "@mui/material";
import EditNoteIcon from "@mui/icons-material/EditNote";
import type { Event } from "@eventer/shared";

/** 公開前（下書き）のイベントか (#348)。
 * 「下書きかどうか」の判定と見た目はここ1か所に置き、
 * 一覧カード・年表など出る場所ごとに書き分けない */
export const isDraftEvent = (event: Pick<Event, "status">): boolean =>
  event.status === "draft";

/** 公開前であることを示す印。公開済みのイベントと同じ見え方にしないためのもので、
 * 一覧の「下書き」のまとまり以外の場所に出たときにも1枚で分かるようにする */
export function DraftChip({ compact = false }: { compact?: boolean }) {
  return (
    <Chip
      size="small"
      color="warning"
      label="下書き"
      icon={<EditNoteIcon />}
      sx={{
        flexShrink: 0,
        fontWeight: 700,
        ...(compact && { height: 18, fontSize: "0.6rem" }),
      }}
    />
  );
}
