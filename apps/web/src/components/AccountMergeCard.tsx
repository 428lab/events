import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { useIssueMergeCode, useMergeAccount } from "../api/userHooks.js";
import { ApiError } from "../api/client.js";

/** アカウント統合カード (#240)。
 * 誤ログイン等で複数できてしまったアカウントを、ユーザー自身で1つにまとめる。
 * 片方のアカウントで統合コードを発行し、もう片方で入力して実行する */
export function AccountMergeCard() {
  const issue = useIssueMergeCode();
  const merge = useMergeAccount();
  const [issuedCode, setIssuedCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [inputCode, setInputCode] = useState("");
  const [keep, setKeep] = useState<"me" | "other">("me");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const issueCode = () => {
    setCopied(false);
    issue.mutate(undefined, {
      onSuccess: (data) => setIssuedCode(data.code),
      onError: () => setError("統合コードの発行に失敗しました。"),
    });
  };

  const copyCode = async () => {
    if (!issuedCode) return;
    try {
      await navigator.clipboard.writeText(issuedCode);
      setCopied(true);
    } catch {
      // コピー不可の環境ではテキストを手動選択してもらう
    }
  };

  const runMerge = () => {
    setConfirmOpen(false);
    setError(null);
    merge.mutate(
      { code: inputCode.trim(), keep },
      {
        onSuccess: () => {
          // 残らない側のセッションだった場合はログイン画面に戻る
          window.location.reload();
        },
        onError: (e) => {
          const body =
            e instanceof ApiError
              ? (e.body as { error?: string } | null)
              : null;
          setError(
            body?.error === "same_account"
              ? "いまログインしているアカウント自身のコードです。もう一方のアカウントで発行したコードを入力してください。"
              : "統合コードが正しくないか、期限切れ・使用済みです。もう一方のアカウントでコードを発行し直してください。",
          );
        },
      },
    );
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          アカウント統合
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          誤って別のアカウントを作ってしまった場合に、2つのアカウントを1つに
          まとめられます。まとめたい片方のアカウントでログインして統合コードを
          発行し、もう片方のアカウントでそのコードを入力してください。
        </Typography>

        <Stack spacing={1} sx={{ mb: 3 }}>
          <Typography variant="subtitle2">1. 統合コードを発行する</Typography>
          <Typography variant="body2" color="text.secondary">
            コードの有効期限は15分・1回だけ使えます。発行したら、もう一方の
            アカウントでログインし直して入力してください。
          </Typography>
          <Alert severity="warning">
            このコードは絶対に他人に教えないでください。コードを知られると、
            アカウントのすべてのデータを他人のアカウントに統合（奪取）されます。
            運営がコードを尋ねることはありません。
          </Alert>
          <Box>
            <Button
              variant="outlined"
              size="small"
              disabled={issue.isPending}
              onClick={issueCode}
            >
              統合コードを発行
            </Button>
          </Box>
          {issuedCode && (
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField
                size="small"
                fullWidth
                value={issuedCode}
                slotProps={{
                  input: {
                    readOnly: true,
                    sx: { fontFamily: "monospace", fontSize: 13 },
                  },
                }}
                onFocus={(e) => e.target.select()}
              />
              <Button
                size="small"
                startIcon={<ContentCopyIcon />}
                onClick={copyCode}
              >
                {copied ? "コピーしました" : "コピー"}
              </Button>
            </Stack>
          )}
        </Stack>

        <Stack spacing={1}>
          <Typography variant="subtitle2">2. コードを入力して統合する</Typography>
          <TextField
            size="small"
            label="統合コード"
            value={inputCode}
            onChange={(e) => {
              setInputCode(e.target.value);
              setError(null);
            }}
            sx={{ maxWidth: 480 }}
          />
          <Typography variant="body2" color="text.secondary">
            残すアカウント（ハンドル・プロフィール・表示名はこちらが基準になります）
          </Typography>
          <RadioGroup
            value={keep}
            onChange={(e) => setKeep(e.target.value as "me" | "other")}
          >
            <FormControlLabel
              value="me"
              control={<Radio size="small" />}
              label="いまログインしているアカウント"
            />
            <FormControlLabel
              value="other"
              control={<Radio size="small" />}
              label="コードを発行したアカウント"
            />
          </RadioGroup>
          <Typography variant="body2" color="text.secondary">
            参加履歴・作成したイベントなどのデータは、残すアカウントへすべて
            引き継がれます（両方が同じイベントに参加している場合など、重複する
            記録は残す側を優先して1つにまとめます。スタッフ権限は引き継がれます）。
            「コードを発行したアカウント」を残した場合は、いまのアカウントが
            削除されるため、いったんログイン画面に戻ります。残したアカウントで
            改めてログインしてください。
          </Typography>
          <Box>
            <Button
              variant="contained"
              color="warning"
              size="small"
              disabled={!inputCode.trim() || merge.isPending}
              onClick={() => setConfirmOpen(true)}
            >
              統合する
            </Button>
          </Box>
          {error && <Alert severity="warning">{error}</Alert>}
        </Stack>
      </CardContent>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>アカウントを統合しますか？</DialogTitle>
        <DialogContent>
          <DialogContentText>
            この操作は取り消せません。もう一方のアカウントは削除され、
            そのデータは残すアカウントへ移動します。
            {keep === "other" &&
              " いまログインしているアカウントが削除されるため、実行後はログイン画面に戻ります。"}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>キャンセル</Button>
          <Button color="warning" variant="contained" onClick={runMerge}>
            統合を実行
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
