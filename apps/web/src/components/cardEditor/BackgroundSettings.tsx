import { useEffect, useState } from "react";
import { Box, ButtonBase, MenuItem, Slider, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { CARD_PATTERN_CATALOGUE, cardPatternKeys, type CardLayout, type CardPatternKey, type CardPatternTheme } from "@eventer/shared";
import type { CardAsset } from "../../api/cardDesignHooks.js";
import { BG_VARIANTS, CARD_THEMES } from "../licenseCard/cardTheme.js";
import { cardPatternMarkup, licenseVariantOf } from "../licenseCard/cardPattern.js";

type Background = CardLayout["background"];
export type BackgroundMode = "participant" | "builtin" | "plain";
interface PatternChoice { key: CardPatternKey; palette: CardPatternTheme }
const DEFAULT_CHOICE: PatternChoice = { key: "rosette", palette: "indigo" };

export function backgroundMode(background: Background): BackgroundMode {
  return background.pattern?.type ?? "plain";
}
/** Switching modes keeps the colour/image settings and the last pattern choice, so switching back restores them. */
export function withBackgroundMode(background: Background, mode: BackgroundMode): Background {
  const { pattern, ...plain } = background;
  if (mode === "plain") return plain;
  const strength = pattern?.strength ?? 1;
  const choice = pattern?.type === "builtin" ? { key: pattern.key, palette: pattern.palette }
    : pattern?.type === "participant" ? pattern.fallback : DEFAULT_CHOICE;
  return { ...plain, pattern: mode === "participant"
    ? { type: "participant", fallback: choice, strength }
    : { type: "builtin", ...choice, strength } };
}

/** Thumbnails are rasterised by the browser from a blob URL, so the picker never puts dozens of 0.2–0.6 MB SVG trees into the DOM. */
const thumbUrls = new Map<string, string>();
function PatternThumb({ choice }: { choice: PatternChoice }) {
  const id = `${choice.key}-${choice.palette}`;
  const [url, setUrl] = useState(() => thumbUrls.get(id));
  useEffect(() => {
    if (url || typeof URL.createObjectURL !== "function") return;
    // Generate after paint, one thumbnail per task, so opening the picker does not block input.
    const timer = window.setTimeout(() => {
      let next = thumbUrls.get(id);
      if (!next) {
        next = URL.createObjectURL(new Blob([cardPatternMarkup({ ...choice, strength: 1 })], { type: "image/svg+xml" }));
        thumbUrls.set(id, next);
      }
      setUrl(next);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [id, url, choice]);
  return url ? <img src={url} alt="" width={96} height={58} style={{ display: "block", width: "100%", height: "auto" }} />
    : <Box sx={{ width: "100%", aspectRatio: "1074 / 650", bgcolor: "#F8FAFC" }} />;
}

function PatternPicker({ value, onChange }: { value: PatternChoice; onChange: (choice: PatternChoice) => void }) {
  const { t } = useTranslation();
  const guillocheName: Record<string, string> = {
    rosette: t("profile.cardBgRosette"), engine: t("staffOps.cardEditorBgEngine"),
    ribbons: t("staffOps.cardEditorBgRibbons"), mesh: t("staffOps.cardEditorBgMesh"),
  };
  const nameOf = (key: CardPatternKey) => {
    const variant = licenseVariantOf(key);
    return variant ? t(BG_VARIANTS.find(v => v.key === variant)!.labelKey) : guillocheName[key] ?? key;
  };
  const themeName = (palette: CardPatternTheme) => t(CARD_THEMES.find(c => c.key === palette)!.nameKey);
  const groups = [
    { title: t("staffOps.cardEditorBgGuilloche"), keys: cardPatternKeys.filter(k => !licenseVariantOf(k)) },
    { title: t("staffOps.cardEditorBgLicense"), keys: cardPatternKeys.filter(k => licenseVariantOf(k)) },
  ];
  return <Stack spacing={1.5}>
    {groups.map(group => <Box key={group.title} role="group" aria-label={group.title}>
      <Typography variant="subtitle2" gutterBottom>{group.title}</Typography>
      {group.keys.map(key => <Box key={key} sx={{ mb: 1 }}>
        <Typography variant="caption" color="text.secondary">{nameOf(key)}</Typography>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))", gap: 0.75 }}>
          {(CARD_PATTERN_CATALOGUE[key] as readonly CardPatternTheme[]).map(palette => {
            const selected = value.key === key && value.palette === palette;
            return <ButtonBase key={palette} aria-pressed={selected} aria-label={`${nameOf(key)} · ${themeName(palette)}`}
              title={`${nameOf(key)} · ${themeName(palette)}`} onClick={() => onChange({ key, palette })}
              sx={{ display: "block", border: 2, borderColor: selected ? "primary.main" : "divider", borderRadius: 1, overflow: "hidden", minHeight: 44 }}>
              <PatternThumb choice={{ key, palette }} />
              <Typography component="span" variant="caption" sx={{ display: "block", lineHeight: 1.6, color: "text.secondary" }}>{themeName(palette)}</Typography>
            </ButtonBase>;
          })}
        </Box>
      </Box>)}
    </Box>)}
  </Stack>;
}

function StrengthSlider({ value, onCommit }: { value: number; onCommit: (strength: number) => void }) {
  const { t } = useTranslation();
  // Preview the number while dragging; commit once, so one drag is one undo step and one regeneration.
  const [shown, setShown] = useState(value);
  useEffect(() => setShown(value), [value]);
  return <Box>
    <Typography id="card-bg-strength" variant="body2">{t("staffOps.cardEditorBgStrength")}: {Math.round(shown * 100)}%</Typography>
    <Slider aria-labelledby="card-bg-strength" min={0.4} max={1} step={0.05} value={shown}
      onChange={(_, v) => setShown(v as number)} onChangeCommitted={(_, v) => onCommit(v as number)} />
    <Typography variant="caption" color="text.secondary">{t("staffOps.cardEditorBgStrengthHelp")}</Typography>
  </Box>;
}

export function BackgroundSettings({ background, assets, onChange }: {
  background: Background; assets: CardAsset[]; onChange: (background: Background) => void;
}) {
  const { t } = useTranslation();
  const mode = backgroundMode(background);
  const pattern = background.pattern;
  return <Stack spacing={2}>
    <Box>
      <Typography variant="body2" gutterBottom>{t("staffOps.cardEditorBgMode")}</Typography>
      <ToggleButtonGroup exclusive size="small" value={mode} aria-label={t("staffOps.cardEditorBgMode")}
        onChange={(_, next: BackgroundMode | null) => { if (next) onChange(withBackgroundMode(background, next)); }}
        sx={{ flexWrap: "wrap", "& .MuiToggleButton-root": { flex: "1 1 auto", minHeight: 44 } }}>
        <ToggleButton value="participant">{t("staffOps.cardEditorBgModeParticipant")}</ToggleButton>
        <ToggleButton value="builtin">{t("staffOps.cardEditorBgModeBuiltin")}</ToggleButton>
        <ToggleButton value="plain">{t("staffOps.cardEditorBgModePlain")}</ToggleButton>
      </ToggleButtonGroup>
    </Box>
    {pattern?.type === "participant" && <>
      <Typography variant="caption" color="text.secondary">{t("staffOps.cardEditorBgParticipantHelp")}</Typography>
      <Typography variant="subtitle2">{t("staffOps.cardEditorBgFallback")}</Typography>
      <PatternPicker value={pattern.fallback} onChange={fallback => onChange({ ...background, pattern: { ...pattern, fallback } })} />
    </>}
    {pattern?.type === "builtin" && <PatternPicker value={pattern} onChange={choice => onChange({ ...background, pattern: { ...pattern, ...choice } })} />}
    {pattern && <StrengthSlider value={pattern.strength} onCommit={strength => onChange({ ...background, pattern: { ...pattern, strength } })} />}
    {!pattern && <>
      <TextField size="small" label={t("staffOps.cardEditorColor")} type="color" value={background.color} onChange={e => onChange({ ...background, color: e.target.value })} />
      <TextField select size="small" label={t("staffOps.cardEditorBackground")} value={background.assetId ?? ""}
        onChange={e => onChange({ ...background, assetId: e.target.value || undefined })}>
        <MenuItem value="">{t("staffOps.cardEditorNoImage")}</MenuItem>
        {assets.map((a, i) => <MenuItem key={a.id} value={a.id}><img src={a.url} alt="" width={32} height={32} style={{ objectFit: "contain", marginRight: 8 }} />{i + 1} · {a.width}×{a.height}</MenuItem>)}
      </TextField>
      {background.assetId && <>
        <TextField size="small" type="number" label={t("staffOps.cardEditorOpacity")} value={background.opacity} inputProps={{ min: 0, max: 1, step: 0.05 }}
          onChange={e => onChange({ ...background, opacity: Math.max(0, Math.min(1, Number(e.target.value))) })} />
        <TextField select size="small" label={t("staffOps.cardEditorFit")} value={background.fit} onChange={e => onChange({ ...background, fit: e.target.value as typeof background.fit })}>
          <MenuItem value="contain">{t("staffOps.cardEditorContain")}</MenuItem><MenuItem value="cover">{t("staffOps.cardEditorCover")}</MenuItem>
        </TextField>
        {(["positionX", "positionY"] as const).map((axis, i) => <TextField key={axis} select size="small" label={i === 0 ? "X" : "Y"}
          value={background[axis]} onChange={e => onChange({ ...background, [axis]: Number(e.target.value) })}>
          <MenuItem value={0}>0%</MenuItem><MenuItem value={0.5}>50%</MenuItem><MenuItem value={1}>100%</MenuItem>
        </TextField>)}
      </>}
    </>}
  </Stack>;
}
