/**
 * 手元の中継アプリ（428lab/eventslab-relay）との通信 (#11, docs/browser-live-stream.md)。
 *
 * 流れ: 中継アプリを探す（`GET /v1/hello`、47801〜47809 を1回だけ）→ ペアリング（6桁の番号 → トークン）
 * → `POST /v1/start {rtmpUrl, streamKey}` → WHIP（SDP offer → answer）→ 止めるときは `DELETE`。
 *
 * **配信キーはここで中継アプリに渡すだけ。** events lab のサーバーには送らず、localStorage にも置かない
 * （呼び出し側も、キーは React の state にだけ持つ）。
 *
 * 定期の問い合わせはしない（docs/event-signal.md）。探すのは開いたときと「もう一度探す」のときだけ。
 */

export const RELAY_PORTS = [47801, 47802, 47803, 47804, 47805, 47806, 47807, 47808, 47809] as const;
export const RELAY_RELEASES_URL = "https://github.com/428lab/eventslab-relay/releases";
export const RELAY_README_URL = "https://github.com/428lab/eventslab-relay#readme";
export const DEFAULT_RTMP_URL = "rtmp://a.rtmp.youtube.com/live2";

/** 画質の選択肢（設計 §5）。ハードウェアエンコーダーが扱える大きさとビットレート */
export const STREAM_PRESETS = {
  "720p": { width: 1280, height: 720, frameRate: 30, kbps: 3500 },
  "1080p": { width: 1920, height: 1080, frameRate: 30, kbps: 6000 },
} as const;
export type StreamPreset = keyof typeof STREAM_PRESETS;

export interface RelayHello {
  app: string;
  version: string;
  paired: boolean;
}

export interface FoundRelay {
  /** `http://127.0.0.1:<port>` */
  base: string;
  hello: RelayHello;
}

export interface RelayStatus {
  state: "idle" | "connecting" | "live" | "error";
  rtmp: "idle" | "ok" | "retrying" | "failed";
  error?: string;
  ffmpeg: boolean;
  videoKbps?: number;
  fps?: number;
  droppedFrames?: number;
  h264Profile?: string;
}

/** 中継アプリが断ったときの理由（画面が訳す。中身にキーは入らない） */
export class RelayError extends Error {
  constructor(
    readonly kind: "unauthorized" | "wrong_code" | "too_many" | "rejected" | "unreachable",
    readonly retryAfterSeconds?: number,
    message?: string,
  ) {
    super(message ?? kind);
  }
}

/** Chrome のローカルネットワーク アクセス（Chrome 142〜）に「同じ PC への通信」と先に知らせる。
 * 127.0.0.1 は `loopback`。`local` を付けると Chrome 157 は「宛先が loopback なのに local と書いてある」として断る
 * （2026-11-23 に実際の Chrome で確かめた。指定なしと `loopback` は通る） */
type LocalFetchInit = RequestInit & { targetAddressSpace?: "loopback" };

function relayFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const withSpace: LocalFetchInit = { ...init, targetAddressSpace: "loopback" };
  return fetch(url, withSpace);
}

/** 47801〜47809 を順に1回ずつ試し、最初に答えた中継アプリを返す。見つからなければ null */
export async function findRelay(): Promise<FoundRelay | null> {
  for (const port of RELAY_PORTS) {
    const base = `http://127.0.0.1:${port}`;
    try {
      const res = await relayFetch(`${base}/v1/hello`);
      if (!res.ok) continue;
      const hello = (await res.json()) as RelayHello;
      if (hello?.app === "eventslab-relay") return { base, hello };
    } catch {
      // その番号では動いていない（または許可されていない）。次を試す
    }
  }
  return null;
}

/** トークンは中継アプリごと（番号ごと）に、このサイトの localStorage に置く。配信キーは置かない */
export const relayTokenKey = (base: string) => `eventer:relayToken:${base}`;

export function loadRelayToken(base: string): string | null {
  try {
    return localStorage.getItem(relayTokenKey(base));
  } catch {
    return null;
  }
}

function saveRelayToken(base: string, token: string | null): void {
  try {
    if (token) localStorage.setItem(relayTokenKey(base), token);
    else localStorage.removeItem(relayTokenKey(base));
  } catch {
    // localStorage が使えない環境では、このタブの間だけつながる
  }
}

export function forgetRelayToken(base: string): void {
  saveRelayToken(base, null);
}

/** 中継アプリの画面に出ている6桁の番号でつなぐ。トークンを返し、保存する */
export async function pairRelay(base: string, code: string): Promise<string> {
  const res = await relayFetch(`${base}/v1/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ origin: location.origin, code: code.trim() }),
  });
  if (res.status === 429) {
    const header = Number(res.headers.get("Retry-After"));
    throw new RelayError("too_many", Number.isFinite(header) && header > 0 ? header : undefined);
  }
  if (res.status === 403) throw new RelayError("wrong_code");
  if (!res.ok) throw new RelayError("rejected", undefined, `pair ${res.status}`);
  const { token } = (await res.json()) as { token: string };
  saveRelayToken(base, token);
  return token;
}

async function authed(base: string, token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const res = await relayFetch(`${base}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    forgetRelayToken(base);
    throw new RelayError("unauthorized");
  }
  return res;
}

/** 中継アプリの今の様子（運営の操作と、配信の始めと止めたときだけ読む） */
export async function relayStatus(base: string, token: string): Promise<RelayStatus> {
  const res = await authed(base, token, "/v1/status");
  if (!res.ok) throw new RelayError("rejected", undefined, `status ${res.status}`);
  return (await res.json()) as RelayStatus;
}

/** H.264 を先頭にする（High → Main → Constrained Baseline。ハードウェアで送れる順）。H.264 が無ければ null */
export function h264Preferences(codecs: RTCRtpCodec[]): RTCRtpCodec[] | null {
  const order = ["640034", "640028", "64001f", "4d001f", "42e028", "42e01f"];
  const picked = order.flatMap((profile) =>
    codecs.filter(
      (c) =>
        /h264/i.test(c.mimeType) &&
        c.sdpFmtpLine?.includes("packetization-mode=1") &&
        c.sdpFmtpLine.includes(`profile-level-id=${profile}`),
    ),
  );
  return picked.length > 0 ? picked : null;
}

/** 中継アプリは同じ PC の中なので、Chrome の帯域の見積もりが低い所から少しずつしか上がらない。
 * answer の H.264 に最初から目標のビットレートを書き足す（試作で確かめた方法） */
export function withStartBitrate(answer: string, kbps: number): string {
  return answer.replace(
    /(a=fmtp:\d+ [^\r\n]*packetization-mode=1[^\r\n]*)/g,
    `$1;x-google-start-bitrate=${kbps};x-google-min-bitrate=${Math.round(kbps * 0.6)};x-google-max-bitrate=${kbps}`,
  );
}

export interface RelaySession {
  pc: RTCPeerConnection;
  /** 配信を止める（WHIP の DELETE。中継アプリが RTMP も閉じる）。何度呼んでもよい */
  stop: () => Promise<void>;
}

/**
 * 送り先を渡して WHIP で送り始める。
 * `target` の配信キーは中継アプリに渡すだけで、ここから先には残さない。
 */
export async function startRelayStream(
  base: string,
  token: string,
  stream: MediaStream,
  target: { rtmpUrl: string; streamKey: string },
  preset: StreamPreset,
): Promise<RelaySession> {
  const p = STREAM_PRESETS[preset];
  const start = await authed(base, token, "/v1/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rtmpUrl: target.rtmpUrl, streamKey: target.streamKey }),
  });
  if (!start.ok) throw new RelayError("rejected", undefined, `start ${start.status}`);

  const pc = new RTCPeerConnection();
  try {
    for (const track of stream.getTracks()) pc.addTransceiver(track, { direction: "sendonly", streams: [stream] });
    const video = pc.getTransceivers().find((t) => t.sender.track?.kind === "video");
    if (video) {
      const prefs = h264Preferences(RTCRtpSender.getCapabilities("video")?.codecs ?? []);
      if (prefs) video.setCodecPreferences(prefs);
      const params = video.sender.getParameters();
      params.encodings = [{ ...(params.encodings?.[0] ?? {}), maxBitrate: p.kbps * 1000, maxFramerate: p.frameRate }];
      params.degradationPreference = "maintain-resolution";
      await video.sender.setParameters(params).catch(() => undefined);
    }
    await pc.setLocalDescription(await pc.createOffer());
    await waitIceGathering(pc);

    const res = await authed(base, token, "/v1/whip", {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: pc.localDescription?.sdp ?? "",
    });
    if (!res.ok) throw new RelayError("rejected", undefined, `whip ${res.status}`);
    const location = res.headers.get("Location");
    await pc.setRemoteDescription({ type: "answer", sdp: withStartBitrate(await res.text(), p.kbps) });

    let stopped = false;
    return {
      pc,
      stop: async () => {
        if (stopped) return;
        stopped = true;
        pc.close();
        if (location) await authed(base, token, location, { method: "DELETE" }).catch(() => undefined);
      },
    };
  } catch (e) {
    pc.close();
    throw e;
  }
}

function waitIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 2000);
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

/** 圧縮が本当にハードウェアかを、送っている映像の統計から読む（設計 §5） */
export type EncoderKind = "hardware" | "software" | "unknown";

export interface SenderStats {
  encoder: EncoderKind;
  encoderImplementation?: string;
  kbps?: number;
  fps?: number;
  width?: number;
  height?: number;
}

const SOFTWARE_ENCODERS = /openh264|libvpx|libaom|ffmpeg/i;

export function encoderKind(impl: string | undefined, powerEfficient: boolean | undefined): EncoderKind {
  if (powerEfficient === true) return "hardware";
  if (impl && SOFTWARE_ENCODERS.test(impl)) return "software";
  if (powerEfficient === false && impl) return "software";
  if (impl) return "hardware";
  // Chrome はカメラ・マイクを取り込んでいるページにしか見せない（指紋対策）。取れないときは「不明」
  return "unknown";
}

/** 前回の値と比べてビットレートを出すため、前回の bytesSent と時刻を持ち回る */
export async function readSenderStats(
  pc: RTCPeerConnection,
  prev: { bytes: number; at: number } | null,
): Promise<{ stats: SenderStats; mark: { bytes: number; at: number } | null }> {
  const report = await pc.getStats();
  let out: SenderStats = { encoder: "unknown" };
  let mark: { bytes: number; at: number } | null = prev;
  report.forEach((s: RTCStats & Record<string, unknown>) => {
    if (s.type !== "outbound-rtp" || s.kind !== "video") return;
    const impl = typeof s.encoderImplementation === "string" ? s.encoderImplementation : undefined;
    const power = typeof s.powerEfficientEncoder === "boolean" ? s.powerEfficientEncoder : undefined;
    const bytes = typeof s.bytesSent === "number" ? s.bytesSent : 0;
    const at = s.timestamp;
    const kbps = prev && at > prev.at ? Math.round(((bytes - prev.bytes) * 8) / (at - prev.at)) : undefined;
    out = {
      encoder: encoderKind(impl, power),
      encoderImplementation: impl,
      kbps,
      fps: typeof s.framesPerSecond === "number" ? Math.round(s.framesPerSecond) : undefined,
      width: typeof s.frameWidth === "number" ? s.frameWidth : undefined,
      height: typeof s.frameHeight === "number" ? s.frameHeight : undefined,
    };
    mark = { bytes, at };
  });
  return { stats: out, mark };
}

/**
 * 配信画面のタブそのものを取り込み、必要ならマイクを混ぜて1本の MediaStream にする（設計 §3）。
 * タブの音（BGM・演出）とマイクは WebAudio で1本の音にまとめる（2本送らない）。
 */
export async function captureLiveTab(
  preset: StreamPreset,
  withMic: boolean,
): Promise<{ stream: MediaStream; release: () => void; videoTrack: MediaStreamTrack; mic: MediaStreamTrack | null }> {
  const p = STREAM_PRESETS[preset];
  const options = {
    video: { width: p.width, height: p.height, frameRate: p.frameRate },
    audio: true,
    preferCurrentTab: true,
    selfBrowserSurface: "include",
    surfaceSwitching: "exclude",
    systemAudio: "exclude",
  } as DisplayMediaStreamOptions;
  const display = await navigator.mediaDevices.getDisplayMedia(options);
  // マイクは配信中に切り替えられるよう、トラックを返す（enabled=false で無音になる）
  const mic = withMic ? await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null) : null;

  const videoTrack = display.getVideoTracks()[0]!;
  videoTrack.contentHint = "detail";
  const ac = new AudioContext();
  const dest = ac.createMediaStreamDestination();
  const tabAudio = display.getAudioTracks();
  if (tabAudio.length > 0) ac.createMediaStreamSource(new MediaStream(tabAudio)).connect(dest);
  if (mic) ac.createMediaStreamSource(mic).connect(dest);
  const stream = new MediaStream([videoTrack, ...dest.stream.getAudioTracks()]);
  return {
    stream,
    videoTrack,
    mic: mic?.getAudioTracks()[0] ?? null,
    release: () => {
      display.getTracks().forEach((t) => t.stop());
      mic?.getTracks().forEach((t) => t.stop());
      void ac.close().catch(() => undefined);
    },
  };
}
