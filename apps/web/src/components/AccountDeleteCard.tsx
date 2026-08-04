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
import { useDeletionGraceMs } from "../api/hooks.js";

import { useDeleteAccount } from "../api/userHooks.js";

/** 退会カード (#244, #250)。アカウント設定の最下部に置く。
 * 何が残り何が消えるか・猶予期間 (#250) を説明し、
 * チェック＋確認ダイアログの二段構えで実行する */
/** 猶予期間の表示（環境で変わる。staging は検証用に短い） */
function formatGrace(ms: number): string {
  const days = Math.round(ms / 86_400_000);
  if (days >= 1) return `${days}日`;
  return `${Math.max(1, Math.round(ms / 60_000))}分`;
}

export function AccountDeleteCard() {
  const graceText = formatGrace(useDeletionGraceMs());
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
        // アカウントは即座に利用不可になるので、手元の表示キャッシュも全部捨てて
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
          退会するとアカウントはすぐに利用できなくなり、他の利用者からも見えなく
          なります。
          {graceText}以内に同じログイン方法でログインすると復帰できます。
          {graceText}経過後は完全に削除され、復元できません。
        </Typography>
        <Typography
          variant="body2"
          color="text.secondary"
          component="div"
          sx={{ mb: 2 }}
        >
          <ul style={{ margin: 0, paddingLeft: "1.4em" }}>
            <li>
              退会するとすぐにログアウトされ、プロフィール・参加者一覧・チャットの
              表示など、他の利用者から見える場所には表示されなくなります
            </li>
            <li>
              {graceText}経過後に、以下のとおりデータが完全に削除されます
            </li>
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
              完全削除の後に再度ログインした場合は新しいアカウントになり、
              以前のデータは戻せません
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
            アカウントはすぐに利用できなくなり、実行後はログイン画面に戻ります。
            {graceText}以内に同じログイン方法でログインすれば復帰できますが、
            {graceText}経過後は完全に削除され、元に戻すことはできません。
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
