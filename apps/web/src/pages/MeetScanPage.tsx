import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import HandshakeOutlinedIcon from "@mui/icons-material/HandshakeOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { MeetScanFailure, MeetScanResult } from "@eventer/shared";
import { useMe } from "../api/hooks.js";
import { ApiError, NetworkError } from "../api/client.js";
import { useMeetScan, useMeetUndo } from "../api/eventMeetHooks.js";

/**
 * QRを読み取った側が開く画面 (#330)。
 * 開いた時点でサーバーが使い捨てトークンを検証し、その場で出会いを記録する。
 * 誤って読み取ったときのために取り消しも出す。
 *
 * 未ログインならログイン画面へ送り、ログイン後にこのURLへ戻ってくる
 * （戻り先は /login?next= の既存の仕組みに乗る）。
 *
 * 会場では電波が不安定なことが多いので、失敗の理由を潰さないこと。
 * 通信断や一時的なエラーを「読み取れないQR」と案内すると、正常なQRを何度も
 * 出し直させることになる。サーバーの返事が無い種類の失敗は必ず再試行に誘導する。
 */

/** サーバーの理由コードに、web 側でしか分からない失敗を足したもの */
type Failure =
  | MeetScanFailure
  /** 応答が返らなかった（圏外・回線断・時間切れ） */
  | "network"
  /** ログインが切れていた */
  | "unauthorized"
  /** サーバー側の一時的な不調 */
  | "server";

/**
 * 同じトークンで再試行する意味があるか（QRを出し直してもらう必要がない）。
 * 文言そのものは meetFailure 名前空間にある（同じ表を2か所に持たない）
 */
const RETRYABLE: Record<Failure, boolean> = {
  expired: false,
  used: false,
  invalid: false,
  self: false,
  no_shared_event: false,
  outside_window: false,
  not_confirmed_me: true,
  not_confirmed_target: false,
  network: true,
  unauthorized: false,
  server: true,
};

const SERVER_CODES = new Set<string>([
  "expired",
  "used",
  "invalid",
  "self",
  "no_shared_event",
  "outside_window",
  "not_confirmed_me",
  "not_confirmed_target",
]);

export function failureOf(err: unknown): Failure {
  if (err instanceof NetworkError) return "network";
  if (!(err instanceof ApiError)) return "network";
  if (err.status === 401) return "unauthorized";
  if (err.status >= 500) return "server";
  const code = (err.body as { error?: string } | null)?.error;
  if (code && SERVER_CODES.has(code)) return code as Failure;
  // 想定していない 4xx。QRのせいと決めつけない
  return "server";
}

export function MeetScanPage() {
  const { token = "" } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: me, isLoading: meLoading } = useMe();
  const scan = useMeetScan();
  const undo = useMeetUndo();
  const [result, setResult] = useState<MeetScanResult | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [undone, setUndone] = useState(false);
  // 自動での送信は1回だけ（再描画や再マウントで二重に走らせない）。
  // 再試行はボタンから明示的に行う
  const autoSent = useRef(false);

  const run = useCallback(() => {
    setFailure(null);
    scan.mutate(token, {
      onSuccess: (r) => setResult(r),
      onError: (e) => setFailure(failureOf(e)),
    });
    // scan は useMutation の戻り値で毎描画ごとに変わるため依存に入れない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (meLoading || !token) return;
    if (!me) {
      // ログイン後にこのURLへ戻す
      navigate(`/login?next=${encodeURIComponent(`/m/${token}`)}`, {
        replace: true,
      });
      return;
    }
    if (autoSent.current) return;
    autoSent.current = true;
    run();
  }, [me, meLoading, token, navigate, run]);

  // 受付が済んだのが自分か相手かで案内が変わる。1つに潰すと、読んでもらった
  // 参加者に「自分の受付が済んだ」ことが伝わらず、受付に並び直す二度手間になる
  const attendedMe = result?.events.some((e) => e.attendedMe) ?? false;
  const attendedTarget = result?.events.some((e) => e.attendedTarget) ?? false;

  return (
    <Box sx={{ maxWidth: 560, mx: "auto", p: 2 }}>
      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography
              variant="h6"
              sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
            >
              <HandshakeOutlinedIcon fontSize="small" />
              {t("meet.title")}
            </Typography>

            {!result && !failure && (
              <Stack direction="row" spacing={1.5} alignItems="center">
                <CircularProgress size={20} />
                <Typography color="text.secondary">
                  {t("meet.recording")}
                </Typography>
              </Stack>
            )}

            {failure && (
              <>
                <Alert severity={RETRYABLE[failure] ? "info" : "warning"}>
                  {t(`meetFailure.${failure}`)}
                </Alert>
                <Stack direction="row" spacing={1}>
                  {/* トークンはURLに残っているので、同じ読み取りをやり直せる */}
                  <Button
                    variant="contained"
                    startIcon={<RefreshIcon />}
                    disabled={scan.isPending}
                    onClick={run}
                  >
                    {t("meet.retry")}
                  </Button>
                  {failure === "unauthorized" ? (
                    <Button
                      component={RouterLink}
                      to={`/login?next=${encodeURIComponent(`/m/${token}`)}`}
                      variant="outlined"
                    >
                      {t("meet.signIn")}
                    </Button>
                  ) : (
                    <Button component={RouterLink} to="/" variant="outlined">
                      {t("meet.backToTop")}
                    </Button>
                  )}
                </Stack>
              </>
            )}

            {result && (
              <>
                <Stack direction="row" spacing={1.5} alignItems="center">
                  {result.target.avatarUrl && (
                    <Avatar
                      src={result.target.avatarUrl}
                      sx={{ width: 48, height: 48 }}
                    />
                  )}
                  <Box>
                    <Typography variant="subtitle1" fontWeight={700}>
                      {result.target.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      @{result.target.username}
                    </Typography>
                  </Box>
                </Stack>

                {undone ? (
                  <Alert severity="info">{t("meet.undone")}</Alert>
                ) : (
                  <>
                    {result.events.map((ev) => (
                      <Alert
                        key={ev.eventId}
                        severity={ev.meetCreated ? "success" : "info"}
                      >
                        {ev.meetCreated
                          ? t("meet.recorded", { title: ev.title })
                          : t("meet.alreadyRecorded", { title: ev.title })}
                      </Alert>
                    ))}
                    {attendedMe && (
                      <Alert severity="success">{t("meet.attendedMe")}</Alert>
                    )}
                    {attendedTarget && (
                      <Alert severity="success">
                        {t("meet.attendedTarget", {
                          name: result.target.name,
                        })}
                      </Alert>
                    )}
                  </>
                )}

                <Stack direction="row" spacing={1}>
                  <Button
                    component={RouterLink}
                    to={`/users/${encodeURIComponent(result.target.username)}`}
                    variant="contained"
                  >
                    {t("common.viewProfile")}
                  </Button>
                  {!undone && (
                    <Button
                      variant="outlined"
                      color="inherit"
                      disabled={undo.isPending}
                      onClick={() =>
                        undo.mutate(result.undoToken, {
                          onSuccess: () => setUndone(true),
                        })
                      }
                    >
                      {t("common.undo")}
                    </Button>
                  )}
                </Stack>
                {undo.isError && (
                  <Alert severity="warning">{t("meet.undoFailed")}</Alert>
                )}
              </>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
