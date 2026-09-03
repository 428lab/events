import type { NostrEvent } from "../auth/nostr.js";

/**
 * Workers からリレーへの Nostr イベント発行 (#460)。
 * リレーとの WebSocket 会話（NIP-01 EVENT / NIP-42 AUTH / OK 待ち）を
 * このモジュールに閉じる。呼び出し側（routes/eventChat.ts）は
 * `nostrRelay.publishToRelays` をオブジェクト経由で呼ぶ
 * （テストで `vi.spyOn` できる形。リポジトリ層と同じ流儀）。
 *
 * **接続先 URL は必ず `getChatRelays()` の戻り値を渡すこと**。リクエストの
 * パラメータや body からリレー URL を受け取る口を作らない（任意 URL への
 * WebSocket は SSRF になる）。`getChatRelays()` は管理者設定由来で
 * `wss://` のみに正規化済み。
 *
 * 設計と会話の状態機械は docs/nip70-protected-chat.md 3.3 を参照。
 */

/** WebSocket open までの上限 */
export const RELAY_CONNECT_TIMEOUT_MS = 5_000;
/** 1リレーの接続〜OK までの総予算（AUTH 往復込み） */
export const RELAY_PUBLISH_TIMEOUT_MS = 10_000;
/** 最初の OK が出た後、残りのリレーを待つ猶予。
 * 落ちているリレー1台のために全体を総予算まで待たせない */
export const RELAY_SETTLE_GRACE_MS = 2_000;

export interface RelayOutcome {
  url: string;
  /** ok=受理 / rejected=OK false（NIP-70 非対応リレーの拒否もここ） /
   * unreachable=接続失敗 / timeout=期限・猶予切れ */
  outcome: "ok" | "rejected" | "unreachable" | "timeout";
  message?: string;
}

export interface PublishReport {
  /** 1台以上のリレーが OK なら true（ChatRelayPool.publish と同じ判定） */
  ok: boolean;
  relays: RelayOutcome[];
}

/** kind 22242（NIP-42 AUTH 応答）の署名。lib/nostrSign.ts の
 * `signWithServiceKey` をそのまま渡せる形（署名コードを増やさない） */
export type SignAuth = (template: {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}) => NostrEvent;

/** 会話ロジックが socket に要求する最小の形。プロダクションでは workerd の
 * WebSocket、テストではフェイクを渡す（テスト用フックではなく関数分割）。 */
export interface RelaySocketLike {
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (ev: { data?: unknown }) => void): void;
}

/** socket の生成だけを分離した工場関数の型（テストでフェイクに差し替える点） */
export type OpenSocket = (url: string) => Promise<RelaySocketLike>;

/** `new WebSocket(url)` で接続し、open まで待つ（Workers 対応は
 * wrangler dev の workerd で実接続を確認済み。docs 10. 参照）。
 * だめなら `fetch(https…, { Upgrade: "websocket" })` + `accept()` の退路がある */
async function openSocket(url: string): Promise<RelaySocketLike> {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* noop */
      }
      reject(new Error("connect timeout"));
    }, RELAY_CONNECT_TIMEOUT_MS);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("connect failed"));
    });
    ws.addEventListener("close", () => {
      clearTimeout(timer);
      reject(new Error("closed before open"));
    });
  });
  return ws as unknown as RelaySocketLike;
}

/**
 * 接続済み socket 上で EVENT を発行し、OK を待つ（1リレー分の状態機械）。
 *
 * - AUTH チャレンジはいつ届いてもよい（strfry は接続直後に送ることがある）。
 *   届いたら保持し、auth-required を受けた時点で kind 22242 を signAuth で
 *   署名して応答 → AUTH の OK を待って EVENT を **1回だけ** 再送する
 *   （AUTH 済みでも拒否し続けるリレーで無限ループしない）
 * - それ以外の OK false は rejected（再送しない）
 * - 期限内に決着しなければ timeout。決着時に socket は必ず閉じる
 */
export function publishOverSocket(
  socket: RelaySocketLike,
  url: string,
  event: NostrEvent,
  signAuth: SignAuth,
  timeoutMs: number = RELAY_PUBLISH_TIMEOUT_MS,
): Promise<RelayOutcome> {
  return new Promise((resolve) => {
    let done = false;
    let challenge: string | null = null;
    let authEvent: NostrEvent | null = null;
    /** auth-required を受けたがチャレンジ未着（AUTH メッセージ待ち） */
    let waitingChallenge = false;
    /** AUTH 後の EVENT 再送は1回だけ */
    let resent = false;
    const timer = setTimeout(() => settle("timeout"), timeoutMs);
    const settle = (outcome: RelayOutcome["outcome"], message?: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* noop */
      }
      resolve(message ? { url, outcome, message } : { url, outcome });
    };
    const sendEvent = () => socket.send(JSON.stringify(["EVENT", event]));
    const sendAuth = () => {
      // 22242 の形は auth/nostr.ts の verifyNostrLogin（検証側）と同じ。
      // リレーに保存されないイベントなので ["-"] は付けない
      authEvent = signAuth({
        kind: 22242,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["relay", url],
          ["challenge", challenge!],
        ],
        content: "",
      });
      socket.send(JSON.stringify(["AUTH", authEvent]));
    };
    socket.addEventListener("message", (ev) => {
      if (done) return;
      let frame: unknown;
      try {
        frame = JSON.parse(String(ev.data));
      } catch {
        return; // 壊れたフレームは無視（期限で決着する）
      }
      if (!Array.isArray(frame)) return;
      if (frame[0] === "AUTH" && typeof frame[1] === "string") {
        challenge = frame[1];
        if (waitingChallenge) {
          waitingChallenge = false;
          sendAuth();
        }
        return;
      }
      if (frame[0] !== "OK" || typeof frame[1] !== "string") return;
      const [, id, accepted, message] = frame as [string, string, boolean, string?];
      if (id === event.id) {
        if (accepted) return settle("ok");
        if (typeof message === "string" && message.startsWith("auth-required") && !resent) {
          resent = true;
          if (challenge) sendAuth();
          else waitingChallenge = true; // AUTH メッセージの到着を期限内で待つ
          return;
        }
        return settle("rejected", message);
      }
      if (authEvent && id === authEvent.id) {
        if (accepted) return sendEvent(); // AUTH が通ったので1回だけ再送
        return settle("rejected", `auth rejected: ${message ?? ""}`);
      }
    });
    socket.addEventListener("close", () => settle("unreachable", "connection closed"));
    socket.addEventListener("error", () => settle("unreachable", "connection error"));
    sendEvent();
  });
}

/** 1リレーへの接続＋発行（総予算 publishTimeoutMs は接続時間も含む）。
 * 開いた socket は onSocket で呼び出し側に渡す（猶予切れの打ち切り用） */
async function publishToOne(
  open: OpenSocket,
  url: string,
  event: NostrEvent,
  signAuth: SignAuth,
  publishTimeoutMs: number,
  onSocket: (socket: RelaySocketLike) => void,
): Promise<RelayOutcome> {
  const startedAt = Date.now();
  let socket: RelaySocketLike;
  try {
    socket = await open(url);
  } catch (err) {
    return {
      url,
      outcome: "unreachable",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  onSocket(socket);
  const remaining = Math.max(publishTimeoutMs - (Date.now() - startedAt), 1);
  return publishOverSocket(socket, url, event, signAuth, remaining);
}

/**
 * 全リレーへ並列に発行し、「全リレーが settle」または「最初の OK から
 * graceMs 経過」の早い方で判定する。猶予切れのリレーは timeout として記録し、
 * 残っている socket も閉じてから返す（レスポンス後に生かしておく仕事を
 * 作らない＝waitUntil は使わない構造にする。docs 3.3）。
 */
export async function publishToRelaysVia(
  open: OpenSocket,
  relayUrls: readonly string[],
  event: NostrEvent,
  signAuth: SignAuth,
  opts: { publishTimeoutMs?: number; graceMs?: number } = {},
): Promise<PublishReport> {
  const publishTimeoutMs = opts.publishTimeoutMs ?? RELAY_PUBLISH_TIMEOUT_MS;
  const graceMs = opts.graceMs ?? RELAY_SETTLE_GRACE_MS;
  const outcomes = new Map<string, RelayOutcome>();
  const sockets: RelaySocketLike[] = [];
  await new Promise<void>((resolve) => {
    let pending = relayUrls.length;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (graceTimer) clearTimeout(graceTimer);
      resolve();
    };
    if (pending === 0) return finish();
    for (const url of relayUrls) {
      void publishToOne(open, url, event, signAuth, publishTimeoutMs, (s) =>
        sockets.push(s),
      ).then((outcome) => {
        outcomes.set(url, outcome);
        pending--;
        if (pending === 0) return finish();
        // 最初の OK で猶予タイマーを起動（落ちたリレーを待ち続けない）
        if (outcome.outcome === "ok" && !graceTimer) {
          graceTimer = setTimeout(finish, graceMs);
        }
      });
    }
  });
  // 猶予切れで残った socket を閉じる（決着済みの close は noop）
  for (const s of sockets) {
    try {
      s.close();
    } catch {
      /* noop */
    }
  }
  const relays = relayUrls.map(
    (url) => outcomes.get(url) ?? { url, outcome: "timeout" as const },
  );
  return { ok: relays.some((r) => r.outcome === "ok"), relays };
}

export const nostrRelay = {
  /** 署名済みイベントを全リレーへ並列発行。1台以上の OK で成功 */
  publishToRelays(
    relayUrls: readonly string[],
    event: NostrEvent,
    signAuth: SignAuth,
  ): Promise<PublishReport> {
    return publishToRelaysVia(openSocket, relayUrls, event, signAuth);
  },
};
