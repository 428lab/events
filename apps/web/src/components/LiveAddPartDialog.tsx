import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { EVENT_INFO_FIELDS } from "@eventer/shared";
import type { EventInfoField, LiveElement, LiveScene, VisualStyle } from "@eventer/shared";
import {
  LIVE_BASIC_PARTS,
  LIVE_MOTIF_KINDS,
  LIVE_STREAM_PARTS,
  isLightLiveScene,
  livePartNeedsSettings,
  newLivePartElement,
  orderedVisualParts,
  sceneVisualStyle,
} from "../lib/liveParts.js";
import type { LivePartKind } from "../lib/liveParts.js";
import { newImageElement } from "../lib/liveScenes.js";
import { ChatFields, CountdownTargetFields, FlameFrameFields, INFO_LABEL_KEY } from "./LiveElementPanel.js";
import { LivePartPreview } from "./LivePartPreview.js";

/** 種類ごとの呼び名と一行説明。訳した文字列ではなくキーを持つ (#367) */
const PART_TEXT_KEYS = {
  text: ["studio.elementText", "studio.partDescText"],
  image: ["studio.elementImage", "studio.partDescImage"],
  camera: ["studio.elementCamera", "studio.partDescCamera"],
  deck: ["studio.elementDeck", "studio.partDescDeck"],
  eventInfo: ["studio.elementEventInfo", "studio.partDescEventInfo"],
  chat: ["studio.elementChat", "studio.partDescChat"],
  marquee: ["studio.elementMarquee", "studio.partDescMarquee"],
  clock: ["studio.elementClock", "studio.partDescClock"],
  countdown: ["studio.elementCountdown", "studio.partDescCountdown"],
  liveIndicator: ["studio.elementLiveIndicator", "studio.partDescLiveIndicator"],
  motif: ["studio.elementMotif", "studio.partDescMotif"],
  flameFrame: ["studio.elementFlameFrame", "studio.partDescFlameFrame"],
} as const satisfies Record<LivePartKind, readonly [string, string]>;

/** デザイン部品の名前 */
const DESIGN_PART_TITLE_KEYS = {
  "glow-name": "studio.glowNamePart", "glow-camera": "studio.glowCameraPart", "glow-chapter": "studio.glowChapterPart", "glow-break": "studio.glowBreakPart",
  "signal-name": "studio.signalNamePart", "signal-camera": "studio.signalCameraPart", "signal-chapter": "studio.signalChapterPart", "signal-info": "studio.signalInfoPart",
  "hakuji-name": "studio.hakujiNameCard", "hakuji-camera": "studio.hakujiCameraCard", "hakuji-chapter": "studio.hakujiChapterCard", "hakuji-break": "studio.hakujiBreakCard",
} as const;
const STYLE_NAME_KEYS = { glow: "studio.chatStyleglow", signal: "studio.chatStylesignal", hakuji: "studio.chatStylehakuji" } as const satisfies Record<VisualStyle, string>;
/** 他のスタイルのデザイン部品は、そのスタイルの地色の上で見せる */
const STYLE_BACKGROUNDS = { glow: "#0E1426", signal: "#0A1120", hakuji: "#F6F2EA" } as const satisfies Record<VisualStyle, string>;

/** 流れる案内の速さ。一周の秒数（12–40秒の範囲）に読み替える */
const MARQUEE_SPEEDS = [
  { seconds: 12, label: "studio.marqueeSpeedFast" },
  { seconds: 20, label: "studio.marqueeSpeedNormal" },
  { seconds: 32, label: "studio.marqueeSpeedSlow" },
] as const;

const THUMB_W = 144;
const THUMB_H = 81;
/** 設定欄の大きな見本の高さの上限（px） */
const PREVIEW_MAX_H = 300;

/**
 * 「パーツを追加」のダイアログ (#566)。
 *
 * 1 段目はサムネイル付きの一覧（基本・配信の演出・デザイン部品）。
 * 設定の要るものは 2 段目で大きな見本を見ながら値を決めてから置く。カメラ・スライドと
 * デザイン部品は選んだ時点で置き、画像は選ばせて上げ終わった時点で置く。
 *
 * 置く操作は呼ぶ側に任せる（上限の判定・選択・履歴は編集画面が持つ）。置けなかった
 * ときは false が返るので、ダイアログを閉じずに理由を出す。
 */
export function LiveAddPartDialog({
  open,
  onClose,
  scene,
  error,
  onAddElement,
  onAddPart,
  pickImage,
  uploading,
}: {
  open: boolean;
  onClose: () => void;
  /** 開いているシーン。スタイル（色の既定値）と見本の背景に使う */
  scene: LiveScene | undefined;
  /** 置けなかった理由（編集画面が持つ） */
  error: string;
  onAddElement: (el: LiveElement) => boolean;
  onAddPart: (elements: LiveElement[]) => boolean;
  pickImage: (onPicked: (url: string) => void) => void;
  uploading: boolean;
}) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("md"));
  const style = sceneVisualStyle(scene);
  const light = isLightLiveScene(scene);
  const background = scene?.background || "#0E1426";
  const [kind, setKind] = useState<LivePartKind | null>(null);
  const [draft, setDraft] = useState<LiveElement | null>(null);
  /** このダイアログを開いてから置けなかったか。前に出た理由を持ち越さない */
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKind(null);
    setDraft(null);
    setFailed(false);
  }, [open]);

  // 一覧の見本は開くたびに作る（id が変わると炎の 1 コマを描き直すので、開いている間は固定）
  const samples = useMemo(
    () => Object.fromEntries([...LIVE_BASIC_PARTS, ...LIVE_STREAM_PARTS].map(k => [k, newLivePartElement(k, style, t("studio.marqueeDefaultText"))])) as Record<LivePartKind, LiveElement>,
    [open, style, i18n.language],
  );
  const designParts = useMemo(() => orderedVisualParts(style), [style]);

  const finish = (added: boolean) => {
    if (added) onClose();
    else setFailed(true);
  };

  const choose = (next: LivePartKind) => {
    setFailed(false);
    if (next === "image") {
      pickImage(url => finish(onAddElement(newImageElement(url))));
      return;
    }
    const el = newLivePartElement(next, style, t("studio.marqueeDefaultText"));
    if (!livePartNeedsSettings(next)) { finish(onAddElement(el)); return; }
    setKind(next);
    setDraft(el);
  };
  const patch = (p: Partial<LiveElement>) => setDraft(d => (d ? { ...d, ...p } : d));
  const back = () => { setKind(null); setDraft(null); setFailed(false); };

  const card = (key: string, name: string, description: string, thumb: ReactNode, thumbBackground: string, onClick: () => void, disabled = false) => (
    <ButtonBase
      key={key}
      onClick={onClick}
      disabled={disabled}
      aria-label={name}
      aria-describedby={`live-add-part-${key}-desc`}
      sx={{ display: "flex", flexDirection: "column", alignItems: "stretch", textAlign: "left", borderRadius: 1.5, border: 1, borderColor: "divider", overflow: "hidden", "&:hover, &.Mui-focusVisible": { borderColor: "primary.main", bgcolor: "action.hover" } }}
    >
      <Box sx={{ display: "flex", justifyContent: "center", background: thumbBackground }}>{thumb}</Box>
      <Box sx={{ px: 1, py: 0.75 }}>
        <Typography variant="body2" fontWeight={700}>{name}</Typography>
        <Typography id={`live-add-part-${key}-desc`} variant="caption" color="text.secondary" component="div" sx={{ lineHeight: 1.35 }}>{description}</Typography>
      </Box>
    </ButtonBase>
  );
  const kindCard = (k: LivePartKind) => card(
    k, t(PART_TEXT_KEYS[k][0]), t(PART_TEXT_KEYS[k][1]),
    <LivePartPreview elements={[samples[k]]} background={background} lightScene={light} width={THUMB_W} height={THUMB_H} />,
    background, () => choose(k), k === "image" && uploading,
  );
  const grid = (children: ReactNode) => (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: "repeat(auto-fill, minmax(160px, 1fr))" }, gap: 1, mb: 2 }}>{children}</Box>
  );
  const heading = (label: string) => <Typography variant="subtitle2" sx={{ mb: 1 }}>{label}</Typography>;

  const errorLine = failed && error ? <Typography role="alert" color="error" variant="body2" sx={{ mb: 1 }}>{error}</Typography> : null;

  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen} fullWidth maxWidth="md" aria-labelledby="live-add-part-title">
      <DialogTitle id="live-add-part-title" sx={{ pr: 6 }}>
        {kind ? t("studio.addPartSettingsTitle", { name: t(PART_TEXT_KEYS[kind][0]) }) : t("studio.addPart")}
        <IconButton aria-label={t("common.close")} onClick={onClose} sx={{ position: "absolute", right: 8, top: 8 }}><CloseIcon /></IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {errorLine}
        {kind && draft ? (
          <Stack spacing={2}>
            <PartPreviewLarge draft={draft} background={background} light={light} />
            <Stack spacing={1.5} sx={{ maxWidth: 480 }}>
              <PartSettings kind={kind} draft={draft} patch={patch} background={background} light={light} />
            </Stack>
          </Stack>
        ) : (
          <>
            {heading(t("studio.addPartGroupBasic"))}
            {grid(LIVE_BASIC_PARTS.map(kindCard))}
            {heading(t("studio.addPartGroupStream"))}
            {grid(LIVE_STREAM_PARTS.map(kindCard))}
            {heading(t("studio.addPartGroupDesign"))}
            {grid(designParts.map(({ family, part }) => card(
              `${family}-${part.id}`,
              t(DESIGN_PART_TITLE_KEYS[`${family}-${part.id}` as keyof typeof DESIGN_PART_TITLE_KEYS]),
              t("studio.partDescDesign", { style: t(STYLE_NAME_KEYS[family]), layers: t("studio.partLayers", { count: part.elements.length }) }),
              <LivePartPreview elements={part.elements} background={family === style ? background : STYLE_BACKGROUNDS[family]} lightScene={family === "hakuji"} width={THUMB_W} height={THUMB_H} />,
              family === style ? background : STYLE_BACKGROUNDS[family],
              () => { setFailed(false); finish(onAddPart(part.elements)); },
            )))}
          </>
        )}
      </DialogContent>
      {kind && draft && (
        <DialogActions>
          <Button onClick={back}>{t("common.back")}</Button>
          <Button variant="contained" onClick={() => finish(onAddElement(draft))}>{t("common.add")}</Button>
        </DialogActions>
      )}
    </Dialog>
  );
}

/** 設定欄の大きな見本。幅いっぱい（高さは上限まで）に、実際に動かして描く */
function PartPreviewLarge({ draft, background, light }: { draft: LiveElement; background: string; light: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const height = Math.min(PREVIEW_MAX_H, Math.round((width * 9) / 16));
  return (
    <Box ref={ref} data-testid="add-part-preview" sx={{ width: "100%", borderRadius: 1, overflow: "hidden" }}>
      {width > 0 && <LivePartPreview elements={[draft]} background={background} lightScene={light} width={width} height={height} animate />}
    </Box>
  );
}

/** 種類ごとの「置く前に決めたい値」だけ。細かい値は置いてから右の設定欄で変える */
function PartSettings({ kind, draft, patch, background, light }: { kind: LivePartKind; draft: LiveElement; patch: (p: Partial<LiveElement>) => void; background: string; light: boolean }) {
  const { t } = useTranslation();
  switch (kind) {
    case "text":
      return <TextField autoFocus size="small" label={t("studio.textContent")} multiline minRows={2} value={draft.text ?? ""} onChange={e => patch({ text: e.target.value })} />;
    case "eventInfo":
      return (
        <TextField select size="small" label={t("studio.infoFieldLabel")} value={draft.field ?? "title"} onChange={e => patch({ field: e.target.value as EventInfoField })}>
          {EVENT_INFO_FIELDS.map(f => <MenuItem key={f} value={f}>{t(INFO_LABEL_KEY[f])}</MenuItem>)}
        </TextField>
      );
    case "chat":
      return <ChatFields selected={draft} patch={patch} />;
    case "marquee":
      return (
        <>
          <TextField autoFocus size="small" label={t("studio.widgetTextLabel")} value={draft.text ?? ""} inputProps={{ maxLength: 120 }} onChange={e => patch({ text: e.target.value })} />
          <LabeledToggle label={t("studio.marqueeSpeed")} value={nearestSpeed(draft.seconds ?? 20)} onChange={v => patch({ seconds: v })} options={MARQUEE_SPEEDS.map(s => ({ value: s.seconds, label: t(s.label) }))} />
          <LabeledToggle label={t("studio.widgetDirection")} value={draft.direction ?? "left"} onChange={v => patch({ direction: v })} options={[{ value: "left" as const, label: t("studio.widgetLeft") }, { value: "right" as const, label: t("studio.widgetRight") }]} />
        </>
      );
    case "clock":
      return (
        <>
          <FormControlLabel control={<Switch checked={draft.showSeconds ?? true} onChange={e => patch({ showSeconds: e.target.checked })} />} label={t("studio.clockShowSeconds")} />
          <FormControlLabel control={<Switch checked={Boolean(draft.showDate)} onChange={e => patch({ showDate: e.target.checked })} />} label={t("studio.clockShowDate")} />
        </>
      );
    case "countdown":
      return <CountdownTargetFields selected={draft} patch={patch} />;
    case "liveIndicator":
      return (
        <>
          <Typography variant="caption" color="text.secondary">{t("studio.manualLiveEditorHint")}</Typography>
          <TextField autoFocus size="small" label={t("studio.widgetTextLabel")} value={draft.text ?? ""} inputProps={{ maxLength: 32 }} onChange={e => patch({ text: e.target.value })} />
        </>
      );
    case "motif": {
      const rotation = draft.motion?.kind === "rotation" ? draft.motion.direction : "none";
      return (
        <>
          <Typography variant="caption" color="text.secondary">{t("studio.widgetMotif")}</Typography>
          <ToggleButtonGroup exclusive size="small" value={draft.motif} onChange={(_e, v) => v && patch({ motif: v })} sx={{ flexWrap: "wrap" }}>
            {LIVE_MOTIF_KINDS.map(m => (
              <ToggleButton key={m} value={m} aria-label={t(`studio.motifKind${m}`)} sx={{ flexDirection: "column", gap: 0.5, px: 1 }}>
                <LivePartPreview elements={[{ ...draft, id: `motif-${m}`, motif: m, motion: undefined }]} background={background} lightScene={light} width={56} height={56} />
                <Typography variant="caption">{t(`studio.motifKind${m}`)}</Typography>
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <LabeledToggle
            label={t("studio.widgetRotation")}
            value={rotation}
            onChange={v => patch({ motion: v === "none" ? undefined : { kind: "rotation", seconds: draft.motion?.seconds ?? 30, direction: v } })}
            options={[
              { value: "clockwise" as const, label: t("studio.motifRotateClockwise") },
              { value: "counterclockwise" as const, label: t("studio.motifRotateCounterclockwise") },
              { value: "none" as const, label: t("studio.motifRotateNone") },
            ]}
          />
        </>
      );
    }
    case "flameFrame":
      return <FlameFrameFields selected={draft} patch={patch} />;
    default:
      return null;
  }
}

const nearestSpeed = (seconds: number) =>
  MARQUEE_SPEEDS.reduce((best, s) => (Math.abs(s.seconds - seconds) < Math.abs(best - seconds) ? s.seconds : best), MARQUEE_SPEEDS[1].seconds as number);

function LabeledToggle<V extends string | number>({ label, value, onChange, options }: { label: string; value: V; onChange: (v: V) => void; options: { value: V; label: string }[] }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>{label}</Typography>
      <ToggleButtonGroup exclusive size="small" value={value} onChange={(_e, v) => v !== null && onChange(v as V)} aria-label={label}>
        {options.map(o => <ToggleButton key={String(o.value)} value={o.value}>{o.label}</ToggleButton>)}
      </ToggleButtonGroup>
    </Box>
  );
}
