import { CHAT_RELAYS } from "@eventer/shared";
import { createNostrConnectURI } from "nostr-tools/nip46";
import { decrypt, encrypt, getConversationKey } from "nostr-tools/nip44";
import { SimplePool } from "nostr-tools/pool";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  verifyEvent,
  type Event,
  type EventTemplate,
  type VerifiedEvent,
} from "nostr-tools/pure";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";

/**
 * NIP-46 の `nostrconnect://` で、Amber などの署名アプリに署名してもらう (D-NOSTR-SIGNER)。
 *
 * 秘密鍵はブラウザに来ない。ブラウザが持つのは「つなぐための鍵」（使い捨ての
 * クライアント鍵）だけで、署名アプリとはリレー越しに NIP-44 で暗号化した
 * kind 24133 をやりとりする。
 *
 * nostr-tools の BunkerSigner を使わず、ここで小さく組んでいるのは、応答の
 * 購読が `limit: 0`（今から届くものだけ）で、Android が裏に回ったブラウザの
 * 接続を切ると、その間に届いた応答を取りこぼすため。ここでは購読に `since` を
 * 付け、画面に戻ったとき（visibilitychange で visible）に1回だけ購読し直して、
 * リレーに残っている応答を拾う。定期の確認はしない。
 *
 * 扱うのは connect（相手からの接続の応答）と sign_event だけ。
 */

/** NIP-46 のやりとりに使う kind（ephemeral） */
const NOSTR_CONNECT_KIND = 24133;
/** つなぐときに頼む権限。ログインの署名（kind 22242）だけ */
const LOGIN_PERMS = ["sign_event:22242"];
/** 接続を待つ上限。過ぎたら「応答がありませんでした」 */
export const CONNECT_TIMEOUT_MS = 120_000;
/** 署名を待つ上限。過ぎたら「署名が承認されませんでした」 */
export const SIGN_TIMEOUT_MS = 60_000;
/** 端末どうしの時計のずれを見込んで、購読の since を少し前にする（秒） */
const SINCE_SLACK_SEC = 10;
/** 覚えておく接続の保存先（この端末のブラウザごと。アカウントには紐づけない） */
const SAVED_SESSION_KEY = "nostrConnectSession";

/** 署名アプリとの接続。次のログインで使えるように localStorage に覚えておく */
export interface NostrConnectSession {
  /** つなぐための鍵（hex）。本人の秘密鍵ではない */
  clientSecretKey: string;
  /** 署名アプリ側の公開鍵（connect の応答を送ってきた鍵） */
  remotePubkey: string;
  relays: string[];
}

/** 署名アプリとのやりとりの失敗。画面の出し分けに使う */
export type NostrConnectErrorCode = "timeout" | "aborted" | "rejected" | "relay";

export class NostrConnectError extends Error {
  constructor(public code: NostrConnectErrorCode) {
    super(`nostr_connect_${code}`);
  }
}

/** リレーとのやりとりに使う最小限の形。テストでは偽のリレーを差し込む */
export interface NostrConnectPool {
  subscribeMany(
    relays: string[],
    filter: {
      kinds: number[];
      "#p": string[];
      since: number;
      authors?: string[];
    },
    params: { onevent: (event: Event) => void },
  ): { close: () => void };
  publish(relays: string[], event: VerifiedEvent): Promise<string>[];
}

let defaultPool: NostrConnectPool | null = null;
function getPool(pool?: NostrConnectPool): NostrConnectPool {
  if (pool) return pool;
  defaultPool ??= new SimplePool() as unknown as NostrConnectPool;
  return defaultPool;
}

export interface ConnectRequest {
  /** 署名アプリに渡す `nostrconnect://` の URI（ボタンのリンクと QR の中身） */
  uri: string;
  clientSecretKey: Uint8Array;
  secret: string;
  relays: string[];
}

/** 押した瞬間に、使い捨ての鍵と secret を作って URI を組み立てる */
export function buildConnectRequest(origin: string): ConnectRequest {
  const clientSecretKey = generateSecretKey();
  const secretBytes = new Uint8Array(16);
  crypto.getRandomValues(secretBytes);
  const secret = bytesToHex(secretBytes);
  const relays = [...CHAT_RELAYS];
  // URLSearchParams は空白を `+` にするが、Amethyst はそれを `+` のまま表示する
  // （"events+lab"）。値の中の `+` は `%2B` になるので、残る `+` は空白だけ。`%20` に直す
  const uri = createNostrConnectURI({
    clientPubkey: getPublicKey(clientSecretKey),
    relays,
    secret,
    perms: LOGIN_PERMS,
    name: "events lab",
    url: origin,
    image: `${origin}/icon-512.png`,
  }).replace(/\+/g, "%20");
  return { uri, clientSecretKey, secret, relays };
}

interface WaitOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  pool?: NostrConnectPool;
}

/**
 * 自分宛ての 24133 を購読し、復号できた中身を `onMessage` に渡す。
 * 画面に戻るたびに1回だけ購読し直す（裏にいた間に切れた接続の取りこぼしを拾う）。
 * 同じイベントは2回渡さない。
 */
function listenResponses(
  pool: NostrConnectPool,
  relays: string[],
  clientSecretKey: Uint8Array,
  since: number,
  remotePubkey: string | null,
  onMessage: (message: Record<string, unknown>, event: Event) => void,
): () => void {
  const filter = {
    kinds: [NOSTR_CONNECT_KIND],
    "#p": [getPublicKey(clientSecretKey)],
    since,
    ...(remotePubkey ? { authors: [remotePubkey] } : {}),
  };
  const seen = new Set<string>();
  const onevent = (event: Event) => {
    if (seen.has(event.id)) return;
    seen.add(event.id);
    try {
      const key = getConversationKey(clientSecretKey, event.pubkey);
      const message = JSON.parse(decrypt(event.content, key)) as Record<
        string,
        unknown
      >;
      onMessage(message, event);
    } catch {
      /* 自分宛てでない・壊れた中身は無視 */
    }
  };
  let sub = pool.subscribeMany(relays, filter, { onevent });
  const onVisible = () => {
    if (document.visibilityState !== "visible") return;
    sub.close();
    sub = pool.subscribeMany(relays, filter, { onevent });
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    sub.close();
  };
}

/** 中止・時間切れ・後片付けをまとめた待ち合わせ */
function waitFor<T>(
  { signal, timeoutMs }: WaitOptions,
  start: (resolve: (value: T) => void, reject: (e: Error) => void) => () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new NostrConnectError("aborted"));
      return;
    }
    let stop = () => {};
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      stop();
    };
    const onAbort = () => {
      finish();
      reject(new NostrConnectError("aborted"));
    };
    const timer = setTimeout(() => {
      finish();
      reject(new NostrConnectError("timeout"));
    }, timeoutMs);
    signal?.addEventListener("abort", onAbort);
    stop = start(
      (value) => {
        finish();
        resolve(value);
      },
      (e) => {
        finish();
        reject(e);
      },
    );
  });
}

/**
 * 署名アプリからの connect の応答を待つ。応答の secret が URI に入れたものと
 * 一致したときだけ受け入れる（ほかの応答に乗っ取られないため）。
 */
export function waitForConnect(
  req: ConnectRequest,
  { signal, timeoutMs = CONNECT_TIMEOUT_MS, pool }: WaitOptions = {},
): Promise<NostrConnectSession> {
  const since = Math.floor(Date.now() / 1000) - SINCE_SLACK_SEC;
  return waitFor<NostrConnectSession>({ signal, timeoutMs }, (resolve) =>
    listenResponses(
      getPool(pool),
      req.relays,
      req.clientSecretKey,
      since,
      null,
      (message, event) => {
        if (message.result !== req.secret) return;
        resolve({
          clientSecretKey: bytesToHex(req.clientSecretKey),
          remotePubkey: event.pubkey,
          relays: req.relays,
        });
      },
    ),
  );
}

/**
 * 接続済みの署名アプリに sign_event を頼み、署名済みのイベントを返す。
 * 署名アプリが断ったら "rejected"、どのリレーにも送れなければ "relay"。
 */
export function requestSignEvent(
  session: NostrConnectSession,
  template: EventTemplate,
  { signal, timeoutMs = SIGN_TIMEOUT_MS, pool }: WaitOptions = {},
): Promise<VerifiedEvent> {
  const clientSecretKey = hexToBytes(session.clientSecretKey);
  const id = bytesToHex(generateSecretKey()).slice(0, 16);
  const since = Math.floor(Date.now() / 1000) - SINCE_SLACK_SEC;
  const p = getPool(pool);
  return waitFor<VerifiedEvent>({ signal, timeoutMs }, (resolve, reject) => {
    const stop = listenResponses(
      p,
      session.relays,
      clientSecretKey,
      since,
      session.remotePubkey,
      (message) => {
        if (message.id !== id) return;
        if (message.result === "auth_url") return;
        if (message.error || typeof message.result !== "string") {
          reject(new NostrConnectError("rejected"));
          return;
        }
        try {
          const event = JSON.parse(message.result) as Event;
          if (!verifyEvent(event) || event.kind !== template.kind) {
            reject(new NostrConnectError("rejected"));
            return;
          }
          resolve(event);
        } catch {
          reject(new NostrConnectError("rejected"));
        }
      },
    );
    const key = getConversationKey(clientSecretKey, session.remotePubkey);
    const request = finalizeEvent(
      {
        kind: NOSTR_CONNECT_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["p", session.remotePubkey]],
        content: encrypt(
          JSON.stringify({
            id,
            method: "sign_event",
            params: [JSON.stringify(template)],
          }),
          key,
        ),
      },
      clientSecretKey,
    );
    Promise.any(p.publish(session.relays, request)).catch(() =>
      reject(new NostrConnectError("relay")),
    );
    return stop;
  });
}

/** 覚えている接続。形が崩れていたら無いものとして扱う */
export function loadSavedSession(): NostrConnectSession | null {
  try {
    const raw = localStorage.getItem(SAVED_SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<NostrConnectSession>;
    if (
      typeof s.clientSecretKey === "string" &&
      typeof s.remotePubkey === "string" &&
      Array.isArray(s.relays) &&
      s.relays.length > 0
    ) {
      return {
        clientSecretKey: s.clientSecretKey,
        remotePubkey: s.remotePubkey,
        relays: s.relays,
      };
    }
  } catch {
    /* 読めなければ覚えていないのと同じ */
  }
  return null;
}

export function saveSession(session: NostrConnectSession): void {
  localStorage.setItem(SAVED_SESSION_KEY, JSON.stringify(session));
}

export function clearSavedSession(): void {
  localStorage.removeItem(SAVED_SESSION_KEY);
}
