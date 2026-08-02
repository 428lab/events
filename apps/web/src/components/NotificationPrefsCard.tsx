import {
  Alert,
  Card,
  CardContent,
  FormControlLabel,
  Stack,
  Switch,
  Typography,
} from "@mui/material";
import {
  useNotificationPrefs,
  useUpdateNotificationPrefs,
} from "../api/userHooks.js";

/** アカウント設定: 通知のON/OFF (#21 PR3, #126 でメール通知追加)。 */
export function NotificationPrefsCard() {
  const { data } = useNotificationPrefs();
  const update = useUpdateNotificationPrefs();
  const prefs = data?.prefs;
  const email = data?.email ?? null;

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          通知設定
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          フォローしている相手の活動を通知欄に表示します。
        </Typography>
        <Stack>
          <FormControlLabel
            control={
              <Switch
                checked={prefs?.followeeCreated ?? true}
                disabled={!prefs || update.isPending}
                onChange={(e) =>
                  update.mutate({ followeeCreated: e.target.checked })
                }
              />
            }
            label="フォロー相手がイベントを公開したとき"
          />
          <FormControlLabel
            control={
              <Switch
                checked={prefs?.followeeJoined ?? true}
                disabled={!prefs || update.isPending}
                onChange={(e) =>
                  update.mutate({ followeeJoined: e.target.checked })
                }
              />
            }
            label="フォロー相手がイベントに参加したとき"
          />
          <FormControlLabel
            control={
              <Switch
                checked={prefs?.emailEnabled ?? false}
                disabled={!prefs || !email || update.isPending}
                onChange={(e) =>
                  update.mutate({ emailEnabled: e.target.checked })
                }
              />
            }
            label="メール通知（通知と参加イベントの前日リマインダー）"
          />
          {data && !email && (
            <Alert severity="info" sx={{ mt: 1 }}>
              メール通知には Google / GitHub / Discord
              のログイン連携が必要です。下の「ログイン方法（連携）」から連携すると利用できます。
            </Alert>
          )}
          {email && (
            <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
              送信先: {email}
            </Typography>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
