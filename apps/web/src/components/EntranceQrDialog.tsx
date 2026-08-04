import { useEffect, useState } from "react";
import {
  Alert,
  Avatar,
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
import type { User } from "@eventer/shared";
import { useMyTicket } from "../api/checkinHooks.js";

/**
 * 入場QRダイアログ (#154)。
 * 署名付き・短寿命（3分）のチケットを QR にして受付スタッフに見せる。
 * プロフィールURLのQRと違い、アカウントを開いている本人しか出せないので
 * スクリーンショットの使い回しでのなりすましができない。
 * チケットは60秒ごとに自動更新され、QR も追従する。
 */
export function EntranceQrDialog({
  eventId,
  user,
  open,
  onClose,
}: {
  eventId: string;
  user: User;
  open: boolean;
  onClose: () => void;
}) {
  const { data: ticket, isError } = useMyTicket(eventId, open);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // qrcode ライブラリはライセンスカードと同じ遅延チャンクに置く（メインバンドルに入れない）
  useEffect(() => {
    if (!ticket) return;
    let cancelled = false;
    void import("qrcode").then(async (m) => {
      const url = await m.default.toDataURL(ticket.token, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 640,
      });
      if (!cancelled) setQrUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [ticket]);

  // 残り時間のさりげない表示用に1秒ごと更新
  useEffect(() => {
    if (!open) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [open]);

  const remainSec = ticket
    ? Math.max(0, Math.floor((ticket.expiresAt - now) / 1000))
    : null;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>入場QR</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} alignItems="center">
          {/* 画面の QR が本人のものか受付が目視確認できるよう、アバターと名前も出す */}
          <Stack direction="row" spacing={1} alignItems="center">
            <Avatar
              src={user.avatarUrl ?? undefined}
              alt={user.globalName ?? user.username}
              sx={{ width: 32, height: 32 }}
            >
              {(user.globalName ?? user.username).charAt(0)}
            </Avatar>
            <Typography fontWeight={700}>
              {user.globalName ?? user.username}
            </Typography>
          </Stack>
          {isError ? (
            <Alert severity="warning">
              入場QRを取得できませんでした。参加が確定しているか確認してください。
            </Alert>
          ) : (
            <Box
              sx={{
                bgcolor: "#fff",
                p: 2,
                borderRadius: 2,
                display: "grid",
                placeItems: "center",
                width: "min(80vw, 320px)",
                aspectRatio: "1 / 1",
              }}
            >
              {qrUrl ? (
                <Box
                  component="img"
                  src={qrUrl}
                  alt="入場QRコード"
                  sx={{ width: "100%", height: "100%", display: "block" }}
                />
              ) : (
                <CircularProgress />
              )}
            </Box>
          )}
          <Typography variant="body2" align="center">
            受付でスタッフに読み取ってもらってください
          </Typography>
          {remainSec !== null && (
            <Typography variant="caption" color="text.secondary" align="center">
              QRコードは自動的に更新されます（有効期限 残り
              {` ${Math.floor(remainSec / 60)}:${String(remainSec % 60).padStart(2, "0")}`}）
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>閉じる</Button>
      </DialogActions>
    </Dialog>
  );
}
