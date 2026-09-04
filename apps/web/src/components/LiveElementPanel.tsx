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
import FormatBoldIcon from "@mui/icons-material/FormatBold";
import ImageIcon from "@mui/icons-material/Image";
import { EVENT_INFO_FIELDS } from "@eventer/shared";
import type { EventInfoField, LiveElement } from "@eventer/shared";
import type { LiveElementCommands } from "../lib/liveScenes.js";
import { ensureDeckFont, useDeckFontOptions } from "../lib/deckFonts.js";

/** イベント情報の項目名。**訳した文字列ではなくキーを持つ**ので、
 * 言語を切り替えたときに前の言語のまま残らない (#367) */
const INFO_LABEL_KEY = {
  title: "studio.infoFieldTitle",
  datetime: "studio.infoFieldDatetime",
  participants: "studio.infoFieldParticipants",
  community: "studio.infoFieldCommunity",
} as const satisfies Record<EventInfoField, string>;

/** 要素の種類の呼び名。同じく翻訳キーを持つ */
const TYPE_LABEL_KEY = {
  text: "studio.elementText",
  image: "studio.elementImage",
  camera: "studio.elementCamera",
  deck: "studio.elementDeck",
  eventInfo: "studio.elementEventInfo",
} as const satisfies Record<LiveElement["type"], string>;

/** 既定値。要素が値を持たないときに画面へ出す見た目と揃える */
const DEFAULT_FONT_SIZE = 40;
const DEFAULT_COLOR = "#EAF0F7";

/**
 * 選んだ要素の設定欄。
 *
 * 種類ごとの出し分けはここが持つ。文字と「イベント情報」は書体・大きさ・色を
 * 共有する（どちらも文字を出すもの）ので、その塊だけを1つにまとめてある。
 * 何も選んでいない時に案内を出すのもここ。呼ぶ側に出し分けを持たせない。
 */
export function LiveElementPanel({
  selected,
  commands,
  pickImage,
  uploading,
}: {
  selected: LiveElement | null;
  commands: LiveElementCommands;
  /** 画像の差し替え。選ばせて上げるまでは共通の仕掛けが持つ */
  pickImage: (onPicked: (url: string) => void) => void;
  uploading: boolean;
}) {
  const { t } = useTranslation();
  const fontOptions = useDeckFontOptions();

  if (!selected) {
    return (
      <Typography variant="caption" color="text.secondary">
        {t("studio.liveEditorHint")}
      </Typography>
    );
  }

  const patch = (p: Partial<LiveElement>) => commands.patch(selected.id, p);

  return (
    <>
      <Typography variant="subtitle2">
        {t(TYPE_LABEL_KEY[selected.type])}
      </Typography>

      {selected.type === "text" && (
        <TextField
          size="small"
          label={t("studio.textContent")}
          multiline
          minRows={2}
          value={selected.text ?? ""}
          onChange={(e) => patch({ text: e.target.value })}
        />
      )}

      {selected.type === "eventInfo" && (
        <TextField
          select
          size="small"
          label={t("studio.infoFieldLabel")}
          value={selected.field ?? "title"}
          onChange={(e) =>
            patch({ field: e.target.value as EventInfoField })
          }
        >
          {EVENT_INFO_FIELDS.map((f) => (
            <MenuItem key={f} value={f}>
              {t(INFO_LABEL_KEY[f])}
            </MenuItem>
          ))}
        </TextField>
      )}

      {(selected.type === "text" || selected.type === "eventInfo") && (
        <>
          <TextField
            select
            size="small"
            label={t("common.font")}
            value={selected.fontFamily ?? ""}
            onChange={(e) => {
              // 選んだ瞬間に読み込む。描いてから差し替わると位置がずれて見える
              ensureDeckFont(e.target.value);
              patch({ fontFamily: e.target.value });
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
                n: selected.fontSize ?? DEFAULT_FONT_SIZE,
              })}
            </Typography>
            <Slider
              size="small"
              min={12}
              max={160}
              value={selected.fontSize ?? DEFAULT_FONT_SIZE}
              onChange={(_e, v) => patch({ fontSize: v as number })}
            />
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography variant="caption">{t("studio.color")}</Typography>
            <input
              type="color"
              value={selected.color ?? DEFAULT_COLOR}
              onChange={(e) => patch({ color: e.target.value })}
            />
            <ToggleButton
              size="small"
              value="bold"
              selected={Boolean(selected.bold)}
              onChange={() => patch({ bold: !selected.bold })}
            >
              <FormatBoldIcon fontSize="small" />
            </ToggleButton>
          </Box>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={selected.align ?? "left"}
            onChange={(_e, v) => v && patch({ align: v })}
          >
            <ToggleButton value="left">{t("studio.alignLeft")}</ToggleButton>
            <ToggleButton value="center">{t("studio.alignCenter")}</ToggleButton>
            <ToggleButton value="right">{t("studio.alignRight")}</ToggleButton>
          </ToggleButtonGroup>
        </>
      )}

      {selected.type === "image" && (
        <>
          <Button
            size="small"
            variant="outlined"
            startIcon={<ImageIcon />}
            disabled={uploading}
            onClick={() => pickImage((url) => patch({ src: url }))}
          >
            {uploading ? t("common.uploading") : t("studio.replaceImage")}
          </Button>
          <TextField
            size="small"
            label={t("studio.imageUrlLabel")}
            value={selected.src ?? ""}
            onChange={(e) => patch({ src: e.target.value })}
          />
        </>
      )}

      {selected.type === "camera" && (
        <>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={selected.fit ?? "cover"}
            onChange={(_e, v) => v && patch({ fit: v })}
          >
            <ToggleButton value="cover">
              {t("studio.cameraFitCover")}
            </ToggleButton>
            <ToggleButton value="contain">
              {t("studio.cameraFitContain")}
            </ToggleButton>
          </ToggleButtonGroup>
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t("studio.cameraRadiusValue", { n: selected.radius ?? 0 })}
            </Typography>
            <Slider
              size="small"
              min={0}
              max={200}
              value={selected.radius ?? 0}
              onChange={(_e, v) => patch({ radius: v as number })}
            />
          </Box>
          <Typography variant="caption" color="text.secondary">
            {t("studio.cameraHint")}
          </Typography>
        </>
      )}

      {selected.type === "deck" && (
        <Typography variant="caption" color="text.secondary">
          {t("studio.deckElementHint")}
        </Typography>
      )}

      <Divider />
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
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
        <Button size="small" onClick={() => commands.moveZ(selected.id, 1)}>
          {t("studio.forward")}
        </Button>
        <Button size="small" onClick={() => commands.moveZ(selected.id, -1)}>
          {t("studio.backward")}
        </Button>
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
        {t("studio.deleteElement")}
      </Button>
    </>
  );
}
