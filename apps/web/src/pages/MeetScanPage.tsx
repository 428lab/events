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

interface FailureInfo {
  message: string;
  /** 同じトークンで再試行する意味があるか（QRを出し直してもらう必要がない） */
  retryable: boolean;
}

const FAILURES: Record<Failure, FailureInfo> = {
  expired: {
    message:
      "QRの有効期限が切れました。相手の画面のQRをもう一度読み取ってください",
    retryable: false,
  },
  invalid: {
    message: "このQRは読み取れませんでした。もう一度読み取ってください",
    retryable: false,
  },
  self: { message: "自分のQRは読み取れません", retryable: false },
  no_shared_event: {
    message: "同じイベントに参加していないため記録できません",
    retryable: false,
  },
  outside_window: {
    message:
      "イベントの開催時間帯ではないため記録できません（開始30分前から終了2時間後まで）",
    retryable: false,
  },
  not_confirmed_me: {
    message:
      "あなたの参加がまだ確定していないため記録できません。参加を確定してからもう一度お試しください",
    retryable: true,
  },
  not_confirmed_target: {
    message: "相手の参加がまだ確定していないため記録できません",
    retryable: false,
  },
  network: {
    message:
      "通信できませんでした。電波の状態を確かめて、もう一度お試しください",
    retryable: true,
  },
  unauthorized: {
    message: "ログインの有効期限が切れました。ログインし直してください",
    retryable: false,
  },
  server: {
    message: "一時的に記録できませんでした。もう一度お試しください",
    retryable: true,
  },
};

const SERVER_CODES = new Set<string>([
  "expired",
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

  const attendanceAdded =
    result?.events.some((e) => e.attendedMe || e.attendedTarget) ?? false;
  const info = failure ? FAILURES[failure] : null;

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
              交流の記録
            </Typography>

            {!result && !failure && (
              <Stack direction="row" spacing={1.5} alignItems="center">
                <CircularProgress size={20} />
                <Typography color="text.secondary">記録しています…</Typography>
              </Stack>
            )}

            {info && (
              <>
                <Alert severity={info.retryable ? "info" : "warning"}>
                  {info.message}
                </Alert>
                <Stack direction="row" spacing={1}>
                  {/* トークンはURLに残っているので、同じ読み取りをやり直せる */}
                  <Button
                    variant="contained"
                    startIcon={<RefreshIcon />}
                    disabled={scan.isPending}
                    onClick={run}
                  >
                    もう一度試す
                  </Button>
                  {failure === "unauthorized" ? (
                    <Button
                      component={RouterLink}
                      to={`/login?next=${encodeURIComponent(`/m/${token}`)}`}
                      variant="outlined"
                    >
                      ログインする
                    </Button>
                  ) : (
                    <Button component={RouterLink} to="/" variant="outlined">
                      トップへ戻る
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
                  <Alert severity="info">記録を取り消しました</Alert>
                ) : (
                  <>
                    {result.events.map((ev) => (
                      <Alert
                        key={ev.eventId}
                        severity={ev.meetCreated ? "success" : "info"}
                      >
                        {ev.meetCreated
                          ? `「${ev.title}」で出会いを記録しました！お互いにXPが入ります`
                          : `「${ev.title}」では記録済みです`}
                      </Alert>
                    ))}
                    {attendanceAdded && (
                      <Alert severity="success">
                        受付（出席）も一緒に済ませました
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
                    プロフィールを見る
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
                      取り消す
                    </Button>
                  )}
                </Stack>
                {undo.isError && (
                  <Alert severity="warning">
                    取り消しに失敗しました。もう一度お試しください
                  </Alert>
                )}
              </>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
