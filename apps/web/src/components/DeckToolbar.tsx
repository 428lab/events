import { useTranslation } from "react-i18next";
import {
  Box,
  Button,
  Divider,
  IconButton,
  Stack,
  ToggleButton,
  Tooltip,
  Typography,
} from "@mui/material";
import ImageIcon from "@mui/icons-material/Image";
import LibraryAddCheckIcon from "@mui/icons-material/LibraryAddCheck";
import RedoIcon from "@mui/icons-material/Redo";
import TextFieldsIcon from "@mui/icons-material/TextFields";
import UndoIcon from "@mui/icons-material/Undo";

/** スマホでは画面下の FAB が同じ役をするので、ツールバー側は md 以上だけ出す */
const desktopOnly = { display: { xs: "none", md: "inline-flex" } } as const;

/**
 * キャンバスの上に置く、ページ全体への操作。
 * 戻す/やり直す・要素を足す・背景を変える・複数選択モードを切り替える。
 */
export function DeckToolbar({
  onAddText,
  onAddImage,
  background,
  onBackgroundChange,
  multiSelect,
  onToggleMultiSelect,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: {
  onAddText: () => void;
  onAddImage: () => void;
  background: string;
  onBackgroundChange: (color: string) => void;
  multiSelect: boolean;
  onToggleMultiSelect: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
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
      <Tooltip title={t("studio.undoTip")}>
        <Box component="span" sx={desktopOnly}>
          <IconButton size="small" onClick={onUndo} disabled={!canUndo}>
            <UndoIcon fontSize="small" />
          </IconButton>
        </Box>
      </Tooltip>
      <Tooltip title={t("studio.redoTip")}>
        <Box component="span" sx={desktopOnly}>
          <IconButton size="small" onClick={onRedo} disabled={!canRedo}>
            <RedoIcon fontSize="small" />
          </IconButton>
        </Box>
      </Tooltip>
      <Divider orientation="vertical" flexItem sx={desktopOnly} />
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
