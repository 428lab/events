import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  CardContent,
  Link,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { useMe } from "../api/hooks.js";
import { useUpdateUsername } from "../api/userHooks.js";
import { ApiError } from "../api/client.js";

const HANDLE_RE = /^[A-Za-z0-9_.-]{2,32}$/;

/** マイページのプロフィール（ユーザー名＝プロフィールURLのハンドル）編集カード */
export function UsernameCard() {
  const { data: me } = useMe();
  const current = me?.username ?? "";
  const [name, setName] = useState(current);
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(
    null,
  );
  const update = useUpdateUsername();

  // me ロード後・変更保存後に current へ同期
  useEffect(() => {
    if (current) setName(current);
  }, [current]);

  const trimmed = name.trim();
  const valid = HANDLE_RE.test(trimmed);
  const changed = trimmed !== current;

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
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <TextField
            label="ユーザー名（ハンドル）"
            size="small"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setMsg(null);
            }}
            error={name.length > 0 && !valid}
            helperText={
              name.length > 0 && !valid
                ? "半角英数字と _ . - のみ、2〜32文字"
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
