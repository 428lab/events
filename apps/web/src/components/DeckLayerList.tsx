import { useTranslation } from "react-i18next";
import { Box, Divider, Stack, Typography } from "@mui/material";
import FolderIcon from "@mui/icons-material/Folder";
import ImageIcon from "@mui/icons-material/Image";
import TextFieldsIcon from "@mui/icons-material/TextFields";
import type { DeckElement } from "@eventer/shared";

/** 一覧に出す文字の長さ。長いテキストで欄がはみ出さない程度 */
const LABEL_MAX = 16;

/**
 * いま編集しているページの要素一覧。
 *
 * 重なって隠れた要素はキャンバス上では掴めないので、ここから選べるようにする。
 * 並びは手前が上（配列は後ろほど手前なので逆に描く）。
 */
export function DeckLayerList({
  els,
  selectedIds,
  multiSelect,
  onSelect,
}: {
  els: DeckElement[];
  selectedIds: string[];
  /** 指で操作する端末向けの複数選択モード。ON の間はタップが追加選択になる */
  multiSelect: boolean;
  onSelect: (elId: string, additive: boolean) => void;
}) {
  const { t } = useTranslation();
  const selected = new Set(selectedIds);

  return (
    <>
      <Divider sx={{ mt: 1 }} />
      <Typography variant="caption" color="text.secondary">
        {t("studio.layersHeading")}
      </Typography>
      <Stack spacing={0.25}>
        {[...els].reverse().map((el) => (
          <Box
            key={el.id}
            onClick={(e) => onSelect(el.id, e.shiftKey || multiSelect)}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.75,
              px: 0.75,
              py: 0.5,
              borderRadius: 1,
              cursor: "pointer",
              bgcolor: selected.has(el.id) ? "action.selected" : "transparent",
              "&:hover": { bgcolor: "action.hover" },
            }}
          >
            {el.groupId ? (
              <FolderIcon fontSize="small" sx={{ opacity: 0.7 }} />
            ) : el.type === "image" ? (
              <ImageIcon fontSize="small" />
            ) : (
              <TextFieldsIcon fontSize="small" />
            )}
            <Typography variant="caption" noWrap sx={{ flex: 1, minWidth: 0 }}>
              {el.type === "image"
                ? t("studio.elementImage")
                : el.text?.trim().slice(0, LABEL_MAX) || t("studio.elementText")}
            </Typography>
          </Box>
        ))}
        {els.length === 0 && (
          <Typography variant="caption" color="text.disabled">
            {t("studio.layersEmpty")}
          </Typography>
        )}
      </Stack>
    </>
  );
}
