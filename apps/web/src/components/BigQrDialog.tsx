import { useEffect, useMemo, useState } from "react";
import {
  Avatar,
  Box,
  CircularProgress,
  Dialog,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import QRCode from "qrcode";
import { useMyMeetToken } from "../api/eventMeetHooks.js";

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
 */

/** 読み取り確定用の入口URL。token は短時間で切り替わる */
export function buildMeetQrUrl(token: string, origin: string): string {
  return `${origin}/m/${encodeURIComponent(token)}`;
}

/** 静穏帯（規格上の最小4モジュール）。これを削ると読み取り率が落ちる */
const QUIET = 4;

/** QRコードを白地・黒モジュールのSVGで描く。生成は既存のカードと同じ qrcode を使う */
function QrCodeSvg({ url, label }: { url: string; label: string }) {
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

export function BigQrDialog({
  open,
  onClose,
  name,
  avatarUrl,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  avatarUrl?: string | null;
}) {
  useScreenWakeLock(open);
  // 表示中のトークン。読まれるまでは同じものを出し続ける（読み取っている
  // 最中に切り替わると失敗し続けるため）。読まれたらサーバーが次のぶんを返す
  const [current, setCurrent] = useState<string | null>(null);
  const { data: meetToken, isError } = useMyMeetToken(open, current);
  // 「読み取られました」の一時表示。次の人に向け直す合図になる
  const [justRead, setJustRead] = useState(false);

  useEffect(() => {
    if (!meetToken) return;
    setCurrent(meetToken.token);
    if (!meetToken.consumed) return;
    setJustRead(true);
    const timer = setTimeout(() => setJustRead(false), 2500);
    return () => clearTimeout(timer);
  }, [meetToken]);

  // 閉じたら次に開いたときのために持ち越さない（古いQRを描かないため）
  useEffect(() => {
    if (!open) {
      setCurrent(null);
      setJustRead(false);
    }
  }, [open]);

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
        aria-label="閉じる"
        sx={{ position: "absolute", top: 8, right: 8, color: "#000000" }}
      >
        <CloseIcon />
      </IconButton>
      <Stack
        spacing={2}
        alignItems="center"
        justifyContent="center"
        sx={{ height: "100%", p: 2 }}
      >
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
            <QrCodeSvg url={url} label={`${name} の交流用QRコード`} />
          ) : isError ? (
            <Typography variant="body2" textAlign="center" sx={{ color: "#555555" }}>
              QRを表示できませんでした。通信状況を確かめて、
              <br />
              閉じてもう一度お試しください
            </Typography>
          ) : (
            <Stack spacing={1.5} alignItems="center">
              <CircularProgress sx={{ color: "#555555" }} />
              <Typography variant="body2" sx={{ color: "#555555" }}>
                QRを準備しています…
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
              {justRead
                ? "読み取られました。次の人もどうぞ"
                : "読み取るとその場で交流が記録されます"}
            </Typography>
          </Box>
        </Stack>
      </Stack>
    </Dialog>
  );
}
