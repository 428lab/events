import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  Typography,
} from "@mui/material";
import { useQueryClient } from "@tanstack/react-query";
import { useDeleteAccount } from "../api/userHooks.js";

/** 退会カード (#244)。アカウント設定の最下部に置く。
 * 何が残り何が消えるかを説明し、チェック＋確認ダイアログの二段構えで実行する */
export function AccountDeleteCard() {
  const deleteAccount = useDeleteAccount();
  const qc = useQueryClient();
  const [agreed, setAgreed] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    setConfirmOpen(false);
    setError(null);
    deleteAccount.mutate(undefined, {
      onSuccess: () => {
        // アカウントは消えているので、手元の表示キャッシュも全部捨てて
        // ログイン画面へ移動する
        qc.clear();
        window.location.assign("/login");
      },
      onError: () =>
        setError("退会に失敗しました。時間をおいて再度お試しください。"),
    });
  };

  return (
    <Card variant="outlined" sx={{ borderColor: "error.main" }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          退会
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          アカウントを削除します。この操作は取り消せません。
        </Typography>
        <Typography
          variant="body2"
          color="text.secondary"
          component="div"
          sx={{ mb: 2 }}
        >
          <ul style={{ margin: 0, paddingLeft: "1.4em" }}>
            <li>
              作成したイベント・コミュニティ・会場・イベントのたまごは、参加者の
              履歴や予定を守るため「退会済みユーザー」名義で残ります
            </li>
            <li>
              参加履歴・いいね・コメント・フォロー・通知などの活動記録は削除されます
            </li>
            <li>スライド・配信セット・BGM・投稿した写真は削除されます</li>
            <li>イベントチャットの発言は表示されなくなります</li>
            <li>
              ログイン連携はすべて解除されます。再度ログインした場合は新しい
              アカウントになり、以前のデータは戻せません
            </li>
          </ul>
        </Typography>
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
          }
          label="上記の内容を理解し、退会に同意します"
        />
        <Box sx={{ mt: 1 }}>
          <Button
            variant="contained"
            color="error"
            size="small"
            disabled={!agreed || deleteAccount.isPending}
            onClick={() => setConfirmOpen(true)}
          >
            退会する
          </Button>
        </Box>
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </CardContent>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>本当に退会しますか？</DialogTitle>
        <DialogContent>
          <DialogContentText>
            アカウントと活動記録が削除され、元に戻すことはできません。
            実行後はログイン画面に戻ります。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>キャンセル</Button>
          <Button
            color="error"
            variant="contained"
            disabled={deleteAccount.isPending}
            onClick={run}
          >
            退会を実行
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
