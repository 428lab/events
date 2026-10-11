import { useEffect, useRef, useState } from "react";
import { Alert, Box, Button, Card, CardContent, CircularProgress, Stack, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api/client.js";
import { errorCode } from "../lib/errorMessage.js";
import { submitSignedLoginEvent } from "../lib/nostr.js";
import {
  clearNostrSignerIntent,
  parseSignedEventFromUrl,
  readNostrSignerIntent,
  type NostrSignerIntent,
} from "../lib/nostrSignerLogin.js";
import { safeRedirectPath } from "../lib/safeRedirect.js";

/**
 * Amber（NIP-55）で署名して戻ってくるページ `/login/nostr-signer` (D-NOSTR-SIGNER PR-B)。
 *
 * 署名済みのお題を URL のフラグメントから読んだら、すぐ URL から消す（お題の nonce は使うと消えるが、
 * 履歴に残さない）。サーバーに送り、通ったら移る。ページを読み直すので、
 * ログイン状態はふつうの起動と同じ流れで反映される。
 * - ログイン：控えた戻り先（postLoginRedirect）か /me
 * - 連携：/account。引き取りを断られた (409) ときは ?link_error= を付けて、
 *   アカウント設定のいつものモーダルで説明する
 */
export function NostrSignerCallbackPage() {
  const { t } = useTranslation();
  // StrictMode で effect が2回走っても、送るのは1回だけ
  const started = useRef(false);
  const [state] = useState(() => ({
    event: parseSignedEventFromUrl(window.location.hash),
    intent: readNostrSignerIntent(),
  }));
  const [error, setError] = useState<string | null>(() =>
    state.event ? null : t("login.signerCallbackInvalid"),
  );

  useEffect(() => {
    window.history.replaceState(null, "", window.location.pathname);
    clearNostrSignerIntent();
    if (started.current || !state.event) return;
    started.current = true;
    void finish(state.event, state.intent).catch((e: unknown) => {
      if (state.intent === "link" && e instanceof ApiError && e.status === 409) {
        window.location.replace(
          `/account?link_error=${encodeURIComponent(errorCode(e) ?? "default")}`,
        );
        return;
      }
      setError(t(state.intent === "link" ? "settings.nostrLinkFailed" : "login.signInFailed"));
    });
  }, [state, t]);

  const backHref = state.intent === "link" ? "/account" : "/login";

  return (
    <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", p: 2 }}>
      <Card sx={{ maxWidth: 420, width: "100%" }}>
        <CardContent>
          <Stack spacing={2} alignItems="center" sx={{ py: 2 }}>
            {error ? (
              <>
                <Alert severity="warning" sx={{ width: "100%" }}>
                  {error}
                </Alert>
                <Button variant="contained" href={backHref}>
                  {t(state.intent === "link" ? "login.signerBackToAccount" : "login.signerBackToLogin")}
                </Button>
              </>
            ) : (
              <>
                <CircularProgress size={32} />
                <Typography>
                  {t(state.intent === "link" ? "login.signerCallbackLinking" : "login.signerCallbackSigningIn")}
                </Typography>
              </>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}

async function finish(
  event: { pubkey: string },
  intent: NostrSignerIntent,
): Promise<void> {
  await submitSignedLoginEvent(event);
  if (intent === "link") {
    window.location.replace("/account");
    return;
  }
  const next = safeRedirectPath(localStorage.getItem("postLoginRedirect"));
  localStorage.removeItem("postLoginRedirect");
  window.location.replace(next ?? "/me");
}
