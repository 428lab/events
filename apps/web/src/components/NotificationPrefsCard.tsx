import {
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

/** アカウント設定: 通知のON/OFF (#21 PR3)。 */
export function NotificationPrefsCard() {
  const { data: prefs } = useNotificationPrefs();
  const update = useUpdateNotificationPrefs();

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
        </Stack>
      </CardContent>
    </Card>
  );
}
