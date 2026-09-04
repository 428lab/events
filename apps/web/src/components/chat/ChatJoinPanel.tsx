import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import type { KeyMode } from "../../lib/chatKeyMode.js";
import { hasNip07 } from "../../lib/nostr.js";

/**
 * 参加UI (#199 / #223 / #332)。発言に使う鍵を選んでチャットに入るまで。
 *
 * 投影用画面 (#215) では**呼び出し側がそもそも描かない**。ここに display の
 * 分岐を置かないのは、参加操作の見た目を足すたびに投影側を気にせずに済むため。
 */
export function ChatJoinPanel({
  keyMode,
  onKeyModeChange,
  onJoin,
  disabled,
  /** 部屋がまだ開いていない（スタッフにだけ知らせる #221） */
  showRoomNotOpenNotice,
}: {
  keyMode: KeyMode;
  onKeyModeChange: (mode: KeyMode) => void;
  onJoin: () => void;
  disabled: boolean;
  showRoomNotOpenNotice: boolean;
}) {
  const { t } = useTranslation();
  // 拡張が無ければ選択肢を出さない（選べない手段を並べない）
  const canChooseKey = hasNip07();
  return (
    <Stack spacing={1.5} sx={{ mt: 1 }}>
      {showRoomNotOpenNotice && (
        <Alert severity="info">{t("eventSocial.chatRoomNotOpenStaff")}</Alert>
      )}
      {canChooseKey && (
        <RadioGroup
          value={keyMode}
          onChange={(e) => onKeyModeChange(e.target.value as KeyMode)}
        >
          <FormControlLabel
            value="ephemeral"
            control={<Radio size="small" />}
            label={t("eventSocial.chatKeyModeEphemeral")}
          />
          <FormControlLabel
            value="nip07"
            control={<Radio size="small" />}
            label={t("eventSocial.chatKeyModeNip07")}
          />
        </RadioGroup>
      )}
      {canChooseKey && keyMode === "nip07" && (
        <Alert severity="info">{t("eventSocial.chatNip07Notice")}</Alert>
      )}
      <Typography variant="caption" color="text.secondary">
        {t("eventSocial.chatPublicNotice")}
      </Typography>
      <Box>
        <Button
          variant="contained"
          size="small"
          disabled={disabled}
          onClick={onJoin}
        >
          {t("eventSocial.chatJoin")}
        </Button>
      </Box>
    </Stack>
  );
}
