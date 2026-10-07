import { MenuItem, Stack, TextField, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import {
  CHAT_CLOSE_AFTER_OPTIONS,
  CHAT_OPEN_BEFORE_DAYS_MAX,
  CHAT_OPEN_BEFORE_DAYS_MIN,
  CHAT_OPEN_BEFORE_DEFAULT_MINUTES,
} from "@eventer/shared";

const MINUTES_PER_DAY = 24 * 60;

/** 始まりの選び方。値（分）は CHAT_OPEN_BEFORE_DEFAULT_MINUTES / N日 / null */
type OpenMode = "beforeStart" | "confirmed" | "days";

const DAY_CHOICES = Array.from(
  { length: CHAT_OPEN_BEFORE_DAYS_MAX - CHAT_OPEN_BEFORE_DAYS_MIN + 1 },
  (_, i) => CHAT_OPEN_BEFORE_DAYS_MIN + i,
);

/** 終わりの選択肢（分）→ 翻訳キー。並びは CHAT_CLOSE_AFTER_OPTIONS が持つ */
const CLOSE_AFTER_KEY = {
  120: "eventForm.chatWindowClose2h",
  1440: "eventForm.chatWindowClose1d",
  10080: "eventForm.chatWindowClose7d",
} as const satisfies Record<(typeof CHAT_CLOSE_AFTER_OPTIONS)[number], string>;

function openModeOf(minutes: number | null): OpenMode {
  if (minutes === null) return "confirmed";
  return minutes === CHAT_OPEN_BEFORE_DEFAULT_MINUTES ? "beforeStart" : "days";
}

/**
 * 参加者チャットの「書き込める期間」(#578)。イベント編集の参加者チャットの中に置く。
 * 値は Event の chatOpenBeforeMinutes / chatCloseAfterMinutes そのもの
 * （検証は共有の zod スキーマ。ここでは選択肢にない値を作らない）。
 * 狭い画面では2つの選択を縦に並べる。
 */
export function ChatWriteWindowField({
  openBeforeMinutes,
  closeAfterMinutes,
  onChange,
}: {
  openBeforeMinutes: number | null;
  closeAfterMinutes: number;
  onChange: (next: {
    openBeforeMinutes: number | null;
    closeAfterMinutes: number;
  }) => void;
}) {
  const { t } = useTranslation();
  const openMode = openModeOf(openBeforeMinutes);
  const days =
    openMode === "days" && openBeforeMinutes !== null
      ? Math.round(openBeforeMinutes / MINUTES_PER_DAY)
      : CHAT_OPEN_BEFORE_DAYS_MIN;

  const setOpenMode = (mode: OpenMode) =>
    onChange({
      openBeforeMinutes:
        mode === "confirmed"
          ? null
          : mode === "beforeStart"
            ? CHAT_OPEN_BEFORE_DEFAULT_MINUTES
            : days * MINUTES_PER_DAY,
      closeAfterMinutes,
    });

  return (
    <Stack spacing={1} sx={{ mt: 1.5 }}>
      <Typography variant="subtitle2">{t("eventForm.chatWindow")}</Typography>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        alignItems={{ xs: "stretch", sm: "flex-start" }}
      >
        <TextField
          select
          size="small"
          label={t("eventForm.chatWindowOpen")}
          value={openMode}
          onChange={(e) => setOpenMode(e.target.value as OpenMode)}
          sx={{ minWidth: { sm: 220 } }}
        >
          <MenuItem value="beforeStart">
            {t("eventForm.chatWindowOpen30m")}
          </MenuItem>
          <MenuItem value="confirmed">
            {t("eventForm.chatWindowOpenConfirmed")}
          </MenuItem>
          <MenuItem value="days">{t("eventForm.chatWindowOpenDays")}</MenuItem>
        </TextField>
        {openMode === "days" && (
          <TextField
            select
            size="small"
            label={t("eventForm.chatWindowDays")}
            value={days}
            onChange={(e) =>
              onChange({
                openBeforeMinutes: Number(e.target.value) * MINUTES_PER_DAY,
                closeAfterMinutes,
              })
            }
            sx={{ minWidth: { sm: 140 } }}
          >
            {DAY_CHOICES.map((n) => (
              <MenuItem key={n} value={n}>
                {t("eventForm.chatWindowDaysValue", { n })}
              </MenuItem>
            ))}
          </TextField>
        )}
        <TextField
          select
          size="small"
          label={t("eventForm.chatWindowClose")}
          value={closeAfterMinutes}
          onChange={(e) =>
            onChange({
              openBeforeMinutes,
              closeAfterMinutes: Number(e.target.value),
            })
          }
          sx={{ minWidth: { sm: 200 } }}
        >
          {CHAT_CLOSE_AFTER_OPTIONS.map((m) => (
            <MenuItem key={m} value={m}>
              {t(CLOSE_AFTER_KEY[m])}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      <Typography variant="caption" color="text.secondary" display="block">
        {t("eventForm.chatWindowHelp")}
      </Typography>
    </Stack>
  );
}
