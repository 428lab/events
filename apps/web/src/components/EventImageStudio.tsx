import { useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  ListSubheader,
  MenuItem,
  Slider,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import CasinoIcon from "@mui/icons-material/Casino";
import { useTranslation } from "react-i18next";
import {
  BACKGROUNDS,
  FONTS,
  LAYOUTS,
  drawEventImage,
  loadFont,
  type BackgroundKey,
  type FontDef,
  type LayoutKey,
} from "../lib/imageTemplates.js";

/** フォントの分類 → 翻訳キー。**分類そのもの（コード）と並びはここが持つ**。
 * 分類は imageTemplates.ts の FontDef が定義しているので、綴りが変わると型で落ちる */
const FONT_CATEGORY_KEY = [
  ["ゴシック", "eventForm.imageFontGothic"],
  ["丸ゴシック", "eventForm.imageFontRounded"],
  ["明朝", "eventForm.imageFontMincho"],
  ["手書き・個性派", "eventForm.imageFontDisplay"],
] as const satisfies readonly (readonly [FontDef["category"], string])[];

/** レイアウト (`LayoutKey`) → 翻訳キー。並びは LAYOUTS が持つ */
const LAYOUT_KEY = {
  center: "eventForm.imageLayoutCenter",
  left: "eventForm.imageLayoutLeft",
  top: "eventForm.imageLayoutTop",
} as const satisfies Record<LayoutKey, string>;

/** 背景 (`BackgroundKey`) → 翻訳キー。並びは BACKGROUNDS が持つ。
 * 背景が増えたらここが型で落ちる（訳を足し忘れたまま出せない） */
const BACKGROUND_KEY = {
  dark: "eventForm.imageBgDark",
  fireworks: "eventForm.imageBgFireworks",
  fireworksWarm: "eventForm.imageBgFireworksWarm",
  fireworksCool: "eventForm.imageBgFireworksCool",
  aerialShells: "eventForm.imageBgAerialShells",
  confetti: "eventForm.imageBgConfetti",
  stars: "eventForm.imageBgStars",
  teal: "eventForm.imageBgTeal",
  amber: "eventForm.imageBgAmber",
  light: "eventForm.imageBgLight",
  dots: "eventForm.imageBgDots",
} as const satisfies Record<BackgroundKey, string>;

/**
 * テンプレート（背景・フォント・レイアウト）からイベント画像(1200×630)を生成する。
 * 「この画像を使う」で PNG Blob を onGenerated に渡す。
 */
export function EventImageStudio({
  title,
  subtitle,
  onGenerated,
}: {
  title: string;
  subtitle?: string;
  onGenerated: (blob: Blob) => void;
}) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rand = (n: number) => Math.floor(Math.random() * n);
  const [fontIdx, setFontIdx] = useState(() => rand(FONTS.length));
  const [bgIdx, setBgIdx] = useState(() => rand(BACKGROUNDS.length));
  const [layout, setLayout] = useState<LayoutKey>(
    () => LAYOUTS[rand(LAYOUTS.length)]!,
  );
  const [titleSize, setTitleSize] = useState(() => 72 + rand(7) * 8);
  const [showSubtitle, setShowSubtitle] = useState(Boolean(subtitle));

  const shuffle = () => {
    setFontIdx(rand(FONTS.length));
    setBgIdx(rand(BACKGROUNDS.length));
    setLayout(LAYOUTS[rand(LAYOUTS.length)]!);
    setTitleSize(72 + rand(7) * 8);
  };

  const font = FONTS[fontIdx];
  const background = BACKGROUNDS[bgIdx];

  useEffect(() => {
    let alive = true;
    (async () => {
      await loadFont(font);
      if (!alive || !canvasRef.current) return;
      drawEventImage(canvasRef.current, {
        title,
        subtitle: showSubtitle ? subtitle : undefined,
        font,
        background,
        layout,
        titleSize,
      });
    })();
    return () => {
      alive = false;
    };
  }, [font, background, layout, titleSize, title, subtitle, showSubtitle]);

  const use = () => {
    canvasRef.current?.toBlob(
      (blob) => blob && onGenerated(blob),
      "image/webp",
      0.92,
    );
  };

  return (
    <Stack spacing={2}>
      <Box
        component="canvas"
        ref={canvasRef}
        sx={{
          width: "100%",
          maxWidth: 480,
          aspectRatio: "1200 / 630",
          borderRadius: 1,
          display: "block",
          border: "1px solid",
          borderColor: "divider",
        }}
      />

      <Button
        variant="outlined"
        startIcon={<CasinoIcon />}
        onClick={shuffle}
        sx={{ alignSelf: "flex-start" }}
      >
        {t("eventForm.imageShuffle")}
      </Button>

      <TextField
        select
        size="small"
        label={t("common.font")}
        value={fontIdx}
        onChange={(e) => setFontIdx(Number(e.target.value))}
        sx={{ maxWidth: 280 }}
      >
        {FONT_CATEGORY_KEY.flatMap(([cat, key]) => [
          <ListSubheader key={cat}>{t(key)}</ListSubheader>,
          ...FONTS.map((f, i) =>
            f.category === cat ? (
              <MenuItem key={i} value={i}>
                {f.label}
              </MenuItem>
            ) : null,
          ).filter(Boolean),
        ])}
      </TextField>

      <Box>
        <Typography variant="caption" color="text.secondary">
          {t("common.background")}
        </Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
          {BACKGROUNDS.map((b, i) => (
            <Button
              key={b.key}
              size="small"
              variant={bgIdx === i ? "contained" : "outlined"}
              onClick={() => setBgIdx(i)}
            >
              {t(BACKGROUND_KEY[b.key])}
            </Button>
          ))}
        </Stack>
      </Box>

      <Box>
        <Typography variant="caption" color="text.secondary">
          {t("eventForm.imageLayout")}
        </Typography>
        <Box>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={layout}
            onChange={(_e, v) => v && setLayout(v)}
            sx={{ mt: 0.5 }}
          >
            {LAYOUTS.map((l) => (
              <ToggleButton key={l} value={l}>
                {t(LAYOUT_KEY[l])}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>
      </Box>

      <Box sx={{ maxWidth: 280 }}>
        <Typography variant="caption" color="text.secondary">
          {t("eventForm.imageTitleSize")}
        </Typography>
        <Slider
          size="small"
          min={40}
          max={140}
          step={4}
          value={titleSize}
          onChange={(_e, v) => setTitleSize(v as number)}
        />
      </Box>

      {subtitle && (
        <Button
          size="small"
          variant={showSubtitle ? "contained" : "outlined"}
          onClick={() => setShowSubtitle((v) => !v)}
          sx={{ alignSelf: "flex-start" }}
        >
          {t(showSubtitle ? "eventForm.imageHideDate" : "eventForm.imageShowDate")}
        </Button>
      )}

      <Box>
        <Button variant="contained" onClick={use}>
          {t("eventForm.imageUse")}
        </Button>
      </Box>
    </Stack>
  );
}
