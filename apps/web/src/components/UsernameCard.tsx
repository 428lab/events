import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  CardContent,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CounterTextField } from "./CounterTextField.js";
import { useMe } from "../api/hooks.js";
import { useUpdateDisplayName, useUpdateUsername } from "../api/userHooks.js";
import { ApiError } from "../api/client.js";
import { USERNAME_PATTERN } from "@eventer/shared";

const DISPLAY_NAME_MAX = 50;

/** マイページのプロフィール（表示名・ユーザー名）編集カード */
export function UsernameCard() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const current = me?.username ?? "";
  const [name, setName] = useState(current);
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(
    null,
  );
  const update = useUpdateUsername();

  // 表示名 (#232)。イベント・チャット・プロフィール等の表示に使われる
  const currentDisplay = me?.globalName ?? "";
  const [display, setDisplay] = useState(currentDisplay);
  const [displayMsg, setDisplayMsg] = useState<
    { type: "success" | "error"; text: string } | null
  >(null);
  const updateDisplay = useUpdateDisplayName();

  // me ロード後・変更保存後に current へ同期
  useEffect(() => {
    if (current) setName(current);
  }, [current]);
  useEffect(() => {
    if (currentDisplay) setDisplay(currentDisplay);
  }, [currentDisplay]);

  const trimmed = name.trim();
  const valid = USERNAME_PATTERN.test(trimmed);
  const changed = trimmed !== current;

  const displayTrimmed = display.trim();
  const displayValid =
    displayTrimmed.length >= 1 && displayTrimmed.length <= DISPLAY_NAME_MAX;
  const displayChanged = displayTrimmed !== currentDisplay;

  const saveDisplay = () => {
    setDisplayMsg(null);
    updateDisplay.mutate(displayTrimmed, {
      onSuccess: () =>
        setDisplayMsg({
          type: "success",
          text: t("settings.displayNameSaved"),
        }),
      onError: () =>
        setDisplayMsg({ type: "error", text: t("settings.saveFailed") }),
    });
  };

  const save = () => {
    setMsg(null);
    update.mutate(trimmed, {
      onSuccess: () => setMsg({ type: "success", text: t("settings.usernameSaved") }),
      onError: (e) => {
        const status = e instanceof ApiError ? e.status : 0;
        setMsg({
          type: "error",
          text:
            status === 409
              ? t("settings.usernameTaken")
              : status === 400
                ? t("settings.usernameInvalidChars")
                : t("settings.saveFailed"),
        });
      },
    });
  };

  if (!me) return null;

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          {t("settings.profileTitle")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("settings.profileUrl", { path: `/users/${current}` })}
          <Link component={RouterLink} to={`/users/${current}`} sx={{ ml: 1 }}>
            {t("common.viewProfile")}
          </Link>
        </Typography>
        <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ mb: 2 }}>
          <CounterTextField
            label={t("settings.displayNameLabel")}
            size="small"
            value={display}
            max={DISPLAY_NAME_MAX}
            onChange={(e) => {
              setDisplay(e.target.value);
              setDisplayMsg(null);
            }}
            error={display.length > 0 && !displayValid}
            helperText={t("settings.displayNameHelp")}
            sx={{ maxWidth: 320 }}
          />
          <Button
            variant="contained"
            disabled={!displayValid || !displayChanged || updateDisplay.isPending}
            onClick={saveDisplay}
            sx={{ mt: 0.5 }}
          >
            {t("common.save")}
          </Button>
        </Stack>
        {displayMsg && (
          <Alert severity={displayMsg.type} sx={{ mt: -1, mb: 2 }}>
            {displayMsg.text}
          </Alert>
        )}
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <CounterTextField
            label={t("settings.usernameLabel")}
            size="small"
            value={name}
            max={32}
            onChange={(e) => {
              setName(e.target.value);
              setMsg(null);
            }}
            // 旧仕様で作られた許可外ハンドルが「触っていないのに常時赤」に
            // ならないよう、エラーは変更した時だけ表示する (#236)
            error={changed && name.length > 0 && !valid}
            helperText={
              changed && name.length > 0 && !valid
                ? t("settings.usernameInvalidHelp")
                : t("settings.usernameHelp")
            }
            sx={{ maxWidth: 320 }}
          />
          <Button
            variant="contained"
            disabled={!valid || !changed || update.isPending}
            onClick={save}
            sx={{ mt: 0.5 }}
          >
            {t("common.save")}
          </Button>
        </Stack>
        {msg && (
          <Alert severity={msg.type} sx={{ mt: 2 }}>
            {msg.text}
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
