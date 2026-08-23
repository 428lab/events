import {
  Alert,
  Card,
  CardContent,
  Divider,
  FormControlLabel,
  Stack,
  Switch,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import {
  useNotificationPrefs,
  useUpdateNotificationPrefs,
} from "../api/userHooks.js";

/** アカウント設定: 通知のON/OFF (#21 PR3, #126 でメール通知追加)。
 *
 * アプリ内とメールは届く場所が違うので、見出しで節を分けて見せる (#413)。
 * スイッチが同列に並んでいた頃、フォロー通知をメール通知と取り違えて
 * 「設定したつもりで届かない」が実際に起きた。 */
export function NotificationPrefsCard() {
  const { t } = useTranslation();
  const { data } = useNotificationPrefs();
  const update = useUpdateNotificationPrefs();
  const prefs = data?.prefs;
  const email = data?.email ?? null;

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          {t("settings.notificationsTitle")}
        </Typography>
        <Stack>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            {t("settings.notifyInAppHeading")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t("settings.notificationsDescription")}
          </Typography>
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
            label={t("settings.notifyFolloweeCreated")}
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
            label={t("settings.notifyFolloweeJoined")}
          />
          <Divider sx={{ my: 1.5 }} />
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            {t("settings.notifyEmailHeading")}
          </Typography>
          <FormControlLabel
            control={
              <Switch
                checked={prefs?.emailEnabled ?? true}
                disabled={!prefs || !email || update.isPending}
                onChange={(e) =>
                  update.mutate({ emailEnabled: e.target.checked })
                }
              />
            }
            label={t("settings.notifyEmail")}
          />
          {data && !email && (
            <Alert severity="info" sx={{ mt: 1 }}>
              {t("settings.emailNotLinked")}
            </Alert>
          )}
          {email && (
            <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
              {t("settings.emailRecipient", { email })}
            </Typography>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
