import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  LinearProgress,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import {
  EVENT_PHOTO_LIMIT,
  EVENT_VIDEO_MAX_BYTES,
  EVENT_VIDEO_MAX_DURATION_MS,
} from "@eventer/shared";
import { useUploadEventVideo } from "../api/eventPhotoHooks.js";
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
import {
  createVideoConversion,
  type EncodePlan,
  type VideoEncoder408Handle,
} from "../lib/video/encode.js";
import { extractVideoPoster } from "../lib/video/poster.js";
import { VideoTrimBar } from "./VideoTrimBar.js";
import { formatVideoDuration } from "./videoThumb.js";

/**
 * 動画の投稿フロー (#408)。ファイル選択後に開き、
 * 変換（WebCodecs。経路は decideVideoPlan の自動判定のみ）→ ポスター切り出し
 * → アップロード、を進捗つきで実行する。
 *
 * - 進捗は変換を 0–70%、アップロードを 70–100% に割り付ける（変換は
 *   分オーダーになり得るため割合表示は必須）
 * - サーバーに中間状態を作らない（multipart 1リクエスト）ので、失敗＝何も
 *   残らない。ただし変換済み Blob はダイアログを閉じるまで保持し、
 *   アップロードだけの失敗（電波切れ等）は再変換なしで再送できる
 * - トリム (#425): 変換（エンコード）経路では投稿前に範囲選択の段を挟む。
 *   60秒超は必須で開き、60秒以内は畳んだ任意項目。切り出しは変換でしか
 *   できないため、素通し経路では出さない（60秒超×素通しは編集を案内して不可）
 */

type Phase =
  | "probing"
  | "trim"
  | "confirmAudio"
  | "encoding"
  | "uploading"
  | "error"
  | "uploadError";

interface Prepared {
  blob: Blob;
  mime: string;
  poster: Blob | null;
  durationMs: number;
}

export function VideoUploadDialog({
  eventId,
  file,
  onClose,
}: {
  eventId: string;
  file: File;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const upload = useUploadEventVideo(eventId);
  const [phase, setPhase] = useState<Phase>("probing");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const preparedRef = useRef<Prepared | null>(null);
  const pendingRef = useRef<{
    probed: ProbedVideo;
    plan: EncodePlan;
    trim: VideoTrim | null;
  } | null>(null);
  /** トリム段の状態 (#425)。ctx はトリム確定時に再判定へ渡す素材 */
  const trimCtxRef = useRef<{
    probed: ProbedVideo;
    support: Awaited<ReturnType<typeof detectVideoCapability>>;
  } | null>(null);
  const [trim, setTrim] = useState<VideoTrim | null>(null);
  const [trimTotalMs, setTrimTotalMs] = useState(0);
  const [trimOpen, setTrimOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const handleRef = useRef<VideoEncoder408Handle | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startedRef = useRef(false);
  const closedRef = useRef(false);

  const maxSec = Math.round(EVENT_VIDEO_MAX_DURATION_MS / 1000);
  const maxMb = Math.round(EVENT_VIDEO_MAX_BYTES / 1024 / 1024);

  const failWith = useCallback((msg: string) => {
    setError(msg);
    setPhase("error");
  }, []);

  const doUpload = useCallback(
    async (prepared: Prepared) => {
      setPhase("uploading");
      setProgress(0.7);
      // キャンセルで XHR ごと中断できるようにする（閉じるだけだと
      // 裏で送信が完走して、キャンセルしたはずの動画が投稿されてしまう）
      const abort = new AbortController();
      abortRef.current = abort;
      try {
        await upload.mutateAsync({
          video: prepared.blob,
          mime: prepared.mime,
          poster: prepared.poster,
          durationMs: prepared.durationMs,
          onProgress: (f) => setProgress(0.7 + 0.3 * f),
          signal: abort.signal,
        });
        onClose();
      } catch (e) {
        if (closedRef.current) return;
        if (e instanceof Error && e.message === "photo_limit") {
          failWith(t("eventSocial.photoLimit", { n: EVENT_PHOTO_LIMIT }));
        } else {
          // 変換済みデータは保持しているので再送できる
          setPhase("uploadError");
        }
      }
    },
    [upload, onClose, failWith, t],
  );

  const runFrom = useCallback(
    async (
      probed: ProbedVideo,
      plan: Exclude<VideoPlan, { kind: "reject" }>,
      trimRange: VideoTrim | null,
    ) => {
      try {
        let prepared: Prepared;
        if (plan.kind === "passthrough") {
          // 変換できない環境の原本受け入れ。ポスターも切り出せなければ null。
          // トリムは変換でしか実現できないので、この経路に trim は来ない
          prepared = {
            blob: file,
            mime: plan.mime,
            poster: await extractVideoPoster(probed),
            durationMs: probed.probe.durationMs,
          };
        } else {
          setPhase("encoding");
          const handle = await createVideoConversion(probed, plan, {
            onProgress: (p) => setProgress(0.7 * p),
            trim: trimRange,
          });
          handleRef.current = handle;
          if (handle.invalidReason) {
            failWith(t("eventSocial.videoCannotProcess", { s: maxSec }));
            return;
          }
          const out = await handle.execute();
          prepared = {
            blob: out.blob,
            mime: out.mime,
            // ポスターも選んだ範囲の中から切り出す
            poster: await extractVideoPoster(probed, trimRange),
            durationMs: trimRange
              ? trimRange.endMs - trimRange.startMs
              : probed.probe.durationMs,
          };
        }
        if (closedRef.current) return;
        preparedRef.current = prepared;
        await doUpload(prepared);
      } catch (e) {
        if (closedRef.current) return;
        if (e instanceof Error && e.message === "video_output_too_large") {
          failWith(t("eventSocial.videoTooLarge", { mb: maxMb }));
        } else {
          failWith(t("eventSocial.videoCannotProcess", { s: maxSec }));
        }
      }
    },
    [file, doUpload, failWith, t, maxSec, maxMb],
  );

  useEffect(() => {
    // StrictMode の二重実行と props 変化での再実行を防ぐ（1ファイル1回のフロー）
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
        const mustTrim = needsVideoTrim(totalMs);
        // 60秒超はトリム前提（既定: 先頭から60秒）で経路を判定する。
        // 変換経路に乗れなければ trim では救えない → too-long（編集の案内）
        const plan = decideVideoPlan(
          support,
          probed.probe,
          mustTrim ? defaultVideoTrim(totalMs) : null,
        );
        if (closedRef.current) return;
        if (plan.kind === "reject") {
          switch (plan.reason) {
            case "too-long":
              return failWith(t("eventSocial.videoTooLong", { s: maxSec }));
            case "too-large":
              return failWith(t("eventSocial.videoTooLarge", { mb: maxMb }));
            case "no-video-track":
              return failWith(t("eventSocial.videoNotVideo"));
            default:
              return failWith(t("eventSocial.videoCannotProcess", { s: maxSec }));
          }
        }
        if (plan.kind === "passthrough") {
          // 素通しはトリム不可（60秒以内のときだけここに来る）。従来どおり即投稿
          await runFrom(probed, plan, null);
          return;
        }
        // 変換経路: トリム段を挟む。60秒超は必須で開き、以内は畳んだ任意項目
        trimCtxRef.current = { probed, support };
        setTrimTotalMs(totalMs);
        setTrim(defaultVideoTrim(totalMs));
        setTrimOpen(mustTrim);
        setPhase("trim");
      } catch {
        // demux 不能（壊れたファイル等）
        if (!closedRef.current) {
          failWith(t("eventSocial.videoCannotProcess", { s: maxSec }));
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** トリム段の「この範囲で投稿」。全範囲のままなら trim なし扱いにして
   * 無変換コピー等の最適化を妨げない */
  const confirmTrim = () => {
    const ctx = trimCtxRef.current;
    if (!ctx || !trim) return;
    const totalMs = ctx.probed.probe.durationMs;
    const effective =
      trim.startMs === 0 && trim.endMs === totalMs ? null : trim;
    const plan = decideVideoPlan(ctx.support, ctx.probed.probe, effective);
    if (plan.kind !== "encode") {
      // トリム段に入れたのは変換経路だけなので、ここには来ないはずの防御
      failWith(t("eventSocial.videoCannotProcess", { s: maxSec }));
      return;
    }
    if (plan.confirmDropAudio) {
      // 音声を落とすことを確認してから進む（勝手に無音で投稿しない）
      pendingRef.current = { probed: ctx.probed, plan, trim: effective };
      setPhase("confirmAudio");
      return;
    }
    void runFrom(ctx.probed, plan, effective);
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

  const handleCancel = () => {
    closedRef.current = true;
    void handleRef.current?.cancel();
    abortRef.current?.abort();
    onClose();
  };

  // プレビュー用の URL。トリム段に入ったときだけ作り、閉じたら破棄する
  useEffect(() => {
    if (phase !== "trim") return;
    if (typeof URL.createObjectURL !== "function") return; // テスト環境(jsdom)
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => {
      setPreviewUrl(null);
      URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase === "trim"]);

  const percent = Math.round(progress * 100);

  return (
    <Dialog open onClose={handleCancel} maxWidth="xs" fullWidth>
      <DialogContent>
        {phase === "probing" && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <CircularProgress size={20} />
            <Typography>{t("eventSocial.videoPreparing")}</Typography>
          </Box>
        )}
        {phase === "trim" && trim && (
          <Box>
            {needsVideoTrim(trimTotalMs) ? (
              <Typography sx={{ mb: 1 }}>
                {t("eventSocial.videoTrimIntro", { s: maxSec })}
              </Typography>
            ) : (
              <Button size="small" onClick={() => setTrimOpen((o) => !o)}>
                {t("eventSocial.videoTrimToggle")}
              </Button>
            )}
            <Collapse in={trimOpen}>
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
            </Collapse>
          </Box>
        )}
        {phase === "confirmAudio" && (
          <Typography>{t("eventSocial.videoDropAudioConfirm")}</Typography>
        )}
        {(phase === "encoding" || phase === "uploading") && (
          <Box>
            <Typography sx={{ mb: 1 }}>
              {phase === "encoding"
                ? t("eventSocial.videoEncoding", { p: percent })
                : t("eventSocial.videoUploading", { p: percent })}
            </Typography>
            <LinearProgress variant="determinate" value={percent} />
          </Box>
        )}
        {phase === "error" && error && <Alert severity="warning">{error}</Alert>}
        {phase === "uploadError" && (
          <Alert severity="warning">{t("eventSocial.videoUploadFailed")}</Alert>
        )}
      </DialogContent>
      <DialogActions>
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
              if (pending) void runFrom(pending.probed, pending.plan, pending.trim);
            }}
          >
            {t("eventSocial.videoDropAudioPost")}
          </Button>
        )}
        {phase === "uploadError" && (
          <Button
            variant="contained"
            onClick={() => {
              const prepared = preparedRef.current;
              if (prepared) void doUpload(prepared);
            }}
          >
            {t("eventSocial.videoRetryUpload")}
          </Button>
        )}
        <Button onClick={handleCancel}>
          {phase === "error" ? t("common.close") : t("common.cancel")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
