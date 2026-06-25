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
import {
  BACKGROUNDS,
  FONTS,
  LAYOUTS,
  drawEventImage,
  loadFont,
  type LayoutKey,
} from "../lib/imageTemplates.js";

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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rand = (n: number) => Math.floor(Math.random() * n);
  const [fontIdx, setFontIdx] = useState(() => rand(FONTS.length));
  const [bgIdx, setBgIdx] = useState(() => rand(BACKGROUNDS.length));
  const [layout, setLayout] = useState<LayoutKey>(
    () => LAYOUTS[rand(LAYOUTS.length)].key,
  );
  const [titleSize, setTitleSize] = useState(() => 72 + rand(7) * 8);
  const [showSubtitle, setShowSubtitle] = useState(Boolean(subtitle));

  const shuffle = () => {
    setFontIdx(rand(FONTS.length));
    setBgIdx(rand(BACKGROUNDS.length));
    setLayout(LAYOUTS[rand(LAYOUTS.length)].key);
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

      <Button variant="outlined" onClick={shuffle} sx={{ alignSelf: "flex-start" }}>
        🎲 おまかせ（ランダム）
      </Button>

      <TextField
        select
        size="small"
        label="フォント"
        value={fontIdx}
        onChange={(e) => setFontIdx(Number(e.target.value))}
        sx={{ maxWidth: 280 }}
      >
        {(["ゴシック", "丸ゴシック", "明朝", "手書き・個性派"] as const).flatMap(
          (cat) => [
            <ListSubheader key={cat}>{cat}</ListSubheader>,
            ...FONTS.map((f, i) =>
              f.category === cat ? (
                <MenuItem key={i} value={i}>
                  {f.label}
                </MenuItem>
              ) : null,
            ).filter(Boolean),
          ],
        )}
      </TextField>

      <Box>
        <Typography variant="caption" color="text.secondary">
          背景
        </Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
          {BACKGROUNDS.map((b, i) => (
            <Button
              key={b.label}
              size="small"
              variant={bgIdx === i ? "contained" : "outlined"}
              onClick={() => setBgIdx(i)}
            >
              {b.label}
            </Button>
          ))}
        </Stack>
      </Box>

      <Box>
        <Typography variant="caption" color="text.secondary">
          レイアウト
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
              <ToggleButton key={l.key} value={l.key}>
                {l.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>
      </Box>

      <Box sx={{ maxWidth: 280 }}>
        <Typography variant="caption" color="text.secondary">
          文字サイズ
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
          日付を{showSubtitle ? "隠す" : "表示"}
        </Button>
      )}

      <Box>
        <Button variant="contained" onClick={use}>
          この画像を使う
        </Button>
      </Box>
    </Stack>
  );
}
