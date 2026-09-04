import { useTranslation } from "react-i18next";
import { Box, Button, MenuItem, Stack, TextField, Typography } from "@mui/material";
import CardGiftcardIcon from "@mui/icons-material/CardGiftcard";
import ImageIcon from "@mui/icons-material/Image";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import SlideshowIcon from "@mui/icons-material/Slideshow";
import TextFieldsIcon from "@mui/icons-material/TextFields";
import VideocamIcon from "@mui/icons-material/Videocam";
import type { BgmTrack, LiveElement, LiveScene } from "@eventer/shared";
import {
  isColorBackground,
  newCameraElement,
  newDeckElement,
  newEventInfoElement,
  newTextElement,
} from "../lib/liveScenes.js";

/** 背景プリセット（Natsumatsuri トーン）。色と並び順は文言ではないのでコード側に残す */
const BG_PRESETS = [
  { labelKey: "studio.bgNightSky", value: "#0E1426" },
  { labelKey: "studio.bgBlack", value: "#000000" },
  {
    labelKey: "studio.bgFestivalGradient",
    value: "linear-gradient(135deg, #0B3A34 0%, #0E1426 60%)",
  },
  {
    labelKey: "studio.bgDuskGradient",
    value: "linear-gradient(135deg, #0E1426 40%, #0B3A34 100%)",
  },
  { labelKey: "studio.bgWhite", value: "#ffffff" },
] as const;

/** BGM 欄の「変更しない」「止める」。曲の id と混ざらない値にしてある */
const BGM_KEEP = "__keep";
const BGM_STOP = "__stop";

/** 既定の背景色。グラデーションを選んでいる間もカラーピッカーは色を要求するため */
const DEFAULT_BG_COLOR = "#0E1426";

/**
 * キャンバスの上に出る操作列。
 *
 * 「何を置くか」と「シーンそのものの設定（名前・背景・BGM）」を並べる。
 * BGM は配信セットにしか無い。シーンを切り替えた時の曲の扱いは
 * **変更しない / 止める / その曲にする** の3択で、undefined と null を
 * 意味の違うものとして持つ。ここが select の値と往復する唯一の場所。
 */
export function LiveSceneToolbar({
  scene,
  bgmTracks,
  onPatchScene,
  onAdd,
  onAddImage,
}: {
  /** 編集中のシーン。1つも無い状態では undefined */
  scene: LiveScene | undefined;
  bgmTracks: BgmTrack[] | undefined;
  onPatchScene: (patch: Partial<LiveScene>) => void;
  /** 置く要素。中身の既定値は liveScenes が持つ */
  onAdd: (el: LiveElement) => void;
  /** 画像だけは選ばせて上げてからになるので入口が別 */
  onAddImage: () => void;
}) {
  const { t } = useTranslation();
  const background = scene?.background;

  return (
    <>
      <Stack
        direction="row"
        spacing={1}
        sx={{ mb: 1 }}
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
      >
        <TextField
          size="small"
          label={t("studio.sceneName")}
          value={scene?.name ?? ""}
          onChange={(e) => onPatchScene({ name: e.target.value })}
          sx={{ width: 160 }}
        />
        <Button
          size="small"
          startIcon={<TextFieldsIcon />}
          onClick={() => onAdd(newTextElement())}
        >
          {t("studio.elementText")}
        </Button>
        <Button size="small" startIcon={<ImageIcon />} onClick={onAddImage}>
          {t("studio.elementImage")}
        </Button>
        <Button
          size="small"
          startIcon={<VideocamIcon />}
          onClick={() => onAdd(newCameraElement())}
        >
          {t("studio.elementCamera")}
        </Button>
        <Button
          size="small"
          startIcon={<SlideshowIcon />}
          onClick={() => onAdd(newDeckElement())}
        >
          {t("studio.elementDeck")}
        </Button>
        <Button
          size="small"
          startIcon={<InfoOutlinedIcon />}
          onClick={() => onAdd(newEventInfoElement())}
        >
          {t("studio.elementEventInfo")}
        </Button>
      </Stack>

      <Stack
        direction="row"
        spacing={1}
        sx={{ mb: 1 }}
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
      >
        <Typography variant="caption">{t("common.background")}</Typography>
        <input
          type="color"
          value={
            isColorBackground(background) ? background : DEFAULT_BG_COLOR
          }
          onChange={(e) => onPatchScene({ background: e.target.value })}
        />
        <TextField
          select
          size="small"
          value={BG_PRESETS.find((p) => p.value === background)?.value ?? ""}
          onChange={(e) => onPatchScene({ background: e.target.value })}
          sx={{ width: 140 }}
          SelectProps={{ displayEmpty: true }}
        >
          <MenuItem value="" disabled>
            {t("studio.bgPreset")}
          </MenuItem>
          {BG_PRESETS.map((p) => (
            <MenuItem key={p.value} value={p.value}>
              {t(p.labelKey)}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label={t("studio.sceneBgm")}
          value={
            scene?.bgmTrackId === undefined
              ? BGM_KEEP
              : (scene.bgmTrackId ?? BGM_STOP)
          }
          onChange={(e) =>
            onPatchScene({
              bgmTrackId:
                e.target.value === BGM_KEEP
                  ? undefined
                  : e.target.value === BGM_STOP
                    ? null
                    : e.target.value,
            })
          }
          sx={{ minWidth: 180 }}
          helperText={t("studio.sceneBgmHelp")}
        >
          <MenuItem value={BGM_KEEP}>{t("studio.sceneBgmKeep")}</MenuItem>
          <MenuItem value={BGM_STOP}>{t("studio.sceneBgmStop")}</MenuItem>
          {(bgmTracks ?? []).map((track) => (
            <MenuItem key={track.id} value={track.id}>
              {track.ownerId === null ? (
                <Box
                  component="span"
                  sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}
                >
                  {/* ビルトイン曲の印。誰でも使える */}
                  <CardGiftcardIcon fontSize="small" />
                  {track.name}
                </Box>
              ) : (
                track.name
              )}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
    </>
  );
}
