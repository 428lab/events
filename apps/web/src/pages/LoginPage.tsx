import { useEffect, useState } from "react";
import { Alert, Box, Button, Card, CardContent, Stack, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthProviders, useDevLogin } from "../api/hooks.js";
import { PROVIDER_META, providerLabel } from "../lib/providers.js";
import { hasNip07, nostrNip07Login } from "../lib/nostr.js";
import { safeRedirectPath } from "../lib/safeRedirect.js";

export function LoginPage() {
  const { t } = useTranslation();
  const devLogin = useDevLogin();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const [nostrBusy, setNostrBusy] = useState(false);
  const [nostrError, setNostrError] = useState<string | null>(null);
  const { data: providers } = useAuthProviders();
  // 設定済みプロバイダが取れない場合のフォールバック（Discord）
  const list = providers && providers.length > 0 ? providers : ["discord"];

  // ログイン後に戻る先（OAuthリダイレクトを跨ぐため localStorage に退避）。
  // 外部サイトへの踏み台にされないよう、同一オリジンのパスだけを控える
  const next = safeRedirectPath(params.get("next"));
  useEffect(() => {
    if (next) localStorage.setItem("postLoginRedirect", next);
  }, [next]);

  const nostrLogin = async () => {
    setNostrError(null);
    setNostrBusy(true);
    try {
      await nostrNip07Login();
      await qc.invalidateQueries({ queryKey: ["me"] });
      navigate(next ?? "/me");
    } catch (e) {
      setNostrError(
        e instanceof Error && e.message === "no_extension"
          ? t("login.extensionMissing")
          : t("login.signInFailed"),
      );
    } finally {
      setNostrBusy(false);
    }
  };

  return (
    <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", p: 2 }}>
      <Card sx={{ maxWidth: 420, width: "100%" }}>
        <CardContent>
          <Stack spacing={3} alignItems="center" sx={{ py: 2 }}>
            <Typography variant="h4" fontWeight={700}>
              events lab
            </Typography>
            <Typography color="text.secondary" textAlign="center">
              {t("login.tagline")}
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
                    {t("login.signInWith", { provider: providerLabel(p) })}
                  </Button>
                );
              })}
              <Button
                variant="contained"
                size="large"
                fullWidth
                disabled={nostrBusy}
                onClick={nostrLogin}
                sx={{
                  bgcolor: PROVIDER_META.nostr.color,
                  color: PROVIDER_META.nostr.textColor,
                  "&:hover": {
                    bgcolor: PROVIDER_META.nostr.color,
                    filter: "brightness(0.95)",
                  },
                }}
              >
                {nostrBusy
                  ? t("login.checking")
                  : t("login.signInWith", { provider: providerLabel("nostr") })}
              </Button>
              {nostrError && <Alert severity="warning">{nostrError}</Alert>}
              {!hasNip07() && !nostrError && (
                <Typography variant="caption" color="text.secondary">
                  {t("login.extensionHint")}
                </Typography>
              )}
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
                  {t("login.devLogin")}
                </Button>
                <Typography variant="caption" color="text.secondary">
                  {t("login.devLoginNote")}
                </Typography>
              </>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
