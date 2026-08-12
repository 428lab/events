import { Chip } from "@mui/material";
import EditNoteIcon from "@mui/icons-material/EditNote";
import { useTranslation } from "react-i18next";
import type { Event } from "@eventer/shared";

/** 公開前（下書き）のイベントか (#348)。
 * 「下書きかどうか」の判定と見た目はここ1か所に置き、
 * 一覧カード・年表など出る場所ごとに書き分けない */
export const isDraftEvent = (event: Pick<Event, "status">): boolean =>
  event.status === "draft";

/** 公開前であることを示す印。公開済みのイベントと同じ見え方にしないためのもので、
 * 一覧の「下書き」のまとまり以外の場所に出たときにも1枚で分かるようにする */
export function DraftChip({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  return (
    <Chip
      size="small"
      color="warning"
      label={t("events.draftBadge")}
      icon={<EditNoteIcon />}
      sx={{
        flexShrink: 0,
        fontWeight: 700,
        ...(compact && { height: 18, fontSize: "0.6rem" }),
      }}
    />
  );
}
