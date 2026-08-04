import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import {
  CHAT_RELAYS,
  CHAT_RELAY_MAX,
  CHAT_RELAY_URL_PATTERN,
} from "@eventer/shared";
import { useIsAdmin } from "../api/hooks.js";
import {
  useAdminSettings,
  useUpdateChatRelays, useRunPurgeDeleted } from "../api/adminSettingsHooks.js";

/** 管理者向け: アプリ全体の運用設定（チャットリレー #199 / 退会予定の削除 #250） */
export function AdminSettingsPage() {
  const isAdmin = useIsAdmin();
  const { data, isLoading } = useAdminSettings(isAdmin);
  const update = useUpdateChatRelays();

  const purge = useRunPurgeDeleted();
  const [purgeResult, setPurgeResult] = useState<{
    purged: number;
    failed: number;
    remaining: number;
  } | null>(null);

  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // 取得した実効値でテキストエリアを初期化（保存後の再取得でも同期）
  useEffect(() => {
    if (data) setDraft(data.chatRelays.join("\n"));
  }, [data]);

  if (!isAdmin) {
    return <Alert severity="warning">この画面は運営管理者専用です。</Alert>;
  }

  const save = () => {
    setSaved(false);
    const relays = draft
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (relays.length === 0) {
      setError("リレーURLを1つ以上入力してください（既定に戻すにはボタンを使用）。");
      return;
    }
    if (relays.length > CHAT_RELAY_MAX) {
      setError(`リレーは最大${CHAT_RELAY_MAX}件までです。`);
      return;
    }
    const bad = relays.find(
      (r) => r.length > 200 || !CHAT_RELAY_URL_PATTERN.test(r),
    );
    if (bad) {
      setError(`不正なURLです: ${bad}（wss:// で始まるURLのみ）`);
      return;
    }
    setError(null);
    update.mutate(relays, {
      onSuccess: () => setSaved(true),
      onError: () => setError("保存に失敗しました。"),
    });
  };

  const reset = () => {
    setSaved(false);
    setError(null);
    update.mutate([], {
      onSuccess: () => setSaved(true),
      onError: () => setError("保存に失敗しました。"),
    });
  };

  return (
    <Stack spacing={2.5}>
      <Typography
        variant="h5"
        fontWeight={700}
        sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
      >
        <SettingsOutlinedIcon fontSize="medium" />
        運用設定
      </Typography>

      <Card variant="outlined">
        <CardContent>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ mb: 1 }}
          >
            <Typography variant="h6">チャットリレー</Typography>
            {data && (
              <Chip
                size="small"
                label={data.chatRelaysCustom ? "カスタム設定" : "既定値"}
                color={data.chatRelaysCustom ? "secondary" : "default"}
              />
            )}
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            イベントチャット (Nostr)
            の読み書きに使うリレーです。1行に1つ、wss:// で始まるURLを最大
            {CHAT_RELAY_MAX}件まで指定できます。
          </Typography>

          {isLoading || !data ? (
            <Typography>読み込み中…</Typography>
          ) : (
            <Stack spacing={1.5}>
              <TextField
                label="リレーURL（1行に1つ）"
                multiline
                minRows={3}
                fullWidth
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setSaved(false);
                }}
                placeholder={[...CHAT_RELAYS].join("\n")}
              />
              <Typography variant="caption" color="text.secondary">
                現在の実効値: {data.chatRelays.join(" / ")}
                {!data.chatRelaysCustom && "（既定）"}
              </Typography>
              {error && <Alert severity="error">{error}</Alert>}
              {saved && !update.isPending && (
                <Alert severity="success" onClose={() => setSaved(false)}>
                  保存しました。
                </Alert>
              )}
              <Box sx={{ display: "flex", gap: 1 }}>
                <Button
                  variant="contained"
                  size="small"
                  disabled={update.isPending}
                  onClick={save}
                >
                  保存
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  disabled={update.isPending || !data.chatRelaysCustom}
                  onClick={reset}
                >
                  既定に戻す
                </Button>
              </Box>
            </Stack>
          )}
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" gutterBottom>
            退会予定の削除
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            猶予期間を過ぎた退会アカウントを完全に削除します。通常は毎日自動で
            実行されますが、ここから今すぐ実行することもできます。
          </Typography>
          {purgeResult && (
            <Alert
              severity={purgeResult.failed > 0 ? "warning" : "success"}
              sx={{ mb: 2 }}
              onClose={() => setPurgeResult(null)}
            >
              {purgeResult.purged}件を削除しました
              {purgeResult.failed > 0 && `（失敗 ${purgeResult.failed}件）`}
              {purgeResult.remaining > 0 && `。残り ${purgeResult.remaining}件`}
            </Alert>
          )}
          <Button
            variant="outlined"
            size="small"
            disabled={purge.isPending}
            onClick={() =>
              purge.mutate(undefined, { onSuccess: (r) => setPurgeResult(r) })
            }
          >
            {purge.isPending ? "実行中…" : "今すぐ実行"}
          </Button>
        </CardContent>
      </Card>
    </Stack>
  );
}
