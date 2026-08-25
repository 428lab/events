import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
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
import { decideVideoPlan, type VideoPlan } from "../lib/video/plan.js";
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
 */

type Phase =
  | "probing"
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
  const pendingRef = useRef<{ probed: ProbedVideo; plan: EncodePlan } | null>(null);
  const handleRef = useRef<VideoEncoder408Handle | null>(null);
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
      try {
        await upload.mutateAsync({
          video: prepared.blob,
          mime: prepared.mime,
          poster: prepared.poster,
          durationMs: prepared.durationMs,
          onProgress: (f) => setProgress(0.7 + 0.3 * f),
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
    async (probed: ProbedVideo, plan: Exclude<VideoPlan, { kind: "reject" }>) => {
      try {
        let prepared: Prepared;
        if (plan.kind === "passthrough") {
          // 変換できない環境の原本受け入れ。ポスターも切り出せなければ null
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
            poster: await extractVideoPoster(probed),
            durationMs: probed.probe.durationMs,
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
        const plan = decideVideoPlan(support, probed.probe);
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
        if (plan.kind === "encode" && plan.confirmDropAudio) {
          // 音声を落とすことを確認してから進む（勝手に無音で投稿しない）
          pendingRef.current = { probed, plan };
          setPhase("confirmAudio");
          return;
        }
        await runFrom(probed, plan);
      } catch {
        // demux 不能（壊れたファイル等）
        if (!closedRef.current) {
          failWith(t("eventSocial.videoCannotProcess", { s: maxSec }));
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCancel = () => {
    closedRef.current = true;
    void handleRef.current?.cancel();
    onClose();
  };

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
        {phase === "confirmAudio" && (
          <Button
            variant="contained"
            onClick={() => {
              const pending = pendingRef.current;
              pendingRef.current = null;
              if (pending) void runFrom(pending.probed, pending.plan);
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
