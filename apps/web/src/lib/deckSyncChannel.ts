import { v2 } from "nostr-tools/nip44";
import { verifyEvent, type Event as NostrEvent, type EventTemplate } from "nostr-tools/pure";
import { DECK_SYNC_KIND, type DeckOp, type DeckSyncConfig } from "@eventer/shared";
import { ChatRelayPool, randomLocalSigner, type ChatSigner } from "./nostrChat.js";
import { parseDeckOp } from "./deckSync.js";

/**
 * チームのスライドの同時編集の「送り方」（docs/team-deck-live-sync.md §6）。
 *
 * - `signalHub` とは別の、同期専用の接続。タブの使い捨て鍵で署名し、AUTH にも同じ鍵で応じる（NIP-70）
 * - 中身は NIP-44 v2 で、サーバーが配る今の世代の鍵で暗号化する。鍵を持たない人は読めない
 * - kind 21078、`["t", topic]`・`["v", version]`・`["-"]`。`created_at` は壁時計
 * - 受け取った差分は形だけ確かめる（§8。手元の状態は見ない）
 */

/** 暗号化前の大きさの目安。超えたら op の切れ目で分ける（§6.4） */
export const DECK_SYNC_BATCH_BYTES = 32_000;
/** 1つの op だけでこれを超えたら送らず、取り直しを頼む */
export const DECK_SYNC_OP_MAX_BYTES = 60_000;
/** 暗号文の上限。超えたものは復号しない */
export const DECK_SYNC_CIPHERTEXT_MAX = 90_000;
/** 1つの送り手から 1 秒に当てる件数の上限（§6.4） */
const RECEIVE_PER_SECOND = 20;

/** 送り合う1件の中身（§5.3） */
export interface DeckSyncBatch {
  v: number;
  clientId: string;
  userId: string;
  name: string;
  ops: DeckOp[];
  /** 自分では送れない大きさの op があった。受け取った側は1回取り直す */
  refetch?: boolean;
}

function keyBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const encoder = new TextEncoder();
const byteLength = (s: string) => encoder.encode(s).length;

/**
 * op を、暗号化前の大きさが上限に収まるバッチに分ける。1つで大きすぎる op は外して
 * `refetch: true` の空バッチに置き換える（受け取った側が取り直す）。
 */
export function chunkDeckOps(head: Omit<DeckSyncBatch, "ops" | "refetch">, ops: readonly DeckOp[]): DeckSyncBatch[] {
  const out: DeckSyncBatch[] = [];
  let current: DeckOp[] = [];
  let size = byteLength(JSON.stringify({ ...head, ops: [] }));
  const base = size;
  let tooLarge = false;
  for (const op of ops) {
    const n = byteLength(JSON.stringify(op)) + 1;
    if (n > DECK_SYNC_OP_MAX_BYTES) {
      tooLarge = true;
      continue;
    }
    if (current.length > 0 && size + n > DECK_SYNC_BATCH_BYTES) {
      out.push({ ...head, ops: current });
      current = [];
      size = base;
    }
    current.push(op);
    size += n;
  }
  if (current.length > 0) out.push({ ...head, ops: current });
  if (tooLarge) out.push({ ...head, ops: [], refetch: true });
  return out;
}

/** 受け取ったイベントを確かめて開く。開けないものは null（取り残し・別の鍵・壊れたもの） */
export function openDeckSyncEvent(
  ev: NostrEvent,
  config: Pick<DeckSyncConfig, "topic" | "key">,
  now: number,
): DeckSyncBatch | null {
  if (ev.kind !== DECK_SYNC_KIND) return null;
  if (!ev.tags.some((t) => t[0] === "t" && t[1] === config.topic)) return null;
  if (ev.content.length > DECK_SYNC_CIPHERTEXT_MAX) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(v2.decrypt(ev.content, keyBytes(config.key.secret)));
  } catch {
    return null;
  }
  if (!verifyEvent(ev)) return null;
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  if (b.v !== config.key.version) return null;
  if (typeof b.clientId !== "string" || b.clientId.length < 1 || b.clientId.length > 32) return null;
  if (typeof b.userId !== "string" || typeof b.name !== "string" || !Array.isArray(b.ops)) return null;
  const ops: DeckOp[] = [];
  for (const o of b.ops) {
    const op = parseDeckOp(o, now);
    // 1つでも形が違えばバッチごと捨てる（同じバッチ内の順番に頼る op があるため）
    if (!op) return null;
    ops.push(op);
  }
  return {
    v: b.v as number,
    clientId: b.clientId,
    userId: b.userId.slice(0, 64),
    name: b.name.slice(0, 64),
    ops,
    refetch: b.refetch === true,
  };
}

export function sealDeckSyncBatch(batch: DeckSyncBatch, config: Pick<DeckSyncConfig, "topic" | "key">): EventTemplate {
  return {
    kind: DECK_SYNC_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["t", config.topic], ["v", String(config.key.version)], ["-"]],
    content: v2.encrypt(JSON.stringify(batch), keyBytes(config.key.secret)),
  };
}

/** 送り手（clientId）ごとに 1 秒あたりの件数を数える。超えたら false */
export function createReceiveLimiter(limit = RECEIVE_PER_SECOND) {
  const windows = new Map<string, { at: number; n: number }>();
  return (clientId: string, now: number): boolean => {
    const w = windows.get(clientId);
    if (!w || now - w.at >= 1000) {
      windows.set(clientId, { at: now, n: 1 });
      if (windows.size > 200) windows.delete(windows.keys().next().value!);
      return true;
    }
    w.n += 1;
    return w.n <= limit;
  };
}

/** 送受信の口。テストでは差し替える */
export interface DeckSyncTransport {
  /** topic を購読する。since は秒 */
  subscribe: (topic: string, since: number, onEvent: (ev: NostrEvent) => void) => () => void;
  publish: (template: EventTemplate) => Promise<boolean>;
  connected: () => boolean;
  onStatus: (cb: () => void) => void;
  close: () => void;
}

/** 同期専用の接続（§6.1）。タブの使い捨て鍵で署名し、AUTH も同じ鍵で応じる */
export function relayTransport(relays: readonly string[], signer: ChatSigner = randomLocalSigner()): DeckSyncTransport {
  const pool = new ChatRelayPool(signer, relays);
  void pool.connect();
  return {
    subscribe: (topic, since, onEvent) => pool.subscribeTopic(DECK_SYNC_KIND, topic, since, onEvent),
    publish: async (template) => pool.publish(await signer.signEvent(template)),
    connected: () => pool.connected,
    onStatus: (cb) => {
      pool.onstatus = cb;
    },
    close: () => pool.close(),
  };
}
