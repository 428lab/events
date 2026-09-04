import { useTranslation } from "react-i18next";
import {
  Box,
  Button,
  Divider,
  MenuItem,
  Slider,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import FlipToBackIcon from "@mui/icons-material/FlipToBack";
import FlipToFrontIcon from "@mui/icons-material/FlipToFront";
import FolderIcon from "@mui/icons-material/Folder";
import FormatBoldIcon from "@mui/icons-material/FormatBold";
import ImageIcon from "@mui/icons-material/Image";
import type { DeckElementCommands, DeckSelection } from "../lib/deckSlides.js";
import { ensureDeckFont, useDeckFontOptions } from "../lib/deckFonts.js";

/** 文字の大きさの取りうる範囲と既定値 */
const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 160;
const FONT_SIZE_DEFAULT = 40;
const TEXT_COLOR_DEFAULT = "#0f172a";

/**
 * 選んだ要素の設定欄。
 *
 * 中身の編集（文字・画像）は1つだけ選んでいるときに出す。まとめて選んでいる間は
 * 重なり順・グループ化・複製・削除だけで、どれの値を見せるか迷わせない。
 */
export function DeckElementPanel({
  selection,
  commands,
  pickImage,
  uploading,
}: {
  selection: DeckSelection;
  commands: DeckElementCommands;
  /** 画像を選ばせて、上げ終わった URL を受け取る */
  pickImage: (onPicked: (url: string) => void) => void;
  uploading: boolean;
}) {
  const { t } = useTranslation();
  const fontOptions = useDeckFontOptions();
  const { ids, els, one } = selection;

  if (ids.length === 0) {
    return (
      <Typography variant="caption" color="text.secondary">
        {t("studio.deckEditorHint", {
          text: t("studio.elementText"),
          image: t("studio.elementImage"),
        })}
      </Typography>
    );
  }

  const groupIds = new Set(els.map((e) => e.groupId).filter(Boolean));

  return (
    <>
      <Typography variant="subtitle2">
        {one
          ? one.type === "text"
            ? t("studio.elementText")
            : t("studio.elementImage")
          : t("studio.selectedCount", { n: ids.length })}
      </Typography>

      {one && one.type === "text" && (
        <>
          <TextField
            size="small"
            label={t("studio.textContent")}
            multiline
            minRows={2}
            value={one.text ?? ""}
            onChange={(e) => commands.patch(one.id, { text: e.target.value })}
          />
          <TextField
            select
            size="small"
            label={t("common.font")}
            value={one.fontFamily ?? ""}
            onChange={(e) => {
              // 選んだ書体を先に読み込ませる。描き直しで一瞬別の書体になるのを避ける
              ensureDeckFont(e.target.value);
              commands.patch(one.id, { fontFamily: e.target.value });
            }}
          >
            {fontOptions.map((f) => (
              <MenuItem
                key={f.family}
                value={f.family}
                onMouseEnter={() => ensureDeckFont(f.family)}
                style={{ fontFamily: f.family || undefined }}
              >
                {f.label}
              </MenuItem>
            ))}
          </TextField>
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t("studio.fontSizeValue", {
                n: one.fontSize ?? FONT_SIZE_DEFAULT,
              })}
            </Typography>
            <Slider
              size="small"
              min={FONT_SIZE_MIN}
              max={FONT_SIZE_MAX}
              value={one.fontSize ?? FONT_SIZE_DEFAULT}
              onChange={(_e, v) =>
                commands.patch(one.id, { fontSize: v as number })
              }
            />
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography variant="caption">{t("studio.color")}</Typography>
            <input
              type="color"
              value={one.color ?? TEXT_COLOR_DEFAULT}
              onChange={(e) => commands.patch(one.id, { color: e.target.value })}
            />
            <ToggleButton
              size="small"
              value="bold"
              selected={Boolean(one.bold)}
              onChange={() => commands.patch(one.id, { bold: !one.bold })}
            >
              <FormatBoldIcon fontSize="small" />
            </ToggleButton>
          </Box>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={one.align ?? "left"}
            onChange={(_e, v) => v && commands.patch(one.id, { align: v })}
          >
            <ToggleButton value="left">{t("studio.alignLeft")}</ToggleButton>
            <ToggleButton value="center">{t("studio.alignCenter")}</ToggleButton>
            <ToggleButton value="right">{t("studio.alignRight")}</ToggleButton>
          </ToggleButtonGroup>
        </>
      )}

      {one && one.type === "image" && (
        <>
          <Button
            size="small"
            variant="outlined"
            startIcon={<ImageIcon />}
            disabled={uploading}
            onClick={() => pickImage((url) => commands.patch(one.id, { src: url }))}
          >
            {uploading ? t("common.uploading") : t("studio.replaceImage")}
          </Button>
          {/* 外部の画像を直接指したい場合のための口 */}
          <TextField
            size="small"
            label={t("studio.imageUrlLabel")}
            value={one.src ?? ""}
            onChange={(e) => commands.patch(one.id, { src: e.target.value })}
          />
        </>
      )}

      <Divider />
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {ids.length >= 2 && (
          <Button size="small" startIcon={<FolderIcon />} onClick={commands.group}>
            {t("studio.group")}
          </Button>
        )}
        {groupIds.size > 0 && (
          <Button size="small" onClick={commands.ungroup}>
            {t("studio.ungroup")}
          </Button>
        )}
        <Button
          size="small"
          startIcon={<ContentCopyIcon />}
          onClick={commands.duplicate}
        >
          {t("studio.duplicate")}
        </Button>
      </Stack>

      <Typography variant="caption" color="text.secondary">
        {t("studio.zOrder")}
      </Typography>
      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
        <Button
          size="small"
          startIcon={<FlipToFrontIcon />}
          onClick={commands.toFront}
        >
          {t("studio.toFront")}
        </Button>
        {/* 1段ずつの前後は、どれを動かすか決まる単一選択のときだけ */}
        {one && (
          <Button size="small" onClick={() => commands.moveZ(one.id, 1)}>
            {t("studio.forward")}
          </Button>
        )}
        {one && (
          <Button size="small" onClick={() => commands.moveZ(one.id, -1)}>
            {t("studio.backward")}
          </Button>
        )}
        <Button
          size="small"
          startIcon={<FlipToBackIcon />}
          onClick={commands.toBack}
        >
          {t("studio.toBack")}
        </Button>
      </Stack>

      <Button
        size="small"
        color="error"
        startIcon={<DeleteOutlineIcon />}
        onClick={commands.remove}
      >
        {ids.length > 1
          ? t("studio.deleteSelectedCount", { n: ids.length })
          : t("studio.deleteElement")}
      </Button>
    </>
  );
}
