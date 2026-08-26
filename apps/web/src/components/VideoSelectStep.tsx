import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  DialogActions,
  DialogContent,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import {
  EVENT_VIDEO_MAX_BYTES,
  EVENT_VIDEO_MAX_DURATION_MS,
} from "@eventer/shared";
import {
  decideVideoPlan,
  defaultVideoTrim,
  needsVideoTrim,
  type VideoPlan,
  type VideoTrim,
} from "../lib/video/plan.js";
import {
  detectVideoCapability,
  probeVideoFile,
  type ProbedVideo,
} from "../lib/video/probe.js";
import { VideoTrimBar } from "./VideoTrimBar.js";
import { formatVideoDuration } from "./videoThumb.js";

/**
 * 動画投稿の第1段階: 範囲選択 (#427)。1本ぶんの
 * 解析（demux・能力実測）→ 経路判定 → トリム UI → 音声破棄の確認、までを行い、
 * **エンコードはしない**。確定した素材（demux 済みの probed・経路・範囲）を
 * onResult で親（VideoUploadFlow）へ返し、第2段階がそのまま使う
 * （同じ File を2回解析しない）。
 *
 * - 60秒超は必須でトリムを開く / 60秒以内は畳んだ任意項目（既定は全範囲）
 * - 素通し経路はトリム不可なので UI を出さずにそのまま確定する
 */

export type VideoSelectResult =
  | {
      kind: "ready";
      probed: ProbedVideo;
      plan: Exclude<VideoPlan, { kind: "reject" }>;
      trim: VideoTrim | null;
    }
  /** この1本をやめて次へ */
  | { kind: "skip" }
  /** この1本は受けられない（理由つき）。次へ進む */
  | { kind: "failed"; reason: string }
  /** キューごとやめる */
  | { kind: "cancelAll" };

type Phase = "probing" | "trim" | "confirmAudio" | "error";

export function VideoSelectStep({
  file,
  queue,
  onResult,
}: {
  file: File;
  /** 複数本のときの現在位置。単発は null */
  queue: { index: number; total: number } | null;
  onResult: (r: VideoSelectResult) => void;
}) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>("probing");
  const [error, setError] = useState<string | null>(null);
  const [trim, setTrim] = useState<VideoTrim | null>(null);
  const [trimTotalMs, setTrimTotalMs] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const ctxRef = useRef<{
    probed: ProbedVideo;
    support: Awaited<ReturnType<typeof detectVideoCapability>>;
  } | null>(null);
  const pendingRef = useRef<Extract<VideoSelectResult, { kind: "ready" }> | null>(
    null,
  );
  const startedRef = useRef(false);
  const doneRef = useRef(false);

  const maxSec = Math.round(EVENT_VIDEO_MAX_DURATION_MS / 1000);
  const maxMb = Math.round(EVENT_VIDEO_MAX_BYTES / 1024 / 1024);

  const finish = useCallback(
    (r: VideoSelectResult) => {
      if (doneRef.current) return;
      doneRef.current = true;
      onResult(r);
    },
    [onResult],
  );

  const failWith = useCallback((msg: string) => {
    setError(msg);
    setPhase("error");
  }, []);

  useEffect(() => {
    // StrictMode の二重実行を防ぐ（1ファイル1回のフロー）
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      try {
        const probed = await probeVideoFile(file);
        const support = await detectVideoCapability(
          probed.probe.width,
          probed.probe.height,
        );
        const totalMs = probed.probe.durationMs;
        if (!(totalMs > 0)) {
          // 長さが取れない入力はトリム UI が成立しない（枠の幅を算出できず、
          // 幅0の枠と空のプレビューという壊れた画面になる。iOS の複数選択で
          // 2本目のメタデータが読めないケースを実機で確認）。エラーに倒す
          return failWith(t("eventSocial.videoCannotProcess", { s: maxSec }));
        }
        const mustTrim = needsVideoTrim(totalMs);
        // 60秒超はトリム前提（既定: 先頭から60秒）で経路を判定する。
        // 変換経路に乗れなければ trim では救えない → too-long（編集の案内）
        const plan = decideVideoPlan(
          support,
          probed.probe,
          mustTrim ? defaultVideoTrim(totalMs) : null,
        );
        if (doneRef.current) return;
        if (plan.kind === "reject") {
          switch (plan.reason) {
            case "too-long":
              return failWith(t("eventSocial.videoTooLong", { s: maxSec }));
            case "too-large":
              return failWith(t("eventSocial.videoTooLarge", { mb: maxMb }));
            case "no-video-track":
              return failWith(t("eventSocial.videoNotVideo"));
            default:
              return failWith(
                t("eventSocial.videoCannotProcess", { s: maxSec }),
              );
          }
        }
        if (plan.kind === "passthrough") {
          // 素通しはトリム不可。選ぶものがないのでそのまま確定する
          finish({ kind: "ready", probed, plan, trim: null });
          return;
        }
        if (!mustTrim) {
          // 60秒以内はトリム不要 → 止まらず自動確定（全範囲）。
          // 「短い動画も任意でトリム」は落とした（元要望は60秒超のみで、
          // キューの全本で決定タップを要求する代償に見合わない）。
          // ただし音声を落とす経路だけは黙って進めない（確認を出す）
          const ready = { kind: "ready", probed, plan, trim: null } as const;
          if (plan.confirmDropAudio) {
            pendingRef.current = ready;
            setPhase("confirmAudio");
            return;
          }
          finish(ready);
          return;
        }
        ctxRef.current = { probed, support };
        setTrimTotalMs(totalMs);
        setTrim(defaultVideoTrim(totalMs));
        setPhase("trim");
      } catch {
        // demux 不能（壊れたファイル等）
        if (!doneRef.current) {
          failWith(t("eventSocial.videoCannotProcess", { s: maxSec }));
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // プレビュー用の URL。トリム段に入ったときだけ作り、離れたら破棄する
  useEffect(() => {
    if (phase !== "trim") return;
    if (typeof URL.createObjectURL !== "function") return; // テスト環境(jsdom)
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => {
      setPreviewUrl(null);
      if (typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase === "trim"]);

  /** トリム段の決定。全範囲のままなら trim なし扱いにして
   * 無変換コピー等の最適化を妨げない */
  const confirmTrim = () => {
    const ctx = ctxRef.current;
    if (!ctx || !trim) return;
    const totalMs = ctx.probed.probe.durationMs;
    const effective = trim.startMs === 0 && trim.endMs === totalMs ? null : trim;
    const plan = decideVideoPlan(ctx.support, ctx.probed.probe, effective);
    if (plan.kind !== "encode") {
      // トリム段に入れたのは変換経路だけなので、ここには来ないはずの防御
      failWith(t("eventSocial.videoCannotProcess", { s: maxSec }));
      return;
    }
    const ready = {
      kind: "ready",
      probed: ctx.probed,
      plan,
      trim: effective,
    } as const;
    if (plan.confirmDropAudio) {
      // 音声を落とすことを確認してから確定する（勝手に無音で投稿しない）
      pendingRef.current = ready;
      setPhase("confirmAudio");
      return;
    }
    finish(ready);
  };

  /** トリム操作に合わせてプレビューを動かす（動いた側の端に頭出し） */
  const handleTrimChange = (next: VideoTrim) => {
    const video = previewRef.current;
    if (video && trim) {
      const seekMs = next.endMs !== trim.endMs ? next.endMs : next.startMs;
      try {
        video.currentTime = seekMs / 1000;
      } catch {
        // メタデータ未読込などで失敗しても選択自体は続けられる
      }
    }
    setTrim(next);
  };

  const skipLabel =
    queue && queue.total > 1
      ? t("eventSocial.videoQueueSkipOne")
      : t("common.cancel");

  return (
    <>
      <DialogContent>
        {queue && queue.total > 1 && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mb: 1 }}
          >
            {t("eventSocial.videoQueueProgress", {
              m: queue.index,
              n: queue.total,
            })}
          </Typography>
        )}
        {phase === "probing" && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <CircularProgress size={20} />
            <Typography>{t("eventSocial.videoPreparing")}</Typography>
          </Box>
        )}
        {phase === "trim" && trim && (
          <Box>
            <Typography sx={{ mb: 1 }}>
              {t("eventSocial.videoTrimIntro", { s: maxSec })}
            </Typography>
            <Box>
              {previewUrl && (
                <Box
                  component="video"
                  ref={previewRef}
                  src={previewUrl}
                  controls
                  playsInline
                  preload="metadata"
                  sx={{
                    display: "block",
                    width: "100%",
                    maxHeight: 240,
                    bgcolor: "#000",
                    borderRadius: 1,
                  }}
                />
              )}
              <VideoTrimBar
                totalMs={trimTotalMs}
                value={trim}
                onChange={handleTrimChange}
              />
              <Typography variant="body2" color="text.secondary">
                {t("eventSocial.videoTrimRange", {
                  from: formatVideoDuration(trim.startMs),
                  to: formatVideoDuration(trim.endMs),
                  len: formatVideoDuration(trim.endMs - trim.startMs),
                })}
              </Typography>
            </Box>
          </Box>
        )}
        {phase === "confirmAudio" && (
          <Typography>{t("eventSocial.videoDropAudioConfirm")}</Typography>
        )}
        {phase === "error" && error && <Alert severity="warning">{error}</Alert>}
      </DialogContent>
      {/* スマホ幅ではボタン3つが1行に収まらないため折り返す (#427 実機崩れ)。
          MUI 既定の隣接マージンは折り返し行に効かないので gap で間隔を取る */}
      <DialogActions sx={{ flexWrap: "wrap", gap: 1, "& > :not(:first-of-type)": { ml: 0 } }}>
        {phase === "trim" && (
          <Button variant="contained" onClick={confirmTrim}>
            {t("eventSocial.videoTrimConfirm")}
          </Button>
        )}
        {phase === "confirmAudio" && (
          <Button
            variant="contained"
            onClick={() => {
              const pending = pendingRef.current;
              pendingRef.current = null;
              if (pending) finish(pending);
            }}
          >
            {t("eventSocial.videoDropAudioPost")}
          </Button>
        )}
        {queue && queue.total > 1 && phase !== "error" && (
          <Button onClick={() => finish({ kind: "cancelAll" })}>
            {t("eventSocial.videoQueueCancelAll")}
          </Button>
        )}
        {phase === "error" ? (
          <Button
            onClick={() =>
              finish({ kind: "failed", reason: error ?? "unknown" })
            }
          >
            {t("common.close")}
          </Button>
        ) : (
          <Button onClick={() => finish({ kind: "skip" })}>{skipLabel}</Button>
        )}
      </DialogActions>
    </>
  );
}
