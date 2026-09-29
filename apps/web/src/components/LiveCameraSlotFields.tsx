import { useTranslation } from "react-i18next";
import { Box, ButtonBase, Stack, TextField, Typography } from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import { LIVE_CAMERA_LABEL_MAX } from "@eventer/shared";
import type { LiveCameraSlot } from "@eventer/shared";
import { CAMERA_SLOT_COLORS } from "../lib/liveCameraMapping.js";
import type { CameraSlotChoices } from "../lib/liveCameraMapping.js";

/** カメラ番号の色バッジ。編集画面・配信コントロールで同じ見た目にする */
export function CameraSlotBadge({ slot, small = false }: { slot: LiveCameraSlot; small?: boolean }) {
  const size = small ? 16 : 22;
  return (
    <Box
      component="span"
      aria-hidden
      sx={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: size, height: size, px: small ? 0.25 : 0.5, borderRadius: small ? 0.5 : 0.75, bgcolor: CAMERA_SLOT_COLORS[slot], color: "#111", fontWeight: 700, fontSize: small ? 10 : 12, lineHeight: 1 }}
    >
      {slot}
    </Box>
  );
}

/**
 * 「映すカメラ」の選択と、その番号の呼び名 (#570)。
 *
 * 候補はこのセットにある番号と「新しいカメラ（カメラN）」（上限 4）。呼び名はセット共通なので、
 * 同じ番号を使う他のシーンのパーツにも同じ名前が出る。実機の名前は出さない（配信するPCで選ぶ）。
 */
export function LiveCameraSlotFields({
  slot,
  choices,
  labels,
  onSlot,
  onLabel,
  labelField,
  help,
}: {
  slot: LiveCameraSlot;
  choices: CameraSlotChoices;
  labels: Partial<Record<LiveCameraSlot, string>>;
  onSlot: (slot: LiveCameraSlot) => void;
  onLabel: (label: string) => void;
  /** 呼び名の欄の見出し */
  labelField: string;
  help?: string;
}) {
  const { t } = useTranslation();
  const option = (value: LiveCameraSlot, name: string, isNew: boolean) => {
    const on = value === slot;
    return (
      <ButtonBase
        key={isNew ? "new" : value}
        role="radio"
        aria-checked={on}
        aria-label={name}
        onClick={() => onSlot(value)}
        sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%", justifyContent: "flex-start", textAlign: "left", px: 1, py: 0.75, border: 1, borderRadius: 1, borderStyle: isNew ? "dashed" : "solid", borderColor: on ? "primary.main" : "divider", bgcolor: on ? "action.selected" : undefined, "&:hover, &.Mui-focusVisible": { borderColor: "primary.main" } }}
      >
        {isNew ? <Box component="span" sx={{ minWidth: 22, textAlign: "center", color: "primary.main", fontWeight: 700 }}>＋</Box> : <CameraSlotBadge slot={value} />}
        <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>{name}</Typography>
        {on && <CheckIcon fontSize="small" color="primary" />}
      </ButtonBase>
    );
  };
  return (
    <Stack spacing={1}>
      <Typography variant="caption" color="text.secondary" id="camera-slot-pick">{t("studio.cameraSlotPick")}</Typography>
      <Stack spacing={0.5} role="radiogroup" aria-labelledby="camera-slot-pick">
        {choices.existing.map(s => option(s, labels[s] ? t("studio.cameraSlotWithLabel", { n: s, label: labels[s] }) : t("studio.cameraSlotName", { n: s }), false))}
        {choices.next !== null && option(choices.next, t("studio.cameraSlotNew", { n: choices.next }), true)}
      </Stack>
      {/* 見出しは長いので枠の上に出す（細い設定欄で枠の見出しにすると途中で切れる） */}
      <Typography variant="caption" color="text.secondary" component="div" sx={{ pt: 0.5 }}>{labelField}</Typography>
      <TextField
        size="small"
        placeholder={t("studio.cameraSlotLabelPlaceholder")}
        value={labels[slot] ?? ""}
        inputProps={{ maxLength: LIVE_CAMERA_LABEL_MAX, "aria-label": labelField }}
        onChange={e => onLabel(e.target.value.slice(0, LIVE_CAMERA_LABEL_MAX))}
        helperText={help}
      />
    </Stack>
  );
}
