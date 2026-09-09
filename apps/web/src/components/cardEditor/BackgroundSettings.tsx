import { MenuItem, Stack, TextField } from "@mui/material";
import { useTranslation } from "react-i18next";
import type { CardLayout } from "@eventer/shared";
import type { CardAsset } from "../../api/cardDesignHooks.js";

export function BackgroundSettings({ background, assets, onChange }: {
  background: CardLayout["background"]; assets: CardAsset[]; onChange: (background: CardLayout["background"]) => void;
}) {
  const { t } = useTranslation();
  return <Stack spacing={2}>
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
  </Stack>;
}
