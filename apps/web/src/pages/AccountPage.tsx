import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
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
import { PROVIDER_META, providerLabel } from "../lib/providers.js";
import { nostrNip07Login } from "../lib/nostr.js";
import { ApiError } from "../api/client.js";

const ALREADY_LINKED_MSG =
  "そのアカウントは他のログイン方法を持つ別ユーザーに連携されています。統合したい場合は、先に相手側アカウントで連携を解除してください。";

export function AccountPage() {
  const { data: me } = useMe();
  const { data: providers } = useAuthProviders();
  const { data: identities } = useIdentities();
  const unlink = useUnlinkIdentity();
  const qc = useQueryClient();
  const [nostrBusy, setNostrBusy] = useState(false);
  const [nostrError, setNostrError] = useState<string | null>(null);
  // OAuth コールバックからのエラー通知（?link_error=already_linked）
  const linkError = new URLSearchParams(window.location.search).get("link_error");

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
      setNostrError(
        e instanceof Error && e.message === "no_extension"
          ? "NIP-07 対応拡張（Alby、nos2x など）が見つかりません。"
          : e instanceof ApiError && e.status === 409
            ? ALREADY_LINKED_MSG
            : "Nostr 連携に失敗しました。",
      );
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

      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" gutterBottom>
            ログイン方法（連携）
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            複数のログイン方法を連携できます。そのログイン方法だけの別アカウントが
            既にある場合は、連携がこちらへ引き継がれます。
          </Typography>

          {linkError === "already_linked" && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {ALREADY_LINKED_MSG}
            </Alert>
          )}

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
    </Stack>
  );
}
