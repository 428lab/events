import { useEffect, useMemo } from "react";
import { Avatar, Box, Dialog, IconButton, Stack, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import QRCode from "qrcode";

/**
 * 自分のQRコードを画面いっぱいに表示するダイアログ (#324)。
 *
 * オフラインの交流で相手にスマホを向けて読み取ってもらう用途なので、
 * 読み取り成功率を最優先にする:
 * - 常に白背景・黒モジュール。ダークテーマでも反転させない
 * - 静穏帯（クワイエットゾーン）を規格どおり4モジュール取る
 * - スマホ縦持ちで画面の短辺いっぱいまで大きくする
 */

/** QRの飛び先は公開プロフィール。?ref=qr は流入元の集計用
 * （プロフィールカード内のQR=card と区別するため別の値。サーバー側の許可リストに登録済み） */
export function buildProfileQrUrl(handle: string, origin: string): string {
  return `${origin}/users/${encodeURIComponent(handle)}?ref=qr`;
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
  handle,
  name,
  avatarUrl,
}: {
  open: boolean;
  onClose: () => void;
  handle: string;
  name: string;
  avatarUrl?: string | null;
}) {
  useScreenWakeLock(open);
  const url = buildProfileQrUrl(handle, window.location.origin);

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
          data-qr-url={url}
          sx={{
            // 縦持ちのスマホで短辺いっぱい。周囲の余白も静穏帯として効く
            width: "min(92vw, 70vh)",
            height: "min(92vw, 70vh)",
            bgcolor: "#ffffff",
          }}
        >
          <QrCodeSvg url={url} label={`${name} のプロフィールのQRコード`} />
        </Box>
        <Stack direction="row" spacing={1.5} alignItems="center">
          {avatarUrl && <Avatar src={avatarUrl} sx={{ width: 40, height: 40 }} />}
          <Box>
            <Typography variant="h6" fontWeight={700} sx={{ color: "#000000" }}>
              {name}
            </Typography>
            <Typography variant="caption" sx={{ color: "#555555" }}>
              読み取ると交流を記録できます
            </Typography>
          </Box>
        </Stack>
      </Stack>
    </Dialog>
  );
}
