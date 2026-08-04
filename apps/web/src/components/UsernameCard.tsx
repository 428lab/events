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
import { CounterTextField } from "./CounterTextField.js";
import { useMe } from "../api/hooks.js";
import { useUpdateDisplayName, useUpdateUsername } from "../api/userHooks.js";
import { ApiError } from "../api/client.js";
import { USERNAME_PATTERN } from "@eventer/shared";

const DISPLAY_NAME_MAX = 50;

/** マイページのプロフィール（表示名・ユーザー名）編集カード */
export function UsernameCard() {
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
        setDisplayMsg({ type: "success", text: "表示名を変更しました" }),
      onError: () =>
        setDisplayMsg({ type: "error", text: "変更に失敗しました" }),
    });
  };

  const save = () => {
    setMsg(null);
    update.mutate(trimmed, {
      onSuccess: () => setMsg({ type: "success", text: "ユーザー名を変更しました" }),
      onError: (e) => {
        const status = e instanceof ApiError ? e.status : 0;
        setMsg({
          type: "error",
          text:
            status === 409
              ? "このユーザー名は既に使われています"
              : status === 400
                ? "使用できない文字が含まれています（半角英数字と _ . - のみ）"
                : "変更に失敗しました",
        });
      },
    });
  };

  if (!me) return null;

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          プロフィール
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          プロフィールURL: /users/{current}
          <Link component={RouterLink} to={`/users/${current}`} sx={{ ml: 1 }}>
            プロフィールを見る
          </Link>
        </Typography>
        <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ mb: 2 }}>
          <CounterTextField
            label="表示名"
            size="small"
            value={display}
            max={DISPLAY_NAME_MAX}
            onChange={(e) => {
              setDisplay(e.target.value);
              setDisplayMsg(null);
            }}
            error={display.length > 0 && !displayValid}
            helperText="イベントやチャットで表示される名前です"
            sx={{ maxWidth: 320 }}
          />
          <Button
            variant="contained"
            disabled={!displayValid || !displayChanged || updateDisplay.isPending}
            onClick={saveDisplay}
            sx={{ mt: 0.5 }}
          >
            保存
          </Button>
        </Stack>
        {displayMsg && (
          <Alert severity={displayMsg.type} sx={{ mt: -1, mb: 2 }}>
            {displayMsg.text}
          </Alert>
        )}
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <CounterTextField
            label="ユーザー名（ハンドル）"
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
                ? "半角英数字と _ . - スペースのみ（前後スペース不可）、2〜32文字"
                : "プロフィールURLに使われます"
            }
            sx={{ maxWidth: 320 }}
          />
          <Button
            variant="contained"
            disabled={!valid || !changed || update.isPending}
            onClick={save}
            sx={{ mt: 0.5 }}
          >
            保存
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
