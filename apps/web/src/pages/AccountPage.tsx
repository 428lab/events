import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAuthProviders,
  useIdentities,
  useMe,
  useUnlinkIdentity,
} from "../api/hooks.js";
import { UsernameCard } from "../components/UsernameCard.js";
import { NotificationPrefsCard } from "../components/NotificationPrefsCard.js";
import { LanguageCard } from "../components/LanguageCard.js";
import { AccountMergeCard } from "../components/AccountMergeCard.js";
import { AccountDeleteCard } from "../components/AccountDeleteCard.js";
import { PROVIDER_META, providerLabel } from "../lib/providers.js";
import { nostrNip07Login } from "../lib/nostr.js";
import { ApiError } from "../api/client.js";

const ALREADY_LINKED_MSG =
  "そのアカウントは他のログイン方法を持つ別ユーザーに連携されています。統合したい場合は、先に相手側アカウントで連携を解除してください。";
/** 引き取り拒否 (#238): 相手アカウントに利用実績がある場合 */
const ACCOUNT_IN_USE_MSG =
  "そのログイン方法は、利用実績のある別のアカウントに連携されています。そちらのアカウントでログインし直してから、逆にこちらのログイン方法を連携してください。";
/** 引き取り拒否 (#250): 相手アカウントが退会手続き中（猶予期間）の場合 */
const ACCOUNT_DELETED_MSG =
  "そのログイン方法は、退会手続き中のアカウントに連携されています。そちらのアカウントでログインすると復帰できます。完全に削除されたあとであれば、あらためて連携できます。";

/** OAuth コールバックの ?link_error / API の 409 エラーコードを文言に変換する */
function linkErrorMessage(code: string | null | undefined): string {
  return code === "account_in_use"
    ? ACCOUNT_IN_USE_MSG
    : code === "account_deleted"
      ? ACCOUNT_DELETED_MSG
      : ALREADY_LINKED_MSG;
}

export function AccountPage() {
  const { data: me } = useMe();
  const { data: providers } = useAuthProviders();
  const { data: identities } = useIdentities();
  const unlink = useUnlinkIdentity();
  const qc = useQueryClient();
  const [nostrBusy, setNostrBusy] = useState(false);
  const [nostrError, setNostrError] = useState<string | null>(null);
  // 連携エラーはページ内アラートだと気づきにくいためモーダルで表示 (#245)。
  // OAuth コールバックの ?link_error=already_linked / account_in_use を初期値に取り込む
  const [linkErrorDialog, setLinkErrorDialog] = useState<string | null>(() => {
    const q = new URLSearchParams(window.location.search).get("link_error");
    return q ? linkErrorMessage(q) : null;
  });
  const closeLinkErrorDialog = () => {
    setLinkErrorDialog(null);
    // リロードや戻るで再表示されないようクエリを消す
    const url = new URL(window.location.href);
    if (url.searchParams.has("link_error")) {
      url.searchParams.delete("link_error");
      window.history.replaceState(null, "", url.toString());
    }
  };

  if (!me || !identities) return <Typography>読み込み中…</Typography>;

  const linked = new Map(identities.map((i) => [i.provider, i]));
  const all = [
    ...(providers && providers.length > 0 ? providers : ["discord"]),
    "nostr",
  ];
  const canUnlink = identities.length > 1;

  const linkNostr = async () => {
    setNostrError(null);
    setNostrBusy(true);
    try {
      await nostrNip07Login();
      await qc.invalidateQueries({ queryKey: ["identities"] });
      await qc.invalidateQueries({ queryKey: ["me"] });
    } catch (e) {
      // 引き取り拒否系は見落とし防止のためモーダルで表示 (#245)
      if (e instanceof ApiError && e.status === 409) {
        setLinkErrorDialog(
          linkErrorMessage((e.body as { error?: string } | null)?.error),
        );
      } else {
        setNostrError(
          e instanceof Error && e.message === "no_extension"
            ? "NIP-07 対応拡張（Alby、nos2x など）が見つかりません。"
            : "Nostr 連携に失敗しました。",
        );
      }
    } finally {
      setNostrBusy(false);
    }
  };

  return (
    <Stack spacing={3}>
      <Typography variant="h5" fontWeight={700}>
        アカウント設定
      </Typography>

      <UsernameCard />

      <LanguageCard />

      <NotificationPrefsCard />

      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" gutterBottom>
            ログイン方法（連携）
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            複数のログイン方法を連携できます。そのログイン方法だけで使っている
            未利用の別アカウントがある場合は、連携がこちらへ引き継がれます
            （利用実績のあるアカウントからは引き継げません。その場合は
            「アカウント統合」をお使いください）。
          </Typography>

          <Stack spacing={1.5}>
            {all.map((p) => {
              const id = linked.get(p);
              const meta = PROVIDER_META[p];
              return (
                <Box
                  key={p}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1.5,
                    flexWrap: "wrap",
                  }}
                >
                  <Box
                    sx={{
                      width: 12,
                      height: 12,
                      borderRadius: "50%",
                      bgcolor: meta?.color ?? "grey.500",
                      border: "1px solid rgba(255,255,255,0.2)",
                    }}
                  />
                  <Typography sx={{ minWidth: 80 }}>{providerLabel(p)}</Typography>
                  {id ? (
                    <>
                      <Chip size="small" color="success" label="連携済み" />
                      {id.email && (
                        <Typography variant="body2" color="text.secondary">
                          {id.email}
                        </Typography>
                      )}
                      <Box sx={{ flex: 1 }} />
                      <Button
                        size="small"
                        color="error"
                        variant="outlined"
                        disabled={!canUnlink || unlink.isPending}
                        onClick={() => unlink.mutate(p)}
                      >
                        解除
                      </Button>
                    </>
                  ) : (
                    <>
                      <Box sx={{ flex: 1 }} />
                      {p === "nostr" ? (
                        <Button
                          size="small"
                          variant="contained"
                          disabled={nostrBusy}
                          onClick={linkNostr}
                        >
                          {nostrBusy ? "確認中…" : "連携する"}
                        </Button>
                      ) : (
                        <Button
                          size="small"
                          variant="contained"
                          href={`/api/auth/${p}/login`}
                        >
                          連携する
                        </Button>
                      )}
                    </>
                  )}
                </Box>
              );
            })}
          </Stack>

          {nostrError && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              {nostrError}
            </Alert>
          )}
          {!canUnlink && (
            <Alert severity="info" sx={{ mt: 2 }}>
              ログイン方法は最低1つ必要です（最後の1つは解除できません）。
            </Alert>
          )}
        </CardContent>
      </Card>

      <AccountMergeCard />

      <AccountDeleteCard />

      {/* 連携エラーは見落とし防止のためモーダルで表示 (#245) */}
      <Dialog open={Boolean(linkErrorDialog)} onClose={closeLinkErrorDialog}>
        <DialogTitle>連携できませんでした</DialogTitle>
        <DialogContent>
          <DialogContentText>{linkErrorDialog}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={closeLinkErrorDialog}>
            閉じる
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
