import { useTranslation } from "react-i18next";
import { Box, Button, Stack, ToggleButton, Typography } from "@mui/material";
import ImageIcon from "@mui/icons-material/Image";
import LibraryAddCheckIcon from "@mui/icons-material/LibraryAddCheck";
import TextFieldsIcon from "@mui/icons-material/TextFields";

/**
 * キャンバスの上に置く、ページ全体への操作。
 * 要素を足す・背景を変える・複数選択モードを切り替える。
 */
export function DeckToolbar({
  onAddText,
  onAddImage,
  background,
  onBackgroundChange,
  multiSelect,
  onToggleMultiSelect,
}: {
  onAddText: () => void;
  onAddImage: () => void;
  background: string;
  onBackgroundChange: (color: string) => void;
  multiSelect: boolean;
  onToggleMultiSelect: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ mb: 1 }}
      alignItems="center"
      flexWrap="wrap"
      useFlexGap
    >
      <Button size="small" startIcon={<TextFieldsIcon />} onClick={onAddText}>
        {t("studio.elementText")}
      </Button>
      <Button size="small" startIcon={<ImageIcon />} onClick={onAddImage}>
        {t("studio.elementImage")}
      </Button>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        <Typography variant="caption">{t("common.background")}</Typography>
        <input
          type="color"
          value={background}
          onChange={(e) => onBackgroundChange(e.target.value)}
        />
      </Box>
      {/* Shift の無い端末でも複数選べるように。ON の間はタップが追加選択になる */}
      <ToggleButton
        size="small"
        value="multi"
        selected={multiSelect}
        onChange={onToggleMultiSelect}
        sx={{ py: 0.25 }}
      >
        <LibraryAddCheckIcon fontSize="small" sx={{ mr: 0.5 }} />
        {t("studio.multiSelect")}
      </ToggleButton>
    </Stack>
  );
}
