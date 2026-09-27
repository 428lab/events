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
import { resolveLocalTarget } from "../lib/liveTime.js";
import { useState } from "react";

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
} as const;

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
  const [localTarget, setLocalTarget] = useState("");
  const candidates = selected?.type === "countdown" ? resolveLocalTarget(localTarget, selected.timezone ?? "Asia/Tokyo") : [];

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
        {selected.type in TYPE_LABEL_KEY ? t(TYPE_LABEL_KEY[selected.type as keyof typeof TYPE_LABEL_KEY]) : ({ shape: "面・線", motif: "装飾", marquee: "流れる案内", clock: "現在時刻", countdown: "カウントダウン", liveIndicator: "配信中表示" } as Record<string, string>)[selected.type]}
      </Typography>

      {selected.type === "liveIndicator" && <Typography variant="caption">ON/OFF はイベントの配信コントロールで運営が手動操作します。編集中は OFF です。</Typography>}
      {(selected.type === "marquee" || selected.type === "liveIndicator") && <TextField size="small" label="表示文言" value={selected.text ?? ""} inputProps={{ maxLength: selected.type === "marquee" ? 120 : 32 }} onChange={e => patch({ text: e.target.value })} />}
      {selected.type === "marquee" && <>
        <TextField select size="small" label="方向" value={selected.direction ?? "left"} onChange={e => patch({ direction: e.target.value as "left" | "right" })}><MenuItem value="left">左へ</MenuItem><MenuItem value="right">右へ</MenuItem></TextField>
        <TextField size="small" type="number" label="一周（12–40秒）" inputProps={{ min: 12, max: 40 }} value={selected.seconds ?? 20} onChange={e => { const n = Number(e.target.value); if (n >= 12 && n <= 40) patch({ seconds: n }); }} />
        <TextField size="small" type="number" label="間隔（24–64px）" inputProps={{ min: 24, max: 64 }} value={selected.gap ?? 32} onChange={e => { const n = Number(e.target.value); if (n >= 24 && n <= 64) patch({ gap: n }); }} />
      </>}
      {(selected.type === "clock" || selected.type === "countdown") && <>
        <TextField select size="small" label="タイムゾーン（明示選択）" value={selected.timezone ?? "Asia/Tokyo"} onChange={e => patch({ timezone: e.target.value })}>
          {["Asia/Tokyo", "UTC", "America/New_York", "Europe/London"].map(zone => <MenuItem key={zone} value={zone}>{zone}</MenuItem>)}
        </TextField>
        {selected.type === "clock" ? <>
          <TextField select size="small" label="時刻表記" value={selected.hour12 ? "12" : "24"} onChange={e => patch({ hour12: e.target.value === "12" })}><MenuItem value="24">24時間</MenuItem><MenuItem value="12">12時間</MenuItem></TextField>
          <Button onClick={() => patch({ showSeconds: !(selected.showSeconds ?? true) })}>秒を{selected.showSeconds ?? true ? "隠す" : "表示"}</Button>
          <Button onClick={() => patch({ showDate: !selected.showDate })}>日付を{selected.showDate ? "隠す" : "表示"}</Button>
        </> : <>
          <TextField select size="small" label="目標" value={selected.target ?? "eventStart"} onChange={e => patch({ target: e.target.value as "eventStart" | "custom" })}><MenuItem value="eventStart">イベント開始日時</MenuItem><MenuItem value="custom">指定日時</MenuItem></TextField>
          {selected.target !== "custom" && <Typography variant="caption">日程が未確定のイベントでは非表示です。編集画面には対象イベントがないため実際の残秒は配信画面で確認してください。</Typography>}
          {selected.target === "custom" && <>
            <TextField size="small" type="datetime-local" label="現地日時" InputLabelProps={{ shrink: true }} value={localTarget} onChange={e => setLocalTarget(e.target.value)} />
            {localTarget && candidates.length === 0 && <Typography color="error">存在しない時刻です。日時を変更してください。</Typography>}
            {localTarget && selected.targetEpochMs && !candidates.includes(selected.targetEpochMs) && <Typography color="warning.main">確定するまで以前の目標時刻が配信画面に残ります。</Typography>}
            {candidates.map((epoch, i) => <Button key={epoch} onClick={() => patch({ targetEpochMs: epoch })} variant={epoch === selected.targetEpochMs ? "contained" : "outlined"}>{candidates.length > 1 ? `重複時刻 ${i + 1}: ` : "確定: "}{new Date(epoch).toISOString()}</Button>)}
            {!selected.targetEpochMs && <Typography color="warning.main">日時を確定するまで本番では非表示です。</Typography>}
          </>}
          <TextField select size="small" label="ゼロ後" value={selected.zero ?? "stop"} onChange={e => patch({ zero: e.target.value as "stop" | "hide" })}><MenuItem value="stop">00:00で停止</MenuItem><MenuItem value="hide">隠す</MenuItem></TextField>
        </>}
      </>}
      {(selected.type === "shape" || selected.type === "motif") && <>
        {selected.type === "shape" ? <TextField select size="small" label="形" value={selected.shape ?? "rectangle"} onChange={e => patch({ shape: e.target.value as LiveElement["shape"] })}>{["rectangle", "ellipse", "line"].map(v => <MenuItem key={v} value={v}>{v}</MenuItem>)}</TextField> : <TextField select size="small" label="モチーフ" value={selected.motif ?? "lantern"} onChange={e => patch({ motif: e.target.value as LiveElement["motif"] })}>{["lantern", "halo", "brackets", "grid", "ticks"].map(v => <MenuItem key={v} value={v}>{v}</MenuItem>)}</TextField>}
        <TextField select size="small" label="装飾の動き" value={selected.motion?.kind ?? "none"} onChange={e => patch({ motion: e.target.value === "none" ? undefined : e.target.value === "rotation" ? { kind: "rotation", seconds: 30, direction: "clockwise" } : { kind: "colorCycle", seconds: 18, colors: ["#2DD4BF", "#7DD3FC"] } })}>
          <MenuItem value="none">停止</MenuItem>{selected.type === "motif" && <MenuItem value="rotation">回転</MenuItem>}<MenuItem value="colorCycle" disabled={selected.w > 180 || selected.h > 180}>色循環（小さな装飾のみ）</MenuItem>
        </TextField>
        {selected.motion && <TextField size="small" type="number" label="周期（秒）" inputProps={{ min: selected.motion.kind === "rotation" ? 12 : 8, max: selected.motion.kind === "rotation" ? 60 : 30 }} value={selected.motion.seconds} onChange={e => { const n = Number(e.target.value); const m = selected.motion!; if (n >= (m.kind === "rotation" ? 12 : 8) && n <= (m.kind === "rotation" ? 60 : 30)) patch({ motion: { ...m, seconds: n } }); }} />}
        {selected.motion?.kind === "rotation" && <Button onClick={() => patch({ motion: { ...selected.motion!, direction: selected.motion?.kind === "rotation" && selected.motion.direction === "clockwise" ? "counterclockwise" : "clockwise" } as LiveElement["motion"] })}>回転方向を変更</Button>}
        {selected.motion?.kind === "colorCycle" && <>
          <Typography variant="caption">背景や文字を隠さない小さな装飾に限定。安全な装飾色から2–4色を選択。</Typography>
          <TextField select size="small" label="色数" value={selected.motion.colors.length} onChange={e => { const palette = ["#2DD4BF", "#7DD3FC", "#FB923C", "#FBBF24"]; patch({ motion: { ...selected.motion!, colors: palette.slice(0, Number(e.target.value)) } as LiveElement["motion"] }); }}>{[2, 3, 4].map(n => <MenuItem key={n} value={n}>{n}色</MenuItem>)}</TextField>
          {selected.motion.colors.map((c, i) => <TextField key={i} select size="small" label={`循環色 ${i + 1}`} value={c} onChange={e => { const m = selected.motion!; if (m.kind === "colorCycle") patch({ motion: { ...m, colors: m.colors.map((color, j) => j === i ? e.target.value : color) } }); }}>{["#2DD4BF", "#7DD3FC", "#FB923C", "#FBBF24"].map(color => <MenuItem key={color} value={color} sx={{ color, bgcolor: "#0E1426" }}>{color}</MenuItem>)}</TextField>)}
        </>}
        {selected.type === "shape" && <TextField size="small" type="number" label="角丸（px）" inputProps={{ min: 0, max: 200 }} value={selected.radius ?? 0} onChange={e => { const n = Number(e.target.value); if (n >= 0 && n <= 200) patch({ radius: n }); }} />}
        <TextField size="small" type="number" label="線幅" inputProps={{ min: 0, max: 16 }} value={selected.strokeWidth ?? 2} onChange={e => { const n = Number(e.target.value); if (n >= 0 && n <= 16) patch({ strokeWidth: n }); }} />
        <TextField size="small" type="number" label="透明度（0–1）" inputProps={{ min: 0, max: 1, step: 0.1 }} value={selected.opacity ?? 1} onChange={e => { const n = Number(e.target.value); if (n >= 0 && n <= 1) patch({ opacity: n }); }} />
      </>}
      {(["shape", "motif", "marquee", "clock", "countdown", "liveIndicator"] as string[]).includes(selected.type) && <Stack direction="row" spacing={1} alignItems="center"><Typography variant="caption">色</Typography><input aria-label="要素の色" type="color" value={selected.type === "shape" ? selected.fill ?? "#2DD4BF" : selected.color ?? "#EAF0F7"} onChange={e => patch(selected.type === "shape" ? { fill: e.target.value } : { color: e.target.value })} />{selected.type === "shape" && <input aria-label="枠線の色" type="color" value={selected.stroke ?? "#2DD4BF"} onChange={e => patch({ stroke: e.target.value })} />}</Stack>}
      {(["marquee", "clock", "countdown", "liveIndicator"] as string[]).includes(selected.type) && <>
        <TextField size="small" type="number" label="文字サイズ（16–72px）" inputProps={{ min: 16, max: 72 }} value={selected.fontSize ?? 27} onChange={e => { const n = Number(e.target.value); if (n >= 16 && n <= 72) patch({ fontSize: n }); }} />
        <Stack direction="row" spacing={1} alignItems="center"><Typography variant="caption">背景色</Typography><input aria-label="背景色" type="color" value={selected.fill ?? "#1A2737"} onChange={e => patch({ fill: e.target.value })} /></Stack>
      </>}
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

      <Stack direction="row" flexWrap="wrap" gap={1}>{(["x", "y", "w", "h", "rotation"] as const).map(key => <TextField key={key} size="small" type="number" label={key} sx={{ width: 92 }} value={selected[key]} onChange={e => { const value = Number(e.target.value); if (Number.isFinite(value) && Math.abs(value) <= 2000) patch({ [key]: value }); }} />)}</Stack>
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
