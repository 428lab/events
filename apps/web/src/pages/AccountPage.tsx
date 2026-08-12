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
import { useTranslation } from "react-i18next";
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
import { errorCode } from "../lib/errorMessage.js";
import { i18next, tDynamic } from "../i18n/index.js";

/** OAuth コールバックの ?link_error / API の 409 で返るコードを文言にする。
 *  表は辞書（linkError 名前空間）にあり、知らないコードは default に落ちる */
function linkErrorMessage(code: string | null | undefined): string {
  const fallback = i18next.t("linkError.default");
  return code ? tDynamic(`linkError.${code}`, fallback) : fallback;
}

export function AccountPage() {
  const { t } = useTranslation();
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

  if (!me || !identities) return <Typography>{t("common.loading")}</Typography>;

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
        setLinkErrorDialog(linkErrorMessage(errorCode(e)));
      } else {
        setNostrError(
          e instanceof Error && e.message === "no_extension"
            ? t("settings.nostrExtensionMissing")
            : t("settings.nostrLinkFailed"),
        );
      }
    } finally {
      setNostrBusy(false);
    }
  };

  return (
    <Stack spacing={3}>
      <Typography variant="h5" fontWeight={700}>
        {t("settings.accountTitle")}
      </Typography>

      <UsernameCard />

      <LanguageCard />

      <NotificationPrefsCard />

      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" gutterBottom>
            {t("settings.loginMethodsTitle")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("settings.loginMethodsDescription")}
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
                      <Chip
                        size="small"
                        color="success"
                        label={t("settings.linked")}
                      />
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
                        {t("settings.unlink")}
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
                          {nostrBusy
                            ? t("settings.linkChecking")
                            : t("settings.link")}
                        </Button>
                      ) : (
                        <Button
                          size="small"
                          variant="contained"
                          href={`/api/auth/${p}/login`}
                        >
                          {t("settings.link")}
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
              {t("settings.lastLoginMethodNotice")}
            </Alert>
          )}
        </CardContent>
      </Card>

      <AccountMergeCard />

      <AccountDeleteCard />

      {/* 連携エラーは見落とし防止のためモーダルで表示 (#245) */}
      <Dialog open={Boolean(linkErrorDialog)} onClose={closeLinkErrorDialog}>
        <DialogTitle>{t("settings.linkFailedTitle")}</DialogTitle>
        <DialogContent>
          <DialogContentText>{linkErrorDialog}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={closeLinkErrorDialog}>
            {t("common.close")}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
