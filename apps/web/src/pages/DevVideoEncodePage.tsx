import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  FormControl,
  FormControlLabel,
  LinearProgress,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import {
  decideVideoPlan,
  type VideoCapability,
  type VideoInputProbe,
  type VideoPlan,
} from "../lib/video/plan.js";
import { detectVideoCapability, probeVideoFile } from "../lib/video/probe.js";
import {
  createVideoConversion,
  type EncodePlan,
  type VideoEncoder408Handle,
} from "../lib/video/encode.js";
import { extractVideoPoster } from "../lib/video/poster.js";

/**
 * 動画エンコードの実機計測ページ (#408)。
 *
 * 【検証用に維持】ナビには載せず URL 直打ち（/dev/video-encode）でだけ開く。
 * 本実装（投稿 UI）が入った後も、新しい端末・ブラウザでの変換経路と
 * 速度の検証用に残している。開発者向けページなので文言は ja 直書きで
 * i18n の縛りを緩めている（利用者向けの画面ではこの手抜きをしないこと）。
 *
 * パイプライン本体（lib/video/）は本実装（VideoUploadDialog）と共用。
 */

/** 経路の強制。auto 以外はユーザーが手で選ぶ（iOS 26 端末1台で
 * WebM 経路と MP4 経路の両方を測れるようにするため）。
 * 強制は plan の差し替えとしてこの画面内で完結させ、
 * パイプライン本体には強制の口を作らない */
type RouteChoice = "auto" | "force-webm" | "force-mp4-copy" | "force-mp4-reencode";

const ROUTE_LABEL: Record<RouteChoice, string> = {
  auto: "自動（本実装と同じ判定）",
  "force-webm": "WebM を強制（VP9→VP8 + Opus）",
  "force-mp4-copy": "MP4 を強制（H.264 + AAC パススルー）",
  "force-mp4-reencode": "MP4 を強制（H.264 再エンコード）",
};

type RunResult = {
  at: string;
  fileName: string;
  route: string;
  planLabel: string;
  elapsedMs: number;
  /** 実時間比: 動画の長さ / 変換所要時間。大きいほど速い */
  realtimeRatio: number | null;
  inputBytes: number;
  outputBytes: number | null;
  inputDims: string;
  outputDims: string;
  outputDurationMs: number | null;
  posterMs: number | null;
};

function fmtBytes(n: number | null): string {
  if (n === null) return "-";
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024).toFixed(1)} KB`;
}

function fmtDuration(ms: number | null): string {
  if (ms === null) return "-";
  return `${(ms / 1000).toFixed(2)} 秒`;
}

function planLabel(plan: VideoPlan): string {
  if (plan.kind === "encode") {
    const audio =
      plan.audio === "opus" ? "Opus"
      : plan.audio === "aac-copy" ? "AAC パススルー"
      : "音声なし";
    return `${plan.container.toUpperCase()} 変換 (${plan.videoCodec} / ${audio})`;
  }
  if (plan.kind === "passthrough") return `素通し (${plan.mime})`;
  return `不可 (${plan.reason})`;
}

/** 強制経路から plan を組む。無理なら理由の文字列を返す（それ自体が計測情報） */
function forcePlan(
  choice: Exclude<RouteChoice, "auto">,
  support: VideoCapability,
  probe: VideoInputProbe,
): EncodePlan | string {
  const hasAudio = probe.audioCodec !== null;
  if (!support.hasVideoEncoder) return "この端末では不可: 映像エンコーダ (WebCodecs VideoEncoder) がない";
  if (!probe.canDecodeVideo) return `この端末では不可: 入力の映像 (${probe.videoCodec ?? "?"}) をデコードできない`;
  if (choice === "force-webm") {
    if (!support.canEncodeVp9 && !support.canEncodeVp8) {
      return "この端末では不可: VP9/VP8 をエンコードできない";
    }
    const videoCodec = support.canEncodeVp9 ? "vp9" : "vp8";
    const withOpus = hasAudio && support.canEncodeOpus && probe.canDecodeAudio;
    return {
      kind: "encode",
      container: "webm",
      videoCodec,
      audio: withOpus ? "opus" : "none",
      confirmDropAudio: false,
    };
  }
  if (!support.canEncodeH264) return "この端末では不可: H.264 をエンコードできない";
  return {
    kind: "encode",
    container: "mp4",
    videoCodec: "avc",
    audio: hasAudio && probe.audioCodec === "aac" ? "aac-copy" : "none",
    confirmDropAudio: false,
  };
}

export function DevVideoEncodePage() {
  const [route, setRoute] = useState<RouteChoice>("auto");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [phase, setPhase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [autoPlanText, setAutoPlanText] = useState<string | null>(null);
  const [capabilityText, setCapabilityText] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [results, setResults] = useState<RunResult[]>([]);
  const handleRef = useRef<VideoEncoder408Handle | null>(null);
  const urlsRef = useRef<string[]>([]);

  useEffect(() => {
    return () => {
      urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  const setObjectUrl = (setter: (u: string | null) => void, blob: Blob | null) => {
    if (!blob) {
      setter(null);
      return;
    }
    const url = URL.createObjectURL(blob);
    urlsRef.current.push(url);
    setter(url);
  };

  const run = async (file: File) => {
    setRunning(true);
    setError(null);
    setNotice(null);
    setProgress(null);
    setVideoUrl(null);
    setPosterUrl(null);
    try {
      setPhase("解析中…");
      const probed = await probeVideoFile(file);
      const support = await detectVideoCapability(probed.probe.width, probed.probe.height);
      setCapabilityText(
        [
          `VideoEncoder: ${support.hasVideoEncoder ? "あり" : "なし"}`,
          `VP9: ${support.canEncodeVp9 ? "○" : "×"}`,
          `VP8: ${support.canEncodeVp8 ? "○" : "×"}`,
          `H.264: ${support.canEncodeH264 ? "○" : "×"}`,
          `Opus: ${support.canEncodeOpus ? "○" : "×"}`,
        ].join(" / "),
      );

      const autoPlan = decideVideoPlan(support, probed.probe);
      setAutoPlanText(planLabel(autoPlan));

      const p = probed.probe;
      const inputDims = `${p.width}x${p.height}`;
      const routeLabel = ROUTE_LABEL[route];

      // 実行する plan を決める（強制は画面側で差し替える）
      let effective: VideoPlan;
      if (route === "auto") {
        effective = autoPlan;
      } else {
        const forced = forcePlan(route, support, p);
        if (typeof forced === "string") {
          setError(`${routeLabel}: ${forced}`);
          return;
        }
        effective = forced;
      }

      if (effective.kind === "reject") {
        setError(`自動判定: この動画は受け付けられません（理由: ${effective.reason}）`);
        return;
      }

      if (effective.kind === "passthrough") {
        // 変換なし。元ファイルをそのまま再生して見せるだけ
        setObjectUrl(setVideoUrl, file);
        setResults((prev) => [
          {
            at: new Date().toLocaleTimeString(),
            fileName: file.name,
            route: routeLabel,
            planLabel: planLabel(effective),
            elapsedMs: 0,
            realtimeRatio: null,
            inputBytes: file.size,
            outputBytes: file.size,
            inputDims,
            outputDims: inputDims,
            outputDurationMs: p.durationMs,
            posterMs: null,
          },
          ...prev,
        ]);
        setNotice("素通し経路のため変換していません（元ファイルをそのまま送る経路）");
        return;
      }

      if (effective.confirmDropAudio) {
        setNotice("本実装では「音声なしで投稿しますか？」の確認を挟む経路です（計測では確認せず続行）");
      }

      setPhase(`変換中… (${planLabel(effective)})`);
      const handle = await createVideoConversion(probed, effective, {
        onProgress: (v) => setProgress(v),
        forceTranscodeVideo: route === "force-mp4-reencode",
      });
      handleRef.current = handle;
      if (handle.invalidReason) {
        setError(`${routeLabel}: この端末では不可 (${handle.invalidReason})`);
        return;
      }

      const t0 = performance.now();
      const out = await handle.execute();
      const elapsedMs = performance.now() - t0;

      setPhase("ポスター切り出し中…");
      const tp0 = performance.now();
      const poster = await extractVideoPoster(probed);
      const posterMs = performance.now() - tp0;
      setObjectUrl(setPosterUrl, poster);

      // 出力を demux し直して実際の解像度・長さを確かめる（申告値でなく実測）
      setPhase("出力を検分中…");
      let outDims = `${out.width}x${out.height}`;
      let outDurationMs: number | null = null;
      try {
        const reprobed = await probeVideoFile(
          new File([out.blob], "out", { type: out.mime }),
        );
        outDims = `${reprobed.probe.width}x${reprobed.probe.height}`;
        outDurationMs = reprobed.probe.durationMs;
      } catch {
        // 検分失敗は計測続行（表示は概算のまま）
      }

      setObjectUrl(setVideoUrl, out.blob);
      setResults((prev) => [
        {
          at: new Date().toLocaleTimeString(),
          fileName: file.name,
          route: routeLabel,
          planLabel: planLabel(effective),
          elapsedMs,
          realtimeRatio: p.durationMs > 0 ? p.durationMs / elapsedMs : null,
          inputBytes: file.size,
          outputBytes: out.blob.size,
          inputDims,
          outputDims: outDims,
          outputDurationMs: outDurationMs ?? p.durationMs,
          posterMs,
        },
        ...prev,
      ]);
    } catch (e) {
      // 実機で原因が分かるよう中身を出す
      const detail = e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ""}` : String(e);
      setError(detail);
    } finally {
      handleRef.current = null;
      setRunning(false);
      setProgress(null);
      setPhase("");
    }
  };

  const latest = results[0];

  return (
    <Box sx={{ maxWidth: 900, mx: "auto", p: 2 }}>
      <Typography variant="h5" gutterBottom>
        動画エンコード計測（一時ページ）
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        動画ファイルを選ぶと、この端末で投稿時に行われる変換をその場で実行して速度を測ります。
        アップロードはしません。
      </Typography>

      <Paper sx={{ p: 2, mb: 2 }}>
        <FormControl disabled={running}>
          <Typography variant="subtitle2">エンコード経路</Typography>
          <RadioGroup value={route} onChange={(e) => setRoute(e.target.value as RouteChoice)}>
            {(Object.keys(ROUTE_LABEL) as RouteChoice[]).map((k) => (
              <FormControlLabel key={k} value={k} control={<Radio size="small" />} label={ROUTE_LABEL[k]} />
            ))}
          </RadioGroup>
        </FormControl>
        <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 1 }}>
          <Button variant="contained" component="label" disabled={running}>
            動画を選んで計測
            <input
              hidden
              type="file"
              accept="video/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void run(f);
              }}
            />
          </Button>
          {running && (
            <Button
              color="warning"
              onClick={() => {
                void handleRef.current?.cancel();
              }}
            >
              中断
            </Button>
          )}
        </Stack>
        {running && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="body2">{phase}</Typography>
            {progress !== null ? (
              <>
                <LinearProgress variant="determinate" value={progress * 100} />
                <Typography variant="caption">{Math.round(progress * 100)}%</Typography>
              </>
            ) : (
              <LinearProgress />
            )}
          </Box>
        )}
      </Paper>

      {capabilityText && (
        <Typography variant="body2" sx={{ mb: 1 }}>
          エンコード能力: {capabilityText}
        </Typography>
      )}
      {autoPlanText && (
        <Typography variant="body2" sx={{ mb: 1 }}>
          自動判定の経路: <Chip size="small" label={autoPlanText} />
          {route !== "auto" && "（強制と比較用）"}
        </Typography>
      )}
      {notice && (
        <Alert severity="info" sx={{ mb: 1 }}>
          {notice}
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 1, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
          {error}
        </Alert>
      )}

      {latest && (
        <Paper sx={{ p: 2, mb: 2 }}>
          <Typography variant="subtitle1" gutterBottom>
            直近の結果: {latest.planLabel}
          </Typography>
          <Typography variant="body2">
            所要 {fmtDuration(latest.elapsedMs)}
            {latest.realtimeRatio !== null &&
              ` ／ 実時間比 ${latest.realtimeRatio.toFixed(2)}x（${fmtDuration(
                latest.outputDurationMs,
              )} の動画を ${fmtDuration(latest.elapsedMs)} で変換）`}
          </Typography>
          <Typography variant="body2">
            サイズ {fmtBytes(latest.inputBytes)} → {fmtBytes(latest.outputBytes)} ／ 解像度{" "}
            {latest.inputDims} → {latest.outputDims} ／ 長さ {fmtDuration(latest.outputDurationMs)}
          </Typography>
          {latest.posterMs !== null && (
            <Typography variant="body2">ポスター切り出し {fmtDuration(latest.posterMs)}</Typography>
          )}
          {videoUrl && (
            <Box sx={{ mt: 1 }}>
              <video
                src={videoUrl}
                controls
                playsInline
                style={{ maxWidth: "100%", maxHeight: 360, background: "#000" }}
              />
            </Box>
          )}
          {posterUrl && (
            <Box sx={{ mt: 1 }}>
              <Typography variant="caption">ポスター:</Typography>
              <br />
              <img src={posterUrl} alt="poster" style={{ maxWidth: 200, border: "1px solid #ccc" }} />
            </Box>
          )}
        </Paper>
      )}

      {results.length > 1 && (
        <Paper sx={{ p: 2, mb: 2, overflowX: "auto" }}>
          <Typography variant="subtitle1" gutterBottom>
            このセッションの計測（経路の比較用）
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>時刻</TableCell>
                <TableCell>経路</TableCell>
                <TableCell>所要</TableCell>
                <TableCell>実時間比</TableCell>
                <TableCell>サイズ</TableCell>
                <TableCell>解像度</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {results.map((r, i) => (
                <TableRow key={i}>
                  <TableCell>{r.at}</TableCell>
                  <TableCell>{r.planLabel}</TableCell>
                  <TableCell>{fmtDuration(r.elapsedMs)}</TableCell>
                  <TableCell>{r.realtimeRatio !== null ? `${r.realtimeRatio.toFixed(2)}x` : "-"}</TableCell>
                  <TableCell>
                    {fmtBytes(r.inputBytes)} → {fmtBytes(r.outputBytes)}
                  </TableCell>
                  <TableCell>
                    {r.inputDims} → {r.outputDims}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      <Divider sx={{ my: 2 }} />
      {/* 報告用: どの端末での計測かが分かるように UA を出す */}
      <Typography variant="caption" color="text.secondary" sx={{ wordBreak: "break-all" }}>
        {navigator.userAgent}
      </Typography>
    </Box>
  );
}
