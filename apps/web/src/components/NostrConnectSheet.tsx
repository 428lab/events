import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { QrCodeSvg } from "./BigQrDialog.js";
import type { LoginEventSigner } from "../lib/nostr.js";
import {
  NostrConnectError,
  buildConnectRequest,
  clearSavedSession,
  loadSavedSession,
  requestSignEvent,
  saveSession,
  waitForConnect,
  type NostrConnectSession,
} from "../lib/nostrConnect.js";

type Phase =
  | { kind: "starting" }
  | { kind: "saved" }
  | { kind: "connect"; uri: string }
  | { kind: "sign" }
  | { kind: "error"; message: string };

/** タッチ操作の端末（スマホ）ならボタンを主に、それ以外（PC）なら QR を主に出す */
function isCoarsePointer(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    Boolean(window.matchMedia("(pointer: coarse)")?.matches)
  );
}

/**
 * 署名アプリ（Amber など）で Nostr ログイン・連携するシート (D-NOSTR-SIGNER)。
 *
 * 開いた（マウントした）時点で始める。前回つないだ署名アプリを覚えていれば、
 * まずそれに署名を頼む。応答が無い・断られたら覚えた接続を消し、
 * `nostrconnect://`（ボタンと QR）でつなぎ直す画面に切り替える。
 *
 * `submit` はお題への署名とサーバーへの送信（`signLoginChallenge`）。
 * 署名アプリ以外の失敗（サーバーで弾かれた等）は `onFailed` で呼び出し元に返す。
 */
export function NostrConnectSheet({
  title,
  submit,
  onDone,
  onFailed,
  onClose,
}: {
  title: string;
  submit: (sign: LoginEventSigner) => Promise<void>;
  onDone: () => void;
  onFailed: (error: unknown) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [useSaved, setUseSaved] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<Phase>(() =>
    loadSavedSession() ? { kind: "saved" } : { kind: "starting" },
  );
  const [coarse] = useState(isCoarsePointer);

  useEffect(() => {
    const ac = new AbortController();
    const saved = useSaved ? loadSavedSession() : null;
    let connecting = false;
    const run = async () => {
      try {
        let session: NostrConnectSession;
        if (saved) {
          setPhase({ kind: "saved" });
          session = saved;
        } else {
          const req = buildConnectRequest(window.location.origin);
          setPhase({ kind: "connect", uri: req.uri });
          connecting = true;
          session = await waitForConnect(req, { signal: ac.signal });
          connecting = false;
          setPhase({ kind: "sign" });
        }
        await submit((template) =>
          requestSignEvent(session, template, { signal: ac.signal }),
        );
        saveSession(session);
        onDone();
      } catch (e) {
        if (ac.signal.aborted) return;
        if (e instanceof NostrConnectError) {
          if (saved) {
            // 前回の接続が使えなかった。忘れて、つなぎ直す画面にする
            clearSavedSession();
            setUseSaved(false);
            return;
          }
          setPhase({
            kind: "error",
            message:
              e.code === "timeout"
                ? connecting
                  ? t("login.signerTimeout")
                  : t("login.signerSignTimeout")
                : e.code === "rejected"
                  ? t("login.signerRejected")
                  : t("login.signerRelayFailed"),
          });
          return;
        }
        onFailed(e);
      }
    };
    void run();
    return () => ac.abort();
    // submit / onDone / onFailed は呼び出し元で毎回作り直されるが、やり直しの
    // きっかけにはしない（始め直すのは開いたとき・もう一度・別の署名アプリ）
  }, [useSaved, attempt]);

  const useAnother = () => {
    clearSavedSession();
    setUseSaved(false);
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {phase.kind === "saved" && (
          <Stack spacing={2} alignItems="center" sx={{ py: 1 }}>
            <CircularProgress size={32} />
            <Typography textAlign="center">
              {t("login.signerSavedWaiting")}
            </Typography>
            <Typography variant="body2" color="text.secondary" textAlign="center">
              {t("login.signerSavedHint")}
            </Typography>
          </Stack>
        )}

        {phase.kind === "connect" && (
          <Stack spacing={2} alignItems="center" sx={{ py: 1 }}>
            {coarse && (
              <Button variant="contained" size="large" fullWidth href={phase.uri}>
                {t("login.signerOpenApp")}
              </Button>
            )}
            <Box sx={{ width: coarse ? 160 : 240, maxWidth: "100%" }}>
              <QrCodeSvg url={phase.uri} label={t("login.signerQrLabel")} />
            </Box>
            <Typography variant="body2" color="text.secondary" textAlign="center">
              {coarse ? t("login.signerReturnHint") : t("login.signerQrHint")}
            </Typography>
            {!coarse && (
              <Button variant="text" size="small" href={phase.uri}>
                {t("login.signerOpenApp")}
              </Button>
            )}
            <Stack direction="row" spacing={1} alignItems="center">
              <CircularProgress size={16} />
              <Typography variant="body2">{t("login.signerWaiting")}</Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary" textAlign="center">
              {t("login.signerAppRequired")}
            </Typography>
          </Stack>
        )}

        {phase.kind === "sign" && (
          <Stack spacing={2} alignItems="center" sx={{ py: 1 }}>
            <CircularProgress size={32} />
            <Typography textAlign="center">
              {t("login.signerApproveSign")}
            </Typography>
          </Stack>
        )}

        {phase.kind === "error" && (
          <Alert severity="warning">{phase.message}</Alert>
        )}
      </DialogContent>
      <DialogActions>
        {phase.kind === "saved" && (
          <Button onClick={useAnother}>{t("login.signerUseAnother")}</Button>
        )}
        {phase.kind === "error" && (
          <Button variant="contained" onClick={() => setAttempt((n) => n + 1)}>
            {t("common.retry")}
          </Button>
        )}
        <Button onClick={onClose}>{t("common.cancel")}</Button>
      </DialogActions>
    </Dialog>
  );
}
