import { Box, Button, Card, CardContent, Stack, Typography } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { useAuthProviders, useDevLogin } from "../api/hooks.js";
import { PROVIDER_META, providerLabel } from "../lib/providers.js";

export function LoginPage() {
  const devLogin = useDevLogin();
  const navigate = useNavigate();
  const { data: providers } = useAuthProviders();
  // 設定済みプロバイダが取れない場合のフォールバック（Discord）
  const list = providers && providers.length > 0 ? providers : ["discord"];

  return (
    <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", p: 2 }}>
      <Card sx={{ maxWidth: 420, width: "100%" }}>
        <CardContent>
          <Stack spacing={3} alignItems="center" sx={{ py: 2 }}>
            <Typography variant="h4" fontWeight={700}>
              events lab
            </Typography>
            <Typography color="text.secondary" textAlign="center">
              アイディアソン・ハッカソン運営ツール
            </Typography>

            <Stack spacing={1.5} sx={{ width: "100%" }}>
              {list.map((p) => {
                const meta = PROVIDER_META[p];
                return (
                  <Button
                    key={p}
                    variant="contained"
                    size="large"
                    fullWidth
                    href={`/api/auth/${p}/login`}
                    sx={
                      meta
                        ? {
                            bgcolor: meta.color,
                            color: meta.textColor,
                            border: "1px solid rgba(0,0,0,0.12)",
                            "&:hover": {
                              bgcolor: meta.color,
                              filter: "brightness(0.95)",
                            },
                          }
                        : undefined
                    }
                  >
                    {providerLabel(p)} でログイン
                  </Button>
                );
              })}
            </Stack>

            {import.meta.env.DEV && (
              <>
                <Button
                  variant="outlined"
                  size="large"
                  fullWidth
                  disabled={devLogin.isPending}
                  onClick={() =>
                    devLogin.mutate(undefined, { onSuccess: () => navigate("/me") })
                  }
                >
                  開発用ログイン
                </Button>
                <Typography variant="caption" color="text.secondary">
                  ※ 開発用ログインは開発環境でのみ動作します
                </Typography>
              </>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
