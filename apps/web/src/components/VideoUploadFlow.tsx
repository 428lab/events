import { useCallback, useRef, useState } from "react";
import {
  Button,
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
import type { VideoPlan, VideoTrim } from "../lib/video/plan.js";
import type { ProbedVideo } from "../lib/video/probe.js";
import {
  createVideoConversion,
  type VideoEncoder408Handle,
} from "../lib/video/encode.js";
import { extractVideoPoster } from "../lib/video/poster.js";
import { VideoSelectStep, type VideoSelectResult } from "./VideoSelectStep.js";

/**
 * 動画投稿のフロー全体 (#408, #427)。2段階で進める:
 *
 * 1. **範囲選択**（VideoSelectStep を1本ずつ）— 全本のトリム範囲を先に確定する。
 *    エンコードはまだしない。ここのキャンセルは「この本をやめて次へ」と
 *    「すべてキャンセル」
 * 2. **処理**（このコンポーネント）— 確定した本を1本ずつ順に
 *    エンコード→アップロード（並行しない）。利用者の操作は不要で放置できる。
 *    「この動画を中止（次へ進む）」「すべてキャンセル」だけ置く
 *
 * 第1段階で demux 済みの probed（mediabunny の Input）を第2段階がそのまま使い、
 * 同じ File を2回解析しない。キューは永続化しない（タブを閉じたら消える。
 * 40MB×複数本の中間データを保存する価値がなく、やり直しで足りる）。
 * 50枠切れ（photo_limit）が出たら以降も同じ結果になるので残りを中止する。
 */

interface ReadyItem {
  file: File;
  probed: ProbedVideo;
  plan: Exclude<VideoPlan, { kind: "reject" }>;
  trim: VideoTrim | null;
}

interface FileResult {
  name: string;
  status: "uploaded" | "failed" | "canceled";
  reason?: string;
  /** 範囲選択の段で失敗したか（その場でエラー表示済み。単発ではまとめを出さない） */
  atSelect?: boolean;
}

type Stage = "select" | "process" | "summary";

export function VideoUploadFlow({
  eventId,
  files,
  onClose,
}: {
  eventId: string;
  files: File[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const upload = useUploadEventVideo(eventId);
  const [stage, setStage] = useState<Stage>("select");
  const [selIndex, setSelIndex] = useState(0);
  const [current, setCurrent] = useState({ num: 1, total: 1, uploading: false });
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<FileResult[]>([]);
  const readyRef = useRef<ReadyItem[]>([]);
  const resultsRef = useRef<FileResult[]>([]);
  const handleRef = useRef<VideoEncoder408Handle | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cancelCurrentRef = useRef(false);
  const stopAllRef = useRef(false);
  const processingRef = useRef(false);

  const maxSec = Math.round(EVENT_VIDEO_MAX_DURATION_MS / 1000);
  const maxMb = Math.round(EVENT_VIDEO_MAX_BYTES / 1024 / 1024);
  const multi = files.length > 1;

  /** 全部終わった。失敗があればまとめを見せてから閉じる（成功だけなら
   * ギャラリーに反映されるのが見えるので黙って閉じる）。範囲選択の段で
   * 失敗した単発はその場でエラーを見せているので、まとめを重ねない */
  const finalize = useCallback(() => {
    const results = resultsRef.current;
    const failed = results.filter((r) => r.status === "failed");
    const showSummary =
      failed.some((r) => !r.atSelect) || (failed.length > 0 && multi);
    if (showSummary) {
      setSummary(results);
      setStage("summary");
    } else {
      onClose();
    }
  }, [multi, onClose]);

  /** 第2段階: 1本ずつ順にエンコード→アップロード */
  const processAll = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    const items = readyRef.current;
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      if (stopAllRef.current) {
        resultsRef.current.push({ name: item.file.name, status: "canceled" });
        continue;
      }
      cancelCurrentRef.current = false;
      setCurrent({ num: i + 1, total: items.length, uploading: false });
      setProgress(0);
      try {
        let blob: Blob;
        let mime: string;
        let durationMs: number;
        if (item.plan.kind === "passthrough") {
          blob = item.file;
          mime = item.plan.mime;
          durationMs = item.probed.probe.durationMs;
        } else {
          const handle = await createVideoConversion(item.probed, item.plan, {
            onProgress: (p) => setProgress(0.7 * p),
            trim: item.trim,
          });
          handleRef.current = handle;
          if (handle.invalidReason) throw new Error("cannot_process");
          const out = await handle.execute();
          blob = out.blob;
          mime = out.mime;
          durationMs = item.trim
            ? item.trim.endMs - item.trim.startMs
            : item.probed.probe.durationMs;
        }
        // ポスターは選んだ範囲の中から切り出す
        const poster = await extractVideoPoster(item.probed, item.trim);
        setCurrent({ num: i + 1, total: items.length, uploading: true });
        setProgress(0.7);
        const abort = new AbortController();
        abortRef.current = abort;
        await upload.mutateAsync({
          video: blob,
          mime,
          poster,
          durationMs,
          onProgress: (f) => setProgress(0.7 + 0.3 * f),
          signal: abort.signal,
        });
        resultsRef.current.push({ name: item.file.name, status: "uploaded" });
      } catch (e) {
        if (cancelCurrentRef.current || stopAllRef.current) {
          resultsRef.current.push({ name: item.file.name, status: "canceled" });
          continue;
        }
        const message = e instanceof Error ? e.message : String(e);
        const reason =
          message === "photo_limit"
            ? t("eventSocial.photoLimit", { n: EVENT_PHOTO_LIMIT })
            : message === "video_output_too_large"
              ? t("eventSocial.videoTooLarge", { mb: maxMb })
              : message === "network_error"
                ? t("eventSocial.videoUploadFailed")
                : t("eventSocial.videoCannotProcess", { s: maxSec });
        resultsRef.current.push({
          name: item.file.name,
          status: "failed",
          reason,
        });
        if (message === "photo_limit") {
          // 50枠切れ: 以降も同じ結果になるので残りを中止する
          for (const rest of items.slice(i + 1)) {
            resultsRef.current.push({ name: rest.file.name, status: "canceled" });
          }
          break;
        }
      } finally {
        handleRef.current = null;
        abortRef.current = null;
      }
    }
    finalize();
  }, [upload, t, maxSec, maxMb, finalize]);

  /** 第1段階の1本ぶんの結果を受けて次へ */
  const handleSelectResult = (r: VideoSelectResult) => {
    const file = files[selIndex]!;
    if (r.kind === "ready") {
      readyRef.current.push({
        file,
        probed: r.probed,
        plan: r.plan,
        trim: r.trim,
      });
    } else if (r.kind === "skip") {
      resultsRef.current.push({ name: file.name, status: "canceled" });
    } else if (r.kind === "failed") {
      resultsRef.current.push({
        name: file.name,
        status: "failed",
        reason: r.reason,
        atSelect: true,
      });
    } else {
      // cancelAll: 残りは選択もしない
      for (const rest of files.slice(selIndex)) {
        resultsRef.current.push({ name: rest.name, status: "canceled" });
      }
      onClose();
      return;
    }
    const next = selIndex + 1;
    if (next < files.length) {
      setSelIndex(next);
      return;
    }
    // 全本の範囲が確定した → 第2段階へ
    if (readyRef.current.length === 0) {
      finalize();
      return;
    }
    setStage("process");
    void processAll();
  };

  const cancelCurrent = () => {
    cancelCurrentRef.current = true;
    void handleRef.current?.cancel();
    abortRef.current?.abort();
  };
  const cancelAllProcessing = () => {
    stopAllRef.current = true;
    void handleRef.current?.cancel();
    abortRef.current?.abort();
  };

  const percent = Math.round(progress * 100);
  const uploadedCount = summary.filter((r) => r.status === "uploaded").length;
  const failedCount = summary.filter((r) => r.status === "failed").length;

  return (
    <Dialog
      open
      // 途中の誤クリックでキューを失わないよう、背景クリック/Esc では閉じない
      // （閉じる操作はボタンに限定）
      onClose={() => {}}
      maxWidth="xs"
      fullWidth
    >
      {stage === "select" && files[selIndex] && (
        <VideoSelectStep
          key={selIndex}
          file={files[selIndex]}
          queue={multi ? { index: selIndex + 1, total: files.length } : null}
          onResult={handleSelectResult}
        />
      )}
      {stage === "process" && (
        <>
          <DialogContent>
            {multi && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", mb: 1 }}
              >
                {t("eventSocial.videoQueueProgress", {
                  m: current.num,
                  n: current.total,
                })}
              </Typography>
            )}
            <Typography sx={{ mb: 1 }}>
              {current.uploading
                ? t("eventSocial.videoUploading", { p: percent })
                : t("eventSocial.videoEncoding", { p: percent })}
            </Typography>
            <LinearProgress variant="determinate" value={percent} />
          </DialogContent>
          {/* 第1段階と同じ構造なので、こちらも折り返し可能にしておく */}
          <DialogActions sx={{ flexWrap: "wrap", gap: 1, "& > :not(:first-of-type)": { ml: 0 } }}>
            {multi && (
              <Button onClick={cancelCurrent}>
                {t("eventSocial.videoQueueStopOne")}
              </Button>
            )}
            <Button onClick={cancelAllProcessing}>
              {multi
                ? t("eventSocial.videoQueueCancelAll")
                : t("common.cancel")}
            </Button>
          </DialogActions>
        </>
      )}
      {stage === "summary" && (
        <>
          <DialogContent>
            <Typography sx={{ mb: 1 }}>
              {t("eventSocial.videoQueueSummary", {
                ok: uploadedCount,
                ng: failedCount,
              })}
            </Typography>
            {summary
              .filter((r) => r.status !== "uploaded")
              .map((r, i) => (
                <Typography key={i} variant="body2" color="text.secondary">
                  ・{r.name}:{" "}
                  {r.status === "canceled" ? t("common.cancel") : r.reason}
                </Typography>
              ))}
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>{t("common.close")}</Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
