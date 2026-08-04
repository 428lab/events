import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import QrCodeScannerIcon from "@mui/icons-material/QrCodeScanner";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { Link as RouterLink, useParams } from "react-router-dom";
import type { CheckinUser } from "@eventer/shared";
import { useEvent, useIsAdmin } from "../api/hooks.js";
import { api, ApiError } from "../api/client.js";
import { lookupMember, postCheckin } from "../api/checkinHooks.js";

/**
 * QR受付（スタッフ用リーダー） (#154)。スマホでの利用が前提。
 * - 入場QR（署名付きチケット `evt1.…`）→ 本人確認済みとして即時に出席記録
 * - プロフィールURLのQR（印刷した名札カード等）→ 照会のみ。出席は staff の手動操作
 * デコードはネイティブ BarcodeDetector を優先し、無ければ jsQR にフォールバックする。
 */

/** username か UUID（member-lookup と同じ文字種） */
const HANDLE_RE = /^(?:[A-Za-z0-9_.-]{2,32}|[0-9a-fA-F-]{36})$/;

/** BarcodeDetector の最小型（TS の lib.dom にまだ無い） */
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
interface BarcodeDetectorCtor {
  new (options?: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

type PanelKind =
  | "checked_in" // チケットで出席記録（本人確認済み）
  | "manual_done" // プロフィールQR経由で手動記録
  | "already"
  | "not_confirmed"
  | "unknown_user"
  | "expired"
  | "manual"; // プロフィールQR: 手動記録の確認待ち

interface Panel {
  kind: PanelKind;
  user?: CheckinUser;
}

interface LogEntry {
  at: number;
  name: string;
  label: string;
  userId?: string;
  /** 出席記録した行は取り消せる */
  canUndo?: boolean;
  undone?: boolean;
}

export function CheckinPage() {
  const { id = "" } = useParams();
  const { data: eventData } = useEvent(id);
  const isAdmin = useIsAdmin();
  const isStaff = eventData?.myRole === "staff" || isAdmin;
  const enabled = Boolean(eventData) && isStaff;

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);

  // デコードループから参照する可変状態は ref に置く（ループ再構築を避ける）
  const pausedRef = useRef(false);
  const lastRef = useRef({ text: "", at: 0 });
  const resumeTimerRef = useRef<number | undefined>(undefined);
  const noticeTimerRef = useRef<number | undefined>(undefined);

  const addLog = useCallback((entry: Omit<LogEntry, "at">) => {
    setLog((prev) => [{ at: Date.now(), ...entry }, ...prev].slice(0, 10));
  }, []);

  /** 結果パネルを ms 後に閉じてスキャンを再開する */
  const scheduleResume = useCallback((ms: number) => {
    window.clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = window.setTimeout(() => {
      setPanel(null);
      pausedRef.current = false;
    }, ms);
  }, []);

  /** スキャンを止めない軽い通知（不明なQRなど） */
  const flashNotice = useCallback((message: string) => {
    setNotice(message);
    window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 2500);
  }, []);

  /** 入場チケット（署名付き）→ サーバー検証・即時出席記録 */
  const doTokenCheckin = useCallback(
    async (token: string) => {
      pausedRef.current = true;
      try {
        const res = await postCheckin(id, token);
        if (res.result === "checked_in") {
          setPanel({ kind: "checked_in", user: res.user });
          addLog({
            name: res.user.name,
            label: "出席（本人確認済み）",
            userId: res.user.id,
            canUndo: true,
          });
          scheduleResume(1500);
        } else if (res.result === "already") {
          setPanel({ kind: "already", user: res.user });
          addLog({ name: res.user.name, label: "出席済み" });
          scheduleResume(1500);
        } else {
          setPanel({ kind: "not_confirmed", user: res.user });
          addLog({ name: res.user.name, label: "確定参加者ではない" });
          scheduleResume(2500);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 410) {
          setPanel({ kind: "expired" });
          scheduleResume(2500);
        } else {
          flashNotice("無効なQRコードです");
          pausedRef.current = false;
        }
      }
    },
    [id, addLog, scheduleResume, flashNotice],
  );

  /** プロフィールQR → 照会のみ（出席記録は手動ボタン） */
  const doLookup = useCallback(
    async (handle: string) => {
      pausedRef.current = true;
      try {
        const res = await lookupMember(id, handle);
        if (!res.found || !res.user) {
          setPanel({ kind: "unknown_user" });
          scheduleResume(2000);
        } else if (!res.member || res.member.status !== "confirmed") {
          setPanel({ kind: "not_confirmed", user: res.user });
          addLog({ name: res.user.name, label: "確定参加者ではない" });
          scheduleResume(2500);
        } else if (res.member.attended) {
          setPanel({ kind: "already", user: res.user });
          addLog({ name: res.user.name, label: "出席済み" });
          scheduleResume(1500);
        } else {
          // 手動記録の確認待ち。自動では閉じない
          setPanel({ kind: "manual", user: res.user });
        }
      } catch {
        flashNotice("照会に失敗しました");
        pausedRef.current = false;
      }
    },
    [id, addLog, scheduleResume, flashNotice],
  );

  /** プロフィールQR経由の手動出席記録 */
  const manualAttend = useCallback(
    async (user: CheckinUser) => {
      try {
        await api.patch(`/events/${id}/members/${user.id}/attendance`, {
          attended: true,
        });
        setPanel({ kind: "manual_done", user });
        addLog({
          name: user.name,
          label: "出席（手動）",
          userId: user.id,
          canUndo: true,
        });
        scheduleResume(1500);
      } catch {
        flashNotice("出席の記録に失敗しました");
      }
    },
    [id, addLog, scheduleResume, flashNotice],
  );

  /** 記録の取り消し（誤スキャン対応） */
  const undoAttend = useCallback(
    async (entry: LogEntry) => {
      if (!entry.userId) return;
      try {
        await api.patch(`/events/${id}/members/${entry.userId}/attendance`, {
          attended: false,
        });
        setLog((prev) =>
          prev.map((e) => (e === entry ? { ...e, undone: true } : e)),
        );
      } catch {
        flashNotice("取り消しに失敗しました");
      }
    },
    [id, flashNotice],
  );

  /** デコード結果の振り分け。3秒以内の同一QRは無視（連続発火防止） */
  const handleDecode = useCallback(
    (text: string) => {
      const now = Date.now();
      if (lastRef.current.text === text && now - lastRef.current.at < 3000) {
        return;
      }
      lastRef.current = { text, at: now };
      if (text.startsWith("evt1.")) {
        void doTokenCheckin(text);
        return;
      }
      // プロフィールURL（別オリジンの印刷カードも許容: パスだけ見る）または素のhandle
      let handle: string | null = null;
      if (HANDLE_RE.test(text)) {
        handle = text;
      } else {
        try {
          const m = new URL(text).pathname.match(
            /^\/users\/([A-Za-z0-9_.-]{2,36})(?:\/.*)?$/,
          );
          if (m) handle = m[1];
        } catch {
          // URL でもない → 不明なQR
        }
      }
      if (!handle || !HANDLE_RE.test(handle)) {
        flashNotice("このイベントの受付用QRではありません");
        return;
      }
      void doLookup(handle);
    },
    [doTokenCheckin, doLookup, flashNotice],
  );
  const handleDecodeRef = useRef(handleDecode);
  handleDecodeRef.current = handleDecode;

  // カメラ起動＋デコードループ（約10fps）
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer: number | undefined;

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
      } catch {
        setCameraError(
          "カメラを起動できませんでした。ブラウザのサイト設定でカメラの使用を許可して、ページを再読み込みしてください。",
        );
        return;
      }
      if (cancelled || !videoRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play().catch(() => undefined);

      // ネイティブ BarcodeDetector（対応環境）を優先。無ければ jsQR を遅延読み込み
      let detector: BarcodeDetectorLike | null = null;
      const Ctor = (window as { BarcodeDetector?: BarcodeDetectorCtor })
        .BarcodeDetector;
      if (Ctor) {
        try {
          const formats = (await Ctor.getSupportedFormats?.()) ?? [];
          if (formats.includes("qr_code")) {
            detector = new Ctor({ formats: ["qr_code"] });
          }
        } catch {
          detector = null;
        }
      }
      const jsQR = detector ? null : (await import("jsqr")).default;
      if (cancelled) return;

      timer = window.setInterval(async () => {
        if (pausedRef.current) return;
        const v = videoRef.current;
        if (!v || v.readyState < 2 || !v.videoWidth) return;
        let text: string | null = null;
        if (detector) {
          try {
            const codes = await detector.detect(v);
            text = codes[0]?.rawValue ?? null;
          } catch {
            text = null;
          }
        } else if (jsQR && canvasRef.current) {
          // デコード負荷を抑えるため長辺640pxに縮小してから読む
          const canvas = canvasRef.current;
          const scale = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
          canvas.width = Math.round(v.videoWidth * scale);
          canvas.height = Math.round(v.videoHeight * scale);
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) return;
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(img.data, img.width, img.height, {
            inversionAttempts: "dontInvert",
          });
          text = code?.data ?? null;
        }
        if (text) handleDecodeRef.current(text);
      }, 100);
    })();

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.clearTimeout(resumeTimerRef.current);
      window.clearTimeout(noticeTimerRef.current);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [enabled]);

  if (eventData && !isStaff) {
    return <Alert severity="warning">QR受付はスタッフ専用です。</Alert>;
  }

  return (
    <Stack spacing={2} sx={{ maxWidth: 480, mx: "auto" }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography
          variant="h5"
          fontWeight={700}
          sx={{ flex: 1, minWidth: 160, display: "flex", alignItems: "center", gap: 0.75 }}
        >
          <QrCodeScannerIcon fontSize="medium" />
          QR受付
        </Typography>
        <Button size="small" component={RouterLink} to={`/events/${id}`}>
          ← イベントへ戻る
        </Button>
      </Stack>

      {cameraError ? (
        <Alert severity="warning">{cameraError}</Alert>
      ) : (
        <Box
          sx={{
            position: "relative",
            borderRadius: 2,
            overflow: "hidden",
            bgcolor: "common.black",
            aspectRatio: "3 / 4",
          }}
        >
          <Box
            component="video"
            ref={videoRef}
            playsInline
            muted
            sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
          {/* 読み取り位置のガイド枠 */}
          <Box
            sx={{
              position: "absolute",
              inset: "18%",
              border: "2px solid rgba(255,255,255,0.65)",
              borderRadius: 2,
              pointerEvents: "none",
            }}
          />
          {panel && (
            <ResultOverlay
              panel={panel}
              onManualAttend={manualAttend}
              onCancelManual={() => {
                setPanel(null);
                pausedRef.current = false;
              }}
            />
          )}
          {notice && (
            <Box sx={{ position: "absolute", left: 8, right: 8, bottom: 8 }}>
              <Alert severity="info" sx={{ py: 0 }}>
                {notice}
              </Alert>
            </Box>
          )}
        </Box>
      )}
      <Typography variant="caption" color="text.secondary">
        参加者の「入場QR」またはプロフィールカードのQRを枠内にかざしてください。
        入場QRは本人確認済みとして自動で出席記録されます。
      </Typography>

      {log.length > 0 && (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle2" gutterBottom>
              受付ログ（最新10件）
            </Typography>
            <Stack spacing={0.75}>
              {log.map((e, i) => (
                <Stack
                  key={`${e.at}-${i}`}
                  direction="row"
                  spacing={1}
                  alignItems="center"
                >
                  <Typography variant="caption" color="text.secondary" sx={{ width: 60 }}>
                    {new Date(e.at).toLocaleTimeString("ja-JP", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </Typography>
                  <Typography
                    variant="body2"
                    noWrap
                    sx={{
                      flex: 1,
                      minWidth: 0,
                      textDecoration: e.undone ? "line-through" : "none",
                    }}
                  >
                    {e.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {e.undone ? "取消済み" : e.label}
                  </Typography>
                  {e.canUndo && !e.undone && (
                    <Link
                      component="button"
                      type="button"
                      variant="caption"
                      onClick={() => void undoAttend(e)}
                    >
                      取り消す
                    </Link>
                  )}
                </Stack>
              ))}
            </Stack>
          </CardContent>
        </Card>
      )}

      {/* jsQR フォールバック用の作業キャンバス（非表示） */}
      <canvas ref={canvasRef} style={{ display: "none" }} />
    </Stack>
  );
}

const OVERLAY_STYLE: Record<
  Exclude<PanelKind, "manual">,
  { bg: string; title: string }
> = {
  checked_in: { bg: "rgba(46,125,50,0.94)", title: "出席 記録済み（本人確認済み）" },
  manual_done: { bg: "rgba(46,125,50,0.94)", title: "出席 記録済み（手動）" },
  already: { bg: "rgba(2,136,209,0.94)", title: "出席済みです" },
  not_confirmed: {
    bg: "rgba(230,81,0,0.94)",
    title: "このイベントの確定参加者ではありません",
  },
  unknown_user: { bg: "rgba(97,97,97,0.94)", title: "登録されていないユーザーです" },
  expired: {
    bg: "rgba(230,81,0,0.94)",
    title: "QRの有効期限が切れています。参加者に画面を更新してもらってください",
  },
};

/** スキャン結果のオーバーレイ表示 */
function ResultOverlay({
  panel,
  onManualAttend,
  onCancelManual,
}: {
  panel: Panel;
  onManualAttend: (user: CheckinUser) => void;
  onCancelManual: () => void;
}) {
  const user = panel.user;
  const avatar = user && (
    <Avatar
      src={user.avatarUrl ?? undefined}
      alt={user.name}
      sx={{ width: 64, height: 64, fontSize: 28 }}
    >
      {user.name.charAt(0)}
    </Avatar>
  );

  if (panel.kind === "manual") {
    // プロフィールQR: 本人確認チケットではないので staff の判断で手動記録
    return (
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "center",
          bgcolor: "rgba(0,0,0,0.72)",
          p: 2,
        }}
      >
        <Card sx={{ width: "100%", maxWidth: 340 }}>
          <CardContent>
            <Stack spacing={1.5} alignItems="center">
              {avatar}
              <Typography fontWeight={700}>{user?.name}</Typography>
              <Alert severity="warning" icon={<WarningAmberIcon />} sx={{ width: "100%" }}>
                本人確認チケットではありません。本人確認のうえ手動で記録してください
              </Alert>
              <Stack direction="row" spacing={1}>
                <Button variant="outlined" onClick={onCancelManual}>
                  スキャンに戻る
                </Button>
                <Button
                  variant="contained"
                  color="inherit"
                  sx={{ bgcolor: "action.selected" }}
                  onClick={() => user && onManualAttend(user)}
                >
                  手動で出席にする
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      </Box>
    );
  }

  const style = OVERLAY_STYLE[panel.kind];
  const icon =
    panel.kind === "checked_in" || panel.kind === "manual_done" ? (
      <CheckCircleIcon sx={{ fontSize: 72 }} />
    ) : panel.kind === "already" ? (
      <InfoOutlinedIcon sx={{ fontSize: 64 }} />
    ) : (
      <WarningAmberIcon sx={{ fontSize: 64 }} />
    );

  return (
    <Box
      sx={{
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
        bgcolor: style.bg,
        color: "#fff",
        p: 2,
        textAlign: "center",
      }}
    >
      <Stack spacing={1.5} alignItems="center">
        {icon}
        {avatar}
        {user && (
          <Typography variant="h6" fontWeight={700}>
            {user.name}
          </Typography>
        )}
        <Typography fontWeight={700}>{style.title}</Typography>
      </Stack>
    </Box>
  );
}
