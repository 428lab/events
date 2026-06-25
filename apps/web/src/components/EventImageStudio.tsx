import { useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  ListSubheader,
  MenuItem,
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
  const [fontIdx, setFontIdx] = useState(0);
  const [bgIdx, setBgIdx] = useState(0);
  const [layout, setLayout] = useState<LayoutKey>("center");
  const [showSubtitle, setShowSubtitle] = useState(Boolean(subtitle));

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
      });
    })();
    return () => {
      alive = false;
    };
  }, [font, background, layout, title, subtitle, showSubtitle]);

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
