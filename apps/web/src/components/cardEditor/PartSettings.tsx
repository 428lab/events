import { Button, Checkbox, FormControlLabel, ListSubheader, MenuItem, Stack, TextField } from "@mui/material";
import { useTranslation } from "react-i18next";
import { DISPLAY_FONTS, type CardPart, type CardFont } from "@eventer/shared";
import type { CardAsset } from "../../api/cardDesignHooks.js";

const fontCategory = {
  ゴシック: "eventForm.imageFontGothic", 丸ゴシック: "eventForm.imageFontRounded",
  明朝: "eventForm.imageFontMincho", "手書き・個性派": "eventForm.imageFontDisplay",
} as const;

export function PartSettings({ part, assets, onChange }: { part: CardPart; assets: CardAsset[]; onChange: (part: CardPart) => void }) {
  const { t } = useTranslation();
  const fixedWeight = part.kind === "text" && DISPLAY_FONTS.find(f => f.family === part.font)?.weight === 400;
  const number = (label: string, value: number, change: (n: number) => void, min = 0, max = 1074) =>
    <TextField label={label} type="number" size="small" value={value} inputProps={{ min, max, step: max === 1 ? 0.05 : 1 }}
      onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n)) change(Math.max(min, Math.min(max, n))); }} />;
  const color = "color" in part ? <TextField label={t("staffOps.cardEditorColor")} type="color" size="small" value={part.color}
    onChange={e => onChange({ ...part, color: e.target.value })} /> : null;
  const font = "fontSize" in part ? number(t("staffOps.cardEditorFontSize"), part.fontSize,
    n => onChange({ ...part, fontSize: n }), 10, part.kind === "stats" ? 72 : 144) : null;
  return <Stack spacing={2}>
    <Stack direction="row" spacing={1}>
      {number("X", part.x, x => onChange({ ...part, x }), 0, 1074 - part.width)}
      {number("Y", part.y, y => onChange({ ...part, y }), 0, 650 - part.height)}
    </Stack>
    <Stack spacing={1}>
      <Button size="small" onClick={() => onChange({ ...part, x: (1074 - part.width) / 2 })}>{t("staffOps.cardEditorCenterX")}</Button>
      <Button size="small" onClick={() => onChange({ ...part, y: (650 - part.height) / 2 })}>{t("staffOps.cardEditorCenterY")}</Button>
    </Stack>
    {number(t("staffOps.cardEditorWidth"), part.width, width => onChange({ ...part, width,
      ...(part.kind === "qr" ? { height: width } : {}) }), part.kind === "qr" ? 120 : 8,
      part.kind === "qr" ? Math.min(1074 - part.x, 650 - part.y) : 1074 - part.x)}
    {part.kind !== "qr" && number(t("staffOps.cardEditorHeight"), part.height,
      height => onChange({ ...part, height }), 8, 650 - part.y)}
    {part.kind !== "qr" && number(t("staffOps.cardEditorOpacity"), part.opacity,
      opacity => onChange({ ...part, opacity }), 0, 1)}
    {color}{font}
    {part.kind === "text" && <>
      <TextField select size="small" label={t("staffOps.cardEditorFont")} value={part.font ?? "default"}
        onChange={e => onChange({ ...part, font: e.target.value as CardFont })}>
        <MenuItem value="default">{t("staffOps.cardEditorDefaultFont")}</MenuItem>
        {DISPLAY_FONTS.flatMap((f, i) => [
          DISPLAY_FONTS[i - 1]?.category !== f.category
            ? <ListSubheader key={f.category}>{t(fontCategory[f.category])}</ListSubheader> : null,
          <MenuItem key={f.family} value={f.family}>{f.label}</MenuItem>,
        ])}
      </TextField>
      <TextField select size="small" label={t("staffOps.cardEditorSource")} value={part.source}
        onChange={e => onChange({ ...part, source: e.target.value as typeof part.source })}>
        {([
          ["literal", "cardEditorLiteral"], ["name", "cardEditorName"], ["handle", "cardEditorHandle"],
          ["event", "cardEditorEvent"], ["community", "cardEditorCommunity"], ["role", "cardEditorRole"], ["slot", "cardEditorSlot"],
        ] as const).map(([value, key]) => <MenuItem key={value} value={value}>{t(`staffOps.${key}`)}</MenuItem>)}
      </TextField>
      {part.source === "literal" && <TextField multiline minRows={2} label={t("staffOps.cardEditorLiteral")} value={part.text}
        inputProps={{ maxLength: 300 }} onChange={e => onChange({ ...part, text: e.target.value })} />}
      <FormControlLabel label={t(fixedWeight ? "staffOps.cardEditorFixedWeight" : "staffOps.cardEditorBold")}
        control={<Checkbox disabled={fixedWeight} checked={!fixedWeight && part.bold} onChange={(_, bold) => onChange({ ...part, bold })} />} />
      <TextField select size="small" label={t("staffOps.cardEditorAlign")} value={part.align}
        onChange={e => onChange({ ...part, align: e.target.value as typeof part.align })}>
        {(["start", "middle", "end"] as const).map((value, i) => <MenuItem key={value} value={value}>{t([
          "staffOps.cardEditorStart", "staffOps.cardEditorMiddle", "staffOps.cardEditorEnd",
        ][i] as "staffOps.cardEditorStart")}</MenuItem>)}
      </TextField>
    </>}
    {part.kind === "image" && <>
      <TextField select size="small" label={t("staffOps.cardEditorSource")} value={part.source}
        onChange={e => onChange({ ...part, source: e.target.value as typeof part.source })}>
        <MenuItem value="avatar">{t("staffOps.cardEditorAvatar")}</MenuItem>
        <MenuItem value="community">{t("staffOps.cardEditorCommunity")}</MenuItem>
        <MenuItem value="asset">{t("staffOps.cardEditorAsset")}</MenuItem>
      </TextField>
      {part.source === "asset" && <TextField select size="small" label={t("staffOps.cardEditorAsset")} value={part.assetId ?? ""}
        onChange={e => onChange({ ...part, assetId: e.target.value || undefined })}>
        <MenuItem value="">{t("staffOps.cardEditorNoImage")}</MenuItem>
        {assets.map((a, i) => <MenuItem key={a.id} value={a.id}><img src={a.url} alt="" width={32} height={32} style={{ objectFit: "contain", marginRight: 8 }} />{i + 1} · {a.width}×{a.height}</MenuItem>)}
      </TextField>}
      <TextField select size="small" label={t("staffOps.cardEditorFit")} value={part.fit} onChange={e => onChange({ ...part, fit: e.target.value as typeof part.fit })}>
        <MenuItem value="contain">{t("staffOps.cardEditorContain")}</MenuItem><MenuItem value="cover">{t("staffOps.cardEditorCover")}</MenuItem>
      </TextField>
    </>}
    {part.kind === "qr" && <TextField select size="small" label={t("staffOps.cardEditorSource")} value={part.source}
      onChange={e => onChange({ ...part, source: e.target.value as typeof part.source })}>
      <MenuItem value="profile">{t("staffOps.cardEditorProfileQr")}</MenuItem><MenuItem value="event">{t("staffOps.cardEditorEventQr")}</MenuItem>
    </TextField>}
  </Stack>;
}
