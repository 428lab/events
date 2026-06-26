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
import {
  useAuthProviders,
  useIdentities,
  useMe,
  useUnlinkIdentity,
} from "../api/hooks.js";
import { UsernameCard } from "../components/UsernameCard.js";
import { PROVIDER_META, providerLabel } from "../lib/providers.js";

export function AccountPage() {
  const { data: me } = useMe();
  const { data: providers } = useAuthProviders();
  const { data: identities } = useIdentities();
  const unlink = useUnlinkIdentity();

  if (!me || !identities) return <Typography>読み込み中…</Typography>;

  const linked = new Map(identities.map((i) => [i.provider, i]));
  const all = providers && providers.length > 0 ? providers : ["discord"];
  const canUnlink = identities.length > 1;

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
            複数のログイン方法を連携できます。別アカウントで作成済みのサービスを連携すると、
            そのアカウントは現在のアカウントに統合されます。
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
                      <Button
                        size="small"
                        variant="contained"
                        href={`/api/auth/${p}/login`}
                      >
                        連携する
                      </Button>
                    </>
                  )}
                </Box>
              );
            })}
          </Stack>

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
