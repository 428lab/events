import { useEffect, useRef, useState } from "react";
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
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom";
import type { MeetScanFailure, MeetScanResult } from "@eventer/shared";
import { useMe } from "../api/hooks.js";
import { ApiError } from "../api/client.js";
import { useMeetScan, useMeetUndo } from "../api/eventMeetHooks.js";

/**
 * QRを読み取った側が開く画面 (#330)。
 * 開いた時点でサーバーが使い捨てトークンを検証し、その場で出会いを記録する。
 * 誤って読み取ったときのために取り消しも出す。
 *
 * 未ログインならログイン画面へ送り、ログイン後にこのURLへ戻ってくる
 * （戻り先は /login?next= の既存の仕組みに乗る）。トークンには有効期限が
 * あるので、ログインに手間取って切れた場合は「読み取り直し」を案内する。
 */

/** 失敗理由ごとの案内。何が起きたか分かるように区別して出す */
const FAILURE_MESSAGE: Record<MeetScanFailure, string> = {
  expired:
    "QRの有効期限が切れました。相手の画面のQRをもう一度読み取ってください",
  invalid: "このQRは読み取れませんでした。もう一度読み取ってください",
  self: "自分のQRは読み取れません",
  no_shared_event: "同じイベントに参加していないため記録できません",
  outside_window:
    "イベントの開催時間帯ではないため記録できません（開始30分前から終了2時間後まで）",
  not_confirmed:
    "同じイベントへの参加がまだ確定していないため記録できません",
};

const FAILURES = new Set<string>(Object.keys(FAILURE_MESSAGE));

function failureOf(err: unknown): MeetScanFailure {
  if (err instanceof ApiError) {
    const code = (err.body as { error?: string } | null)?.error;
    if (code && FAILURES.has(code)) return code as MeetScanFailure;
  }
  return "invalid";
}

export function MeetScanPage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const { data: me, isLoading: meLoading } = useMe();
  const scan = useMeetScan();
  const undo = useMeetUndo();
  const [result, setResult] = useState<MeetScanResult | null>(null);
  const [failure, setFailure] = useState<MeetScanFailure | null>(null);
  const [undone, setUndone] = useState(false);
  // 二重送信を防ぐ（React の再マウントや再描画で走らせない）
  const sent = useRef(false);

  useEffect(() => {
    if (meLoading || !token) return;
    if (!me) {
      // ログイン後にこのURLへ戻す
      navigate(`/login?next=${encodeURIComponent(`/m/${token}`)}`, {
        replace: true,
      });
      return;
    }
    if (sent.current) return;
    sent.current = true;
    scan.mutate(token, {
      onSuccess: (r) => setResult(r),
      onError: (e) => setFailure(failureOf(e)),
    });
  }, [me, meLoading, token, navigate, scan]);

  const attendanceAdded =
    result?.events.some((e) => e.attendedMe || e.attendedTarget) ?? false;

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

            {failure && (
              <>
                <Alert severity="warning">{FAILURE_MESSAGE[failure]}</Alert>
                <Button component={RouterLink} to="/" variant="outlined">
                  トップへ戻る
                </Button>
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
                        undo.mutate(
                          {
                            userId: result.target.id,
                            events: result.events.map((ev) => ({
                              eventId: ev.eventId,
                              revokeMyAttendance: ev.attendedMe,
                              revokeTargetAttendance: ev.attendedTarget,
                            })),
                          },
                          { onSuccess: () => setUndone(true) },
                        )
                      }
                    >
                      取り消す
                    </Button>
                  )}
                </Stack>
                {undo.isError && (
                  <Alert severity="warning">
                    取り消しに失敗しました。時間をおいてお試しください
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
