import { api } from "../api/client.js";

interface Nip07 {
  getPublicKey(): Promise<string>;
  signEvent(event: {
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
  }): Promise<unknown>;
}

export function hasNip07(): boolean {
  return Boolean((window as { nostr?: Nip07 }).nostr);
}

const PROFILE_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://yabu.me",
  "wss://r.kojira.io",
];

interface RelayEvent {
  kind: number;
  created_at: number;
  [k: string]: unknown;
}

/** 複数リレーから kind:0（プロフィール）の最新イベントを取得（タイムアウト付き） */
function fetchLatestKind0(
  pubkey: string,
  timeoutMs = 3000,
): Promise<RelayEvent | null> {
  return new Promise((resolve) => {
    let best: RelayEvent | null = null;
    let finished = 0;
    let settled = false;
    const sockets: WebSocket[] = [];
    const done = () => {
      if (settled) return;
      settled = true;
      for (const ws of sockets) {
        try {
          ws.close();
        } catch {
          /* noop */
        }
      }
      resolve(best);
    };
    const timer = setTimeout(done, timeoutMs);
    const onFinish = () => {
      finished += 1;
      if (finished >= sockets.length) {
        clearTimeout(timer);
        done();
      }
    };
    for (const url of PROFILE_RELAYS) {
      try {
        const ws = new WebSocket(url);
        sockets.push(ws);
        ws.onopen = () =>
          ws.send(
            JSON.stringify([
              "REQ",
              "p0",
              { kinds: [0], authors: [pubkey], limit: 1 },
            ]),
          );
        ws.onmessage = (m) => {
          try {
            const d = JSON.parse(m.data as string);
            if (d[0] === "EVENT" && d[2]?.kind === 0) {
              const ev = d[2] as RelayEvent;
              if (!best || ev.created_at > best.created_at) best = ev;
            } else if (d[0] === "EOSE") {
              ws.close();
              onFinish();
            }
          } catch {
            /* 不正メッセージは無視 */
          }
        };
        ws.onerror = () => {
          try {
            ws.close();
          } catch {
            /* noop */
          }
          onFinish();
        };
      } catch {
        /* WebSocket 構築失敗は無視 */
      }
    }
    if (sockets.length === 0) done();
  });
}

/** リレーから自分の kind:0 を取ってサーバーに反映（失敗しても致命ではない） */
async function syncNostrProfile(pubkey: string): Promise<void> {
  try {
    const event = await fetchLatestKind0(pubkey);
    if (event) await api.post("/auth/nostr/profile", { event });
  } catch {
    /* プロフィール補完はベストエフォート */
  }
}

/** ログインのお題に署名するもの。NIP-07 の拡張でも、署名アプリ（NIP-46）でもよい */
export type LoginEventSigner = (template: {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}) => Promise<unknown>;

/** ログインのお題（kind:22242）の雛形。pubkey は署名器が埋める */
export function loginEventTemplate(challenge: string) {
  return {
    kind: 22242,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["relay", window.location.origin],
      ["challenge", challenge],
    ],
    content: "events lab にログイン",
  };
}

/** お題を取る（使うと消える nonce。10分で切れる） */
export async function fetchLoginChallenge(): Promise<string> {
  const { challenge } = await api.get<{ challenge: string }>(
    "/auth/nostr/challenge",
  );
  return challenge;
}

/**
 * 署名済みのお題をサーバーに送る（ログイン中なら連携になる）。
 * 通ったら、リレーから kind:0 を取得して表示名/アイコンを補完する。
 */
export async function submitSignedLoginEvent(event: {
  pubkey?: string;
}): Promise<void> {
  await api.post("/auth/nostr/login", { event });
  if (event.pubkey) await syncNostrProfile(event.pubkey);
}

/**
 * Nostr でログイン or 連携する（どの署名器でも同じ）。
 * チャレンジ取得 → kind:22242 に署名 → サーバー検証。
 */
export async function signLoginChallenge(
  sign: LoginEventSigner,
): Promise<void> {
  const challenge = await fetchLoginChallenge();
  const event = (await sign(loginEventTemplate(challenge))) as {
    pubkey?: string;
  };
  await submitSignedLoginEvent(event);
}

/**
 * NIP-07 拡張（Alby / nos2x 等）でログイン or 連携。
 * 拡張が無い場合は "no_extension" を投げる。
 */
export async function nostrNip07Login(): Promise<void> {
  const nostr = (window as { nostr?: Nip07 }).nostr;
  if (!nostr) throw new Error("no_extension");
  await signLoginChallenge((template) => nostr.signEvent(template));
}
