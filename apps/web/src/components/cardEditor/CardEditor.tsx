import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Checkbox, Divider, FormControlLabel, List, ListItemButton, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { cardDesignAssetIds, cardDesignSchema, cardTemplateIds, createCardTemplate, type CardDesign, type CardPart, type EventNameCard, type SavedCardDesign, type CardTemplateId } from "@eventer/shared";
import { api, ApiError } from "../../api/client.js";
import { cardAssetsKey, cardDesignKey, uploadCardAsset, type CardAsset } from "../../api/cardDesignHooks.js";
import type { EventCardContext } from "../licenseCard/EventCardSvg.js";
import { CardCanvas } from "./CardCanvas.js";
import { PartSettings } from "./PartSettings.js";
import { BackgroundSettings } from "./BackgroundSettings.js";
import { editBackground, editPart, newPart, removePart, reorderPart, resetRule, targetLayout, type EditTarget } from "./model.js";
import { useDesignHistory } from "./useDesignHistory.js";
import { copyEventDesign } from "./copyDesign.js";

export function CardEditor({ initial, context, members, assets, slots }: {
  initial: SavedCardDesign; context: EventCardContext; members: EventNameCard[];
  assets: CardAsset[]; slots: { id: string; name: string }[];
}) {
  const { t } = useTranslation(), navigate = useNavigate(), queryClient = useQueryClient();
  const history = useDesignHistory(initial.design ?? { ...createCardTemplate("name"), enabled: false });
  const [baseline, setBaseline] = useState(() => JSON.stringify(history.design));
  const [revision, setRevision] = useState(initial.revision);
  const [selected, setSelected] = useState<string | null>(null);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [gridSize, setGridSize] = useState(16);
  const [target, setTarget] = useState<EditTarget>("common");
  const [template, setTemplate] = useState<CardTemplateId>("name");
  const [kind, setKind] = useState<CardPart["kind"]>("text");
  const [memberId, setMemberId] = useState(members[0]?.id ?? "");
  const [addedAssets, setAddedAssets] = useState<CardAsset[]>([]);
  const [removedAssets, setRemovedAssets] = useState<string[]>([]);
  const [copySource, setCopySource] = useState("");
  const [copying, setCopying] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false), [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ text: string; severity: "error" | "success" } | null>(null);
  const design = history.design;
  const latestDesign = useRef(design); latestDesign.current = design;
  const dirty = JSON.stringify(design) !== baseline;
  const allAssets = useMemo(() => [...new Map([...assets, ...addedAssets].map(a => [a.id, a])).values()].filter(a => !removedAssets.includes(a.id)), [assets, addedAssets, removedAssets]);
  const layout = targetLayout(design, target);
  const part = layout.parts.find(p => p.id === selected);
  const sample: EventNameCard = {
    id: "sample", role: "participant", name: t("staffOps.cardEditorSample"), handle: "sample", avatarUrl: null,
    cardImageKey: null, createdAt: 0, communities: [],
    gamification: { level: 4, xp: 870, currentLevelXp: 700, nextLevelXp: 1100, badges: [] }, participation: { hosted: 9, spoken: 2, attended: 12, noShow: 0 },
  };
  const chosen = members.find(m => m.id === memberId) ?? sample;
  const card = { ...chosen,
    role: target === "staff" ? "staff" as const : target.startsWith("slot:") ? "participant" as const : chosen.role,
    slotName: target.startsWith("slot:") ? slots.find(s => s.id === target.slice(5))?.name ?? null : chosen.slotName,
  };
  useEffect(() => {
    if (!dirty) return;
    const unload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    const link = (e: MouseEvent) => {
      const anchor = (e.target as Element | null)?.closest?.("a[href]");
      if (anchor && !anchor.getAttribute("href")?.startsWith("#") && !window.confirm(t("staffOps.cardEditorDiscard"))) {
        e.preventDefault(); e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", unload); document.addEventListener("click", link, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", link, true); };
  }, [dirty, t]);
  const change = (next: CardDesign) => { history.edit(next); setMessage(null); };
  const changePart = (p: CardPart) => change(editPart(design, target, p));
  const save = async () => {
    const parsed = cardDesignSchema.safeParse(design);
    if (!parsed.success) { setMessage({ text: t("staffOps.cardEditorInvalid"), severity: "error" }); return; }
    setSaving(true); setMessage(null); setConflict(false);
    try {
      const result = await api.put<SavedCardDesign>(`/events/${context.eventId}/name-card-design`, { revision, design: parsed.data });
      setRevision(result.revision); setBaseline(JSON.stringify(design));
      queryClient.setQueryData(cardDesignKey(context.eventId), result);
      setMessage({ text: t("staffOps.cardEditorSaved"), severity: "success" });
    } catch (error) {
      setConflict(error instanceof ApiError && error.status === 409);
      setMessage({ text: t(error instanceof ApiError && error.status === 409 ? "staffOps.cardEditorConflict" : "staffOps.cardEditorSaveFailed"), severity: "error" });
    } finally { setSaving(false); }
  };
  const reload = async () => {
    if (!window.confirm(t("staffOps.cardEditorDiscard"))) return;
    setSaving(true);
    try {
      const [latest, files] = await Promise.all([
        api.get<SavedCardDesign>(`/events/${context.eventId}/name-card-design`),
        api.get<{ assets: CardAsset[] }>(`/events/${context.eventId}/name-card-assets`),
      ]);
      const next = latest.design ?? { ...createCardTemplate("name"), enabled: false };
      history.reset(next); setBaseline(JSON.stringify(next)); setRevision(latest.revision);
      setAddedAssets(files.assets); setRemovedAssets([]); setSelected(null); setTarget("common");
      queryClient.setQueryData(cardDesignKey(context.eventId), latest);
      queryClient.setQueryData(cardAssetsKey(context.eventId), files);
      setConflict(false); setMessage(null);
    } catch { setMessage({ text: t("staffOps.cardEditorLoadFailed"), severity: "error" }); }
    finally { setSaving(false); }
  };
  const upload = async (file: File) => {
    setUploading(true); setMessage(null);
    try { const asset = await uploadCardAsset(context.eventId, file); setAddedAssets(list => [...list, asset]); }
    catch { setMessage({ text: t("staffOps.cardEditorUploadFailed"), severity: "error" }); }
    finally { setUploading(false); }
  };
  const copy = async () => {
    if (!window.confirm(t("staffOps.cardEditorReplaceConfirm"))) return;
    setCopying(true); setMessage(null);
    const start = design;
    try {
      const result = await copyEventDesign(context.eventId, copySource, slots);
      setAddedAssets(list => [...list, ...result.assets]);
      if (latestDesign.current !== start && !window.confirm(t("staffOps.cardEditorReplaceConfirm"))) return;
      change(result.design); setTarget("common"); setSelected(null);
      if (result.skippedSlots) setMessage({ text: t("staffOps.cardEditorCopySlots", { n: result.skippedSlots }), severity: "success" });
    } catch { setMessage({ text: t("staffOps.cardEditorCopyFailed"), severity: "error" }); }
    finally { setCopying(false); }
  };
  const deleteAsset = async (id: string) => {
    if (cardDesignAssetIds(design).includes(id)) { setMessage({ text: t("staffOps.cardEditorImageInUse"), severity: "error" }); return; }
    if (!window.confirm(t("staffOps.cardEditorDeleteImageConfirm"))) return;
    try {
      await api.del(`/events/${context.eventId}/name-card-assets/${id}`);
      setRemovedAssets(ids => [...ids, id]);
    } catch (error) { setMessage({ text: t(error instanceof ApiError && error.status === 409 ? "staffOps.cardEditorImageInUse" : "staffOps.cardEditorSaveFailed"), severity: "error" }); }
  };
  const kindLabels = {
    text: t("staffOps.cardEditorText"), image: t("staffOps.cardEditorImage"), rect: t("staffOps.cardEditorRect"),
    qr: t("staffOps.cardEditorQr"), stats: t("staffOps.cardEditorStats"),
  };
  const sourceLabels = {
    literal: t("staffOps.cardEditorLiteral"), name: t("staffOps.cardEditorName"), handle: t("staffOps.cardEditorHandle"),
    event: t("staffOps.cardEditorEvent"), community: t("staffOps.cardEditorCommunity"), role: t("staffOps.cardEditorRole"), slot: t("staffOps.cardEditorSlot"),
  };
  return <Stack spacing={2} sx={{ maxWidth: 1500, mx: "auto" }}>
    <Typography variant="h5">{t("staffOps.cardEditorTitle")}</Typography>
    <Typography color="text.secondary">{t("staffOps.cardEditorIntro")}</Typography>
    <FormControlLabel label={t("staffOps.cardEditorEnabled")} control={<Checkbox checked={design.enabled} onChange={(_, enabled) => change({ ...design, enabled })} />} />
    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
      <TextField select size="small" label={t("staffOps.cardEditorTemplate")} value={template} onChange={e => setTemplate(e.target.value as CardTemplateId)} sx={{ minWidth: 180 }}>
        {cardTemplateIds.map((id, i) => <MenuItem key={id} value={id}>{[
          t("staffOps.cardEditorTemplateName"), t("staffOps.cardEditorTemplateProfile"), t("staffOps.cardEditorTemplateRole"),
        ][i]}</MenuItem>)}
      </TextField>
      <Button onClick={() => { if (window.confirm(t("staffOps.cardEditorReplaceConfirm"))) { change(createCardTemplate(template)); setTarget("common"); setSelected(null); } }}>{t("staffOps.cardEditorApplyTemplate")}</Button>
      <Button disabled={!history.canUndo} onClick={history.undo}>{t("staffOps.cardEditorUndo")}</Button>
      <Button disabled={!history.canRedo} onClick={history.redo}>{t("staffOps.cardEditorRedo")}</Button>
      <Button variant="contained" disabled={saving || uploading || !dirty} onClick={() => void save()}>{t("staffOps.cardEditorSave")}</Button>
      <Button disabled={dirty || saving} onClick={() => navigate(`/events/${context.eventId}/name-cards`)}>{t("staffOps.cardEditorPrint")}</Button>
    </Stack>
    <Accordion><AccordionSummary>{t("staffOps.cardEditorCopy")}</AccordionSummary><AccordionDetails>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        <TextField fullWidth size="small" label={t("staffOps.cardEditorCopyEvent")} value={copySource} onChange={e => setCopySource(e.target.value)} />
        <Button disabled={copying || uploading || saving || !copySource.trim()} onClick={() => void copy()}>{t("staffOps.cardEditorCopy")}</Button>
      </Stack>
    </AccordionDetails></Accordion>
    {dirty && <Alert severity="info">{t("staffOps.cardEditorUnsaved")}</Alert>}
    {message && <Alert severity={message.severity}>{message.text}</Alert>}
    {conflict && <Button disabled={saving} onClick={() => void reload()}>{t("staffOps.cardEditorRetry")}</Button>}
    <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
      <TextField select size="small" fullWidth label={t("staffOps.cardEditorTarget")} value={target} onChange={e => { setTarget(e.target.value as EditTarget); setSelected(null); }}>
        <MenuItem value="common">{t("staffOps.cardEditorCommon")}</MenuItem><MenuItem value="staff">{t("staffOps.cardEditorStaff")}</MenuItem>
        {slots.map(s => <MenuItem key={s.id} value={`slot:${s.id}`}>{s.name}</MenuItem>)}
      </TextField>
      <TextField select size="small" fullWidth label={t("staffOps.cardEditorPreview")} value={memberId} onChange={e => setMemberId(e.target.value)}>
        <MenuItem value="">{t("staffOps.cardEditorSample")}</MenuItem>{members.map(m => <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>)}
      </TextField>
    </Stack>
    <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap" alignItems="center">
      <FormControlLabel label={t("staffOps.cardEditorSnapGrid")} control={<Checkbox checked={snapToGrid} onChange={(_, checked) => setSnapToGrid(checked)} />} />
      <TextField type="number" size="small" label={t("staffOps.cardEditorGridSize")} value={gridSize}
        inputProps={{ min: 1, max: 100, step: 1 }} sx={{ width: 160 }}
        onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1 && n <= 100) setGridSize(n); }} />
      <Typography variant="caption" color="text.secondary">{t("staffOps.cardEditorGridHint")}</Typography>
    </Stack>
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "minmax(0,1fr)", md: "220px minmax(0,1fr)" },
      gridTemplateAreas: { xs: '"canvas" "settings" "parts"', md: '"canvas canvas" "parts settings"' }, gap: 2, alignItems: "start" }}>
      <Box sx={{ minWidth: 0, gridArea: "canvas" }}><CardCanvas key={target} layout={layout} card={card} context={context} selected={selected} onSelect={setSelected} onChange={changePart} gridSize={snapToGrid ? gridSize : 0} /></Box>
      <Paper variant="outlined" sx={{ p: 2, minWidth: 0, gridArea: "parts" }}>
        <Typography variant="h6">{t("staffOps.cardEditorParts")}</Typography>
        <List dense>{layout.parts.map((p, i) => <ListItemButton key={p.id} selected={selected === p.id} onClick={() => setSelected(p.id)}>{i + 1}. {p.kind === "text" ? sourceLabels[p.source] : kindLabels[p.kind]}{p.kind === "text" && p.source === "literal" ? `: ${p.text.slice(0, 12)}` : ""}</ListItemButton>)}</List>
        <TextField select size="small" fullWidth value={kind} label={t("staffOps.cardEditorParts")} onChange={e => setKind(e.target.value as CardPart["kind"])}>
          {(Object.keys(kindLabels) as CardPart["kind"][]).map(k => <MenuItem key={k} value={k}>{kindLabels[k]}</MenuItem>)}
        </TextField>
        <Button disabled={layout.parts.length >= 40} onClick={() => { const p = newPart(kind); changePart(p); setSelected(p.id); }}>{t("staffOps.cardEditorAdd")}</Button>
        {target !== "common" && <Button onClick={() => { change(resetRule(design, target)); setSelected(null); }}>{t("staffOps.cardEditorResetRule")}</Button>}
      </Paper>
      <Paper variant="outlined" sx={{ p: 2, minWidth: 0, gridArea: "settings" }}>
        <Stack spacing={2}>
          <Typography variant="h6">{t("staffOps.cardEditorSettings")}</Typography>
          {part ? <>
            <PartSettings key={part.id} part={part} assets={allAssets} onChange={changePart} />
            <Button onClick={() => change(reorderPart(design, target, part.id, 1))}>{t("staffOps.cardEditorFront")}</Button>
            <Button onClick={() => change(reorderPart(design, target, part.id, -1))}>{t("staffOps.cardEditorBack")}</Button>
            <Button color="error" onClick={() => { change(removePart(design, target, part.id)); setSelected(null); }}>{t("staffOps.cardEditorRemove")}</Button>
          </> : <Typography color="text.secondary">{t("staffOps.cardEditorSelect")}</Typography>}
          <Divider /><Typography variant="h6">{t("staffOps.cardEditorBackground")}</Typography>
          <BackgroundSettings background={layout.background} assets={allAssets} onChange={b => change(editBackground(design, target, b))} />
          <Button component="label" disabled={uploading}>{t("staffOps.cardEditorUpload")}
            <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void upload(file); }} />
          </Button>
          <Accordion><AccordionSummary>{t("staffOps.cardEditorImage")}</AccordionSummary><AccordionDetails>
            <Stack spacing={1}>{allAssets.map((asset, i) => <Stack key={asset.id} direction="row" spacing={1} alignItems="center">
              <img src={asset.url} loading="lazy" alt={`${i + 1}`} width={48} height={48} style={{ objectFit: "contain" }} />
              <Button size="small" color="error" disabled={cardDesignAssetIds(design).includes(asset.id)} onClick={() => void deleteAsset(asset.id)}>{t("staffOps.cardEditorDeleteImage")}</Button>
            </Stack>)}</Stack>
          </AccordionDetails></Accordion>
        </Stack>
      </Paper>
    </Box>
  </Stack>;
}
