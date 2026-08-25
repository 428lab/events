import { Box, Stack, Typography } from "@mui/material";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import type { MediaKind } from "@eventer/shared";

/**
 * 写真/動画混在グリッドの共通部品 (#408)。
 *
 * サムネイルは写真なら画像本体、動画ならポスター画像を出す。URL の組み立てと
 * 再生アイコン・長さバッジのオーバーレイをここに集約し、イベントギャラリー・
 * メディアタブ・年表で二重に書かないようにする。
 * ポスターなし動画は <img> の onError で画像を消し、下地（グレー地＋再生
 * アイコン）がそのままプレースホルダになる。
 */

export const eventMediaImageUrl = (eventId: string, id: string) =>
  `/api/events/${eventId}/photos/${id}/image`;
export const eventMediaVideoUrl = (eventId: string, id: string) =>
  `/api/events/${eventId}/photos/${id}/video`;
export const eventMediaPosterUrl = (eventId: string, id: string) =>
  `/api/events/${eventId}/photos/${id}/poster`;

/** グリッドのサムネイルに使う画像 URL（動画はポスター） */
export const eventMediaThumbUrl = (
  eventId: string,
  id: string,
  kind: MediaKind,
) =>
  kind === "video"
    ? eventMediaPosterUrl(eventId, id)
    : eventMediaImageUrl(eventId, id);

/** 0:42 形式の長さ表示 */
export function formatVideoDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** 動画サムネイルに重ねる再生アイコンと長さバッジ。
 * 親要素は position: relative であること */
export function VideoThumbOverlay({
  durationMs,
  small = false,
}: {
  durationMs: number | null;
  /** 年表の 36px サムネのような小さい枠では長さバッジを出さない */
  small?: boolean;
}) {
  return (
    <>
      <Box
        data-testid="video-play-overlay"
        sx={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "center",
          pointerEvents: "none",
        }}
      >
        <Box
          sx={{
            width: small ? 18 : 34,
            height: small ? 18 : 34,
            borderRadius: "50%",
            bgcolor: "rgba(0,0,0,0.55)",
            display: "grid",
            placeItems: "center",
            color: "#fff",
          }}
        >
          <PlayArrowRoundedIcon sx={{ fontSize: small ? 14 : 24 }} />
        </Box>
      </Box>
      {!small && durationMs !== null && (
        <Stack
          direction="row"
          sx={{
            position: "absolute",
            right: 2,
            bottom: 2,
            px: 0.5,
            borderRadius: 1,
            bgcolor: "rgba(0,0,0,0.6)",
            pointerEvents: "none",
          }}
        >
          <Typography sx={{ fontSize: 11, lineHeight: 1.6, color: "#fff" }}>
            {formatVideoDuration(durationMs)}
          </Typography>
        </Stack>
      )}
    </>
  );
}
