import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Stack,
  Typography,
} from "@mui/material";
import type { PendingDeletion } from "@eventer/shared";
import { useLogout, useRestoreAccount } from "../api/hooks.js";
import { ApiError } from "../api/client.js";
import { dateLocale } from "../i18n/index.js";

/** 復元できる期限。**タイムゾーンは日本時間に固定**（サーバーの締めがJSTのため）。
 * 端末の時刻と読み違えられないよう、タイムゾーン名も一緒に出す (#352) */
function dateText(ms: number): string {
  return new Intl.DateTimeFormat(dateLocale(), {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(ms);
}

/** 復帰画面 (#250)。退会申請中（猶予期間）のアカウントでログインしたときに
 * 他の画面の代わりに表示する。ここで明示的に「復帰する」を選ぶまで
 * アカウントは利用不可のまま（サーバー側も復帰API以外を通さない） */
export function AccountRestorePage({ pending }: { pending: PendingDeletion }) {
  const restore = useRestoreAccount();
  const logout = useLogout();
  const [error, setError] = useState<string | null>(null);
  // 猶予期間を過ぎていれば復帰できない。サーバーの判定と揃えて先に画面へ出す
  // （「時間をおいて再度お試しください」だと何度も試させてしまうため #250）
  const [expired, setExpired] = useState(() => Date.now() >= pending.purgeAt);

  const run = () => {
    setError(null);
    restore.mutate(undefined, {
      // 復帰後はキャッシュを作り直したいので、素直にマイページへ読み込み直す
      onSuccess: () => window.location.assign("/me"),
      onError: (e) => {
        if (e instanceof ApiError && e.status === 410) {
          setExpired(true);
          return;
        }
        setError("復帰に失敗しました。時間をおいて再度お試しください。");
      },
    });
  };

  return (
    <Box sx={{ display: "grid", placeItems: "center", minHeight: "100vh", p: 2 }}>
      <Card variant="outlined" sx={{ maxWidth: 560, width: "100%" }}>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h5" fontWeight={700}>
              このアカウントは退会手続き中です
            </Typography>
            <Typography variant="body2" color="text.secondary">
              @{pending.username} は {dateText(pending.deletedAt)}{" "}
              に退会を申請しました。現在は他の利用者から見えない状態になっています。
            </Typography>
            {expired ? (
              <Alert severity="error">
                復帰できる期間（{dateText(pending.purgeAt)}
                まで）を過ぎています。このアカウントと活動記録は間もなく完全に
                削除されます。引き続きご利用いただく場合は、あらためて新規に
                ログインしてください。
              </Alert>
            ) : (
              <Alert severity="warning">
                {dateText(pending.purgeAt)}{" "}
                を過ぎるとアカウントと活動記録は完全に削除され、復元できなくなります。
              </Alert>
            )}
            {!expired && (
              <Typography variant="body2" color="text.secondary">
                退会を取り消して、これまでの参加履歴・フォロー・作成したコンテンツを
                そのまま使い続けますか？
              </Typography>
            )}
            {error && <Alert severity="error">{error}</Alert>}
            <Stack direction="row" spacing={1}>
              {!expired && (
                <Button
                  variant="contained"
                  disabled={restore.isPending}
                  onClick={run}
                >
                  復帰する
                </Button>
              )}
              <Button
                color="inherit"
                disabled={logout.isPending}
                onClick={() =>
                  logout.mutate(undefined, {
                    onSuccess: () => window.location.assign("/"),
                  })
                }
              >
                {expired ? "ログアウト" : "このまま退会する（ログアウト）"}
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
