import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findRelay, pairRelay, RelayError, relayTokenKey, startRelayStream } from "./liveRelay.js";

/**
 * 手元の中継アプリとの通信 (#11)。
 * 守ること: 探すのは1回だけ・ペアリングのトークンを覚える・H.264 を先に並べて start → WHIP の順で送る・
 * **配信キーを events lab のサーバー（/api）にも localStorage にも出さない**。
 */

type Call = { url: string; init?: RequestInit & { targetAddressSpace?: string } };
let calls: Call[];

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

beforeEach(() => {
  calls = [];
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe("findRelay", () => {
  it("47801 から順に1回ずつ試し、最初に答えた中継アプリで止める。手元への通信だと Chrome に知らせる", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: Call["init"]) => {
      calls.push({ url, init });
      if (url.startsWith("http://127.0.0.1:47803/")) return json({ app: "eventslab-relay", version: "v0.1.0", paired: false });
      throw new TypeError("connection refused");
    }));

    const found = await findRelay();

    expect(found).toEqual({ base: "http://127.0.0.1:47803", hello: { app: "eventslab-relay", version: "v0.1.0", paired: false } });
    expect(calls.map((c) => c.url)).toEqual([
      "http://127.0.0.1:47801/v1/hello",
      "http://127.0.0.1:47802/v1/hello",
      "http://127.0.0.1:47803/v1/hello",
    ]);
    expect(calls.every((c) => c.init?.targetAddressSpace === "loopback")).toBe(true);
  });
});

describe("pairRelay", () => {
  it("番号が合えばトークンを中継アプリごとに覚える。間違いが続いたら待つ秒数を返す", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: Call["init"]) => {
      calls.push({ url, init });
      return json({ token: "tok-1" });
    }));
    await expect(pairRelay("http://127.0.0.1:47801", " 123456 ")).resolves.toBe("tok-1");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ origin: location.origin, code: "123456" });
    expect(localStorage.getItem(relayTokenKey("http://127.0.0.1:47801"))).toBe("tok-1");

    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "too_many_attempts" }, 429, { "Retry-After": "12" })));
    const err = await pairRelay("http://127.0.0.1:47801", "000000").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RelayError);
    expect(err).toMatchObject({ kind: "too_many", retryAfterSeconds: 12 });
  });
});

/** WebRTC の最小の偽物（送る側だけ） */
class FakeSender {
  params: RTCRtpSendParameters = { encodings: [{}], transactionId: "t", codecs: [], headerExtensions: [], rtcp: {} } as RTCRtpSendParameters;
  constructor(readonly track: MediaStreamTrack) {}
  getParameters() { return this.params; }
  async setParameters(p: RTCRtpSendParameters) { this.params = p; }
}
class FakeTransceiver {
  preferences: RTCRtpCodec[] | null = null;
  sender: FakeSender;
  constructor(track: MediaStreamTrack) { this.sender = new FakeSender(track); }
  setCodecPreferences(c: RTCRtpCodec[]) { this.preferences = c; }
}
let lastPc: FakePc | null = null;
class FakePc {
  transceivers: FakeTransceiver[] = [];
  iceGatheringState = "complete";
  localDescription: { sdp: string } | null = null;
  remote: { type: string; sdp: string } | null = null;
  closed = false;
  constructor() { lastPc = this; }
  addTransceiver(track: MediaStreamTrack) { this.transceivers.push(new FakeTransceiver(track)); }
  getTransceivers() { return this.transceivers; }
  async createOffer() { return { type: "offer", sdp: "v=0 offer" }; }
  async setLocalDescription(d: { sdp: string }) { this.localDescription = d; }
  async setRemoteDescription(d: { type: string; sdp: string }) { this.remote = d; }
  addEventListener() {}
  close() { this.closed = true; }
}

const CODECS = [
  { mimeType: "video/VP8", clockRate: 90000 },
  { mimeType: "video/H264", clockRate: 90000, sdpFmtpLine: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f" },
  { mimeType: "video/H264", clockRate: 90000, sdpFmtpLine: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=64001f" },
] as RTCRtpCodec[];

describe("startRelayStream", () => {
  const key = "abcd-efgh-ijkl-mnop";

  beforeEach(() => {
    lastPc = null;
    vi.stubGlobal("RTCPeerConnection", FakePc);
    vi.stubGlobal("RTCRtpSender", { getCapabilities: () => ({ codecs: CODECS, headerExtensions: [] }) });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: Call["init"]) => {
      calls.push({ url, init });
      if (url.endsWith("/v1/start")) return json({ whipUrl: "/v1/whip" });
      if (url.endsWith("/v1/whip")) {
        return new Response("v=0\r\na=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=64001f\r\n", {
          status: 201, headers: { Location: "/v1/whip/s1", "Content-Type": "application/sdp" },
        });
      }
      return json({ ok: true });
    }));
  });

  const stream = () => {
    const video = { kind: "video" } as MediaStreamTrack;
    const audio = { kind: "audio" } as MediaStreamTrack;
    return { getTracks: () => [video, audio] } as unknown as MediaStream;
  };

  it("start（送り先）→ WHIP の順に送り、H.264 の High を先頭にし、最初から目標のビットレートを書き足す", async () => {
    const session = await startRelayStream("http://127.0.0.1:47801", "tok", stream(), { rtmpUrl: "rtmp://a.rtmp.youtube.com/live2", streamKey: key }, "720p");

    expect(calls.map((c) => `${c.init?.method ?? "GET"} ${c.url}`)).toEqual([
      "POST http://127.0.0.1:47801/v1/start",
      "POST http://127.0.0.1:47801/v1/whip",
    ]);
    expect(calls.every((c) => (c.init?.headers as Record<string, string>).Authorization === "Bearer tok")).toBe(true);
    const video = lastPc!.transceivers[0]!;
    expect(video.preferences?.map((c) => c.sdpFmtpLine?.match(/profile-level-id=(\w+)/)?.[1])).toEqual(["64001f", "42e01f"]);
    expect(video.sender.params.encodings[0]).toMatchObject({ maxBitrate: 3_500_000, maxFramerate: 30 });
    expect(lastPc!.remote?.sdp).toContain("x-google-start-bitrate=3500");

    await session.stop();
    expect(calls.at(-1)).toMatchObject({ url: "http://127.0.0.1:47801/v1/whip/s1", init: { method: "DELETE" } });
  });

  it("配信キーは中継アプリの /v1/start にだけ渡す。events lab の /api にも localStorage にも出さない", async () => {
    await startRelayStream("http://127.0.0.1:47801", "tok", stream(), { rtmpUrl: "rtmp://a.rtmp.youtube.com/live2", streamKey: key }, "1080p");

    const withKey = calls.filter((c) => `${c.url} ${String(c.init?.body ?? "")}`.includes(key));
    expect(withKey.map((c) => c.url)).toEqual(["http://127.0.0.1:47801/v1/start"]);
    expect(calls.some((c) => !c.url.startsWith("http://127.0.0.1:"))).toBe(false);
    const stored = Object.keys(localStorage).map((k) => localStorage.getItem(k) ?? "").join(" ");
    expect(stored).not.toContain(key);
  });
});
