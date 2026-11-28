import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Avatar,
  Box,
  Button,
  CircularProgress,
  Dialog,
  IconButton,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import QRCode from "qrcode";
import { useMyMeetToken } from "../api/eventMeetHooks.js";
import { useQrScanner } from "../lib/useQrScanner.js";

/**
 * 自分のQRコードを画面いっぱいに表示するダイアログ (#324)。
 *
 * オフラインの交流で相手にスマホを向けて読み取ってもらう用途なので、
 * 読み取り成功率を最優先にする:
 * - 常に白背景・黒モジュール。ダークテーマでも反転させない
 * - 静穏帯（クワイエットゾーン）を規格どおり4モジュール取る
 * - スマホ縦持ちで画面の短辺いっぱいまで大きくする
 *
 * 飛び先は読み取ったその場で出会いを確定する専用の入口 (#330)。
 * 短時間で切り替わるトークンを載せるので、表示している間は自動で描き替える。
 *
 * 上部の切り替えで「読み取る」にすると、同じ画面で相手の出会いのQRを読める (#704)。
 * OSのカメラアプリ経由だと別ブラウザで開いてログインからやり直しになることがあるため。
 */

/** 読み取り確定用の入口URL。token は短時間で切り替わる */
export function buildMeetQrUrl(token: string, origin: string): string {
  return `${origin}/m/${encodeURIComponent(token)}`;
}

/** 静穏帯（規格上の最小4モジュール）。これを削ると読み取り率が落ちる */
const QUIET = 4;

/** QRコードを白地・黒モジュールのSVGで描く。生成は既存のカードと同じ qrcode を使う */
export function QrCodeSvg({ url, label }: { url: string; label: string }) {
  const qr = useMemo(() => {
    try {
      return QRCode.create(url, { errorCorrectionLevel: "M" });
    } catch {
      return null;
    }
  }, [url]);
  if (!qr) return null;

  const size = qr.modules.size;
  const data = qr.modules.data;
  const side = size + QUIET * 2;

  const rects: JSX.Element[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!data[r * size + c]) continue;
      rects.push(
        <rect
          key={`${r}-${c}`}
          x={QUIET + c}
          y={QUIET + r}
          width={1}
          height={1}
          fill="#000000"
        />,
      );
    }
  }

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${side} ${side}`}
      // 拡大時にモジュールの境界がぼやけないようにする
      shapeRendering="crispEdges"
      style={{ display: "block", width: "100%", height: "100%" }}
    >
      <rect x={0} y={0} width={side} height={side} fill="#ffffff" />
      {rects}
    </svg>
  );
}

type WakeLockSentinelLike = { release?: () => Promise<void> };
type WakeLockLike = { request: (type: "screen") => Promise<WakeLockSentinelLike> };

/** 表示中は画面を消さない。非対応の環境では何もしない（エラーも出さない） */
function useScreenWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const wakeLock = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
    if (!wakeLock) return;

    let sentinel: WakeLockSentinelLike | null = null;
    let stopped = false;
    const acquire = () => {
      wakeLock
        .request("screen")
        .then((s) => {
          if (stopped) {
            void s.release?.();
            return;
          }
          sentinel = s;
        })
        .catch(() => {
          /* 非対応・権限拒否・バックグラウンドなど。画面が消えるだけなので黙って諦める */
        });
    };
    // 一度バックグラウンドに回ると解除されるので、戻ってきたら取り直す
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") acquire();
    };

    acquire();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void sentinel?.release?.();
      sentinel = null;
    };
  }, [active]);
}

/** 読み取った文字列が出会いのQR（自分のオリジンの /m/<token>）ならトークンを返す */
export function parseMeetQrUrl(text: string, origin: string): string | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  const m = url.pathname.match(/^\/m\/([^/]+)$/);
  return m ? m[1] : null;
}

type QrMode = "show" | "scan";

/** 白い読み取り面の上でも読める切り替えの色。ダークテーマの文字色を引き継がない */
const TOGGLE_SX = {
  color: "#555555",
  borderColor: "rgba(0,0,0,0.23)",
  px: 2,
  "&.Mui-selected, &.Mui-selected:hover": {
    color: "#000000",
    bgcolor: "rgba(0,0,0,0.12)",
  },
} as const;

/** QRの読み取り面。カメラ映像を出し、出会いのQRを読んだら知らせる */
function MeetQrScanner({
  active,
  onMeet,
  onBackToShow,
  ignoreToken,
}: {
  active: boolean;
  onMeet: (token: string) => void;
  onBackToShow: () => void;
  /** このトークンは読んでも何もしない（直前に記録したQRの映り込み対策, #726） */
  ignoreToken?: string;
}) {
  const { t } = useTranslation();
  const [notMeet, setNotMeet] = useState(false);
  const lastRef = useRef({ text: "", at: 0 });
  const noticeTimerRef = useRef<number | undefined>(undefined);

  /** 3秒以内の同一QRは無視（連続発火防止。受付リーダーと同じ） */
  const handleDecode = useCallback(
    (text: string) => {
      const now = Date.now();
      if (lastRef.current.text === text && now - lastRef.current.at < 3000) {
        return;
      }
      lastRef.current = { text, at: now };
      const token = parseMeetQrUrl(text, window.location.origin);
      // 相手の画面が描き替わる前に同じQRが映り込んでも「使用済み」にしない
      if (token && token === ignoreToken) return;
      if (token) {
        onMeet(token);
        return;
      }
      setNotMeet(true);
      window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = window.setTimeout(() => setNotMeet(false), 2500);
    },
    [onMeet, ignoreToken],
  );

  const { videoRef, canvasRef, cameraError } = useQrScanner({
    enabled: active,
    onDecode: handleDecode,
  });

  useEffect(() => () => window.clearTimeout(noticeTimerRef.current), []);

  if (cameraError) {
    return (
      <Stack spacing={2} alignItems="center" sx={{ maxWidth: 360 }}>
        <Typography variant="body2" textAlign="center" sx={{ color: "#555555" }}>
          {t("profile.qrScanCameraError")}
        </Typography>
        <Button
          variant="outlined"
          onClick={onBackToShow}
          sx={{ color: "#000000", borderColor: "rgba(0,0,0,0.23)" }}
        >
          {t("profile.qrScanBackToShow")}
        </Button>
      </Stack>
    );
  }

  return (
    <>
      <Box
        sx={{
          // 見せるときのQR枠と同じ大きさ
          width: "min(92vw, 70vh, 100%)",
          height: "min(92vw, 70vh, 100%)",
          borderRadius: 2,
          overflow: "hidden",
          bgcolor: "#000000",
        }}
      >
        <Box
          component="video"
          ref={videoRef}
          playsInline
          muted
          aria-label={t("profile.qrScanLabel")}
          sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      </Box>
      <Typography
        variant="body2"
        role="status"
        sx={{ color: notMeet ? "#000000" : "#555555", fontWeight: notMeet ? 700 : 400 }}
      >
        {notMeet ? t("profile.qrScanNotMeet") : t("profile.qrScanHint")}
      </Typography>
      {/* jsQR フォールバック用の作業キャンバス（非表示） */}
      <canvas ref={canvasRef} style={{ display: "none" }} />
    </>
  );
}

export function BigQrDialog({
  open,
  onClose,
  name,
  avatarUrl,
  initialMode = "show",
  replaceOnMeet = false,
  ignoreToken,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  avatarUrl?: string | null;
  /** 開いたときのモード。出会いの結果画面からは「読み取る」で開く (#726) */
  initialMode?: QrMode;
  /** 読んだら履歴を積まずに /m/<token> へ移る（/m 同士を行き来する場合, #726） */
  replaceOnMeet?: boolean;
  /** 読んでも進まないトークン（直前に記録した相手のQR, #726） */
  ignoreToken?: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  useScreenWakeLock(open);
  // 開くたびに initialMode（既定は「見せる」）から始める (#704, #726)
  const [mode, setMode] = useState<QrMode>(initialMode);
  // 表示中のトークン。読まれるまでは同じものを出し続ける（読み取っている
  // 最中に切り替わると失敗し続けるため）。読まれたらサーバーが次のぶんを返す
  const [current, setCurrent] = useState<string | null>(null);
  // 読み取り中はトークンを取りに行かない
  const { data: meetToken, isError } = useMyMeetToken(open && mode === "show", current);
  // 「読み取られました」の一時表示。次の人に向け直す合図になる
  const [justRead, setJustRead] = useState(false);

  useEffect(() => {
    if (!meetToken) return;
    setCurrent(meetToken.token);
    if (meetToken.consumed) setJustRead(true);
  }, [meetToken]);

  // 合図を消すタイマーは合図の状態に結びつける (#420)。
  // 上の effect に同居させると、次の応答（新しいデータオブジェクト）が
  // 2.5秒以内に届いたとき cleanup がタイマーを消し、合図が出っぱなしになる
  useEffect(() => {
    if (!justRead) return;
    const timer = setTimeout(() => setJustRead(false), 2500);
    return () => clearTimeout(timer);
  }, [justRead]);

  // 閉じたら次に開いたときのために持ち越さない（古いQRを描かないため）
  useEffect(() => {
    if (!open) {
      setCurrent(null);
      setJustRead(false);
      setMode(initialMode);
    }
  }, [open, initialMode]);

  // 期限切れを描かないための時計。読み取る側だけが「期限切れ」を見て、
  // 見せている側は気づけない、という壊れ方を防ぐ (#330)。
  // 一度閉じて開き直した直後（キャッシュが残っている）と、
  // 電波が切れて取り直せていない間の両方がここで止まる
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open]);

  const fresh = meetToken && meetToken.expiresAt > now ? meetToken : null;
  const url = fresh ? buildMeetQrUrl(fresh.token, window.location.origin) : null;

  // 記録・取り消しは既存の入口（MeetScanPage）に任せる
  const onMeet = useCallback(
    (token: string) => {
      onClose();
      navigate(`/m/${token}`, { replace: replaceOnMeet });
    },
    [onClose, navigate, replaceOnMeet],
  );
  const backToShow = useCallback(() => setMode("show"), []);

  return (
    <Dialog
      fullScreen
      open={open}
      onClose={onClose}
      // 読み取り面は常に白。ダークテーマでも反転させない
      PaperProps={{ sx: { bgcolor: "#ffffff", color: "#000000" } }}
    >
      <IconButton
        onClick={onClose}
        aria-label={t("common.close")}
        sx={{ position: "absolute", top: 8, right: 8, color: "#000000" }}
      >
        <CloseIcon />
      </IconButton>
      {/* 閉じるボタン（右上）と重ならないよう左右に逃がして中央に置く */}
      <Box
        sx={{
          position: "absolute",
          top: 8,
          left: 0,
          right: 0,
          px: 7,
          display: "flex",
          justifyContent: "center",
          pointerEvents: "none",
        }}
      >
        <ToggleButtonGroup
          exclusive
          size="small"
          value={mode}
          onChange={(_, next: QrMode | null) => {
            if (next) setMode(next);
          }}
          aria-label={t("profile.qrModeLabel")}
          sx={{ pointerEvents: "auto" }}
        >
          <ToggleButton value="show" sx={TOGGLE_SX}>
            {t("profile.qrModeShow")}
          </ToggleButton>
          <ToggleButton value="scan" sx={TOGGLE_SX}>
            {t("profile.qrModeScan")}
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>
      <Stack
        spacing={2}
        alignItems="center"
        justifyContent="center"
        sx={{ height: "100%", p: 2 }}
      >
        {mode === "scan" ? (
          <MeetQrScanner
            active={open}
            onMeet={onMeet}
            onBackToShow={backToShow}
            ignoreToken={ignoreToken}
          />
        ) : (
          <>
            <Box
              data-testid="big-qr"
              data-qr-url={url ?? ""}
              sx={{
                // 縦持ちのスマホで短辺いっぱい。周囲の余白も静穏帯として効く。
                // 100% を混ぜて左右パディングぶんの横はみ出し（幅400px未満の端末）を防ぐ
                width: "min(92vw, 70vh, 100%)",
                height: "min(92vw, 70vh, 100%)",
                bgcolor: "#ffffff",
                display: "grid",
                placeItems: "center",
              }}
            >
              {url ? (
                <QrCodeSvg url={url} label={t("profile.qrLabel", { name })} />
              ) : isError ? (
                <Typography variant="body2" textAlign="center" sx={{ color: "#555555" }}>
                  {t("profile.qrError")}
                </Typography>
              ) : (
                <Stack spacing={1.5} alignItems="center">
                  <CircularProgress sx={{ color: "#555555" }} />
                  <Typography variant="body2" sx={{ color: "#555555" }}>
                    {t("profile.qrPreparing")}
                  </Typography>
                </Stack>
              )}
            </Box>
            <Stack direction="row" spacing={1.5} alignItems="center">
              {avatarUrl && <Avatar src={avatarUrl} sx={{ width: 40, height: 40 }} />}
              <Box>
                <Typography variant="h6" fontWeight={700} sx={{ color: "#000000" }}>
                  {name}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{ color: justRead ? "#1b5e20" : "#555555", fontWeight: justRead ? 700 : 400 }}
                >
                  {justRead ? t("profile.qrJustRead") : t("profile.qrHint")}
                </Typography>
              </Box>
            </Stack>
          </>
        )}
      </Stack>
    </Dialog>
  );
}
