import { Relay } from "nostr-tools/relay";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import type {
  Event as NostrEvent,
  EventTemplate,
  VerifiedEvent,
} from "nostr-tools/pure";
import { CHAT_CHANNEL_ABOUT, CHAT_RELAYS } from "@eventer/shared";

/**
 * Nostrイベントチャット (#199) の薄いラッパー。
 * - ブラウザ⇔リレー直通（サーバーはチャット本文を経由しない）
 * - NIP-28: kind:40 でチャンネル作成、kind:42 でメッセージ
 * - NIP-70 は不採用（strfry がコアで protected イベントを拒否するため）。
 *   封じ込めは「書き込みは自リレー2台限定＋NIP-42 AUTH」で担保する
 * - NIP-42: リレーの AUTH チャレンジに投稿と同じ鍵で署名して応答する
 */

/** 発言・AUTH に使う署名器（NIP-07 拡張 or ローカル一時鍵） */
export interface ChatSigner {
  pubkey: string;
  signEvent(template: EventTemplate): Promise<VerifiedEvent>;
}

interface Nip07Like {
  getPublicKey(): Promise<string>;
  signEvent(event: {
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
  }): Promise<unknown>;
}

/* ===== 鍵の管理 ===== */

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** 一時鍵（hex秘密鍵）で署名する署名器。
 * 一時鍵はサーバーが生成・保管し API で配布する (#223)。localStorage には置かない */
export function localSignerFromHex(secretHex: string): ChatSigner {
  const secretKey = hexToBytes(secretHex);
  return {
    pubkey: getPublicKey(secretKey),
    signEvent: async (template) => finalizeEvent(template, secretKey),
  };
}

/** NIP-07 拡張（Alby / nos2x 等）で署名する署名器。拡張が無ければ例外 */
export async function nip07Signer(): Promise<ChatSigner> {
  const nostr = (window as { nostr?: Nip07Like }).nostr;
  if (!nostr) throw new Error("no_extension");
  const pubkey = await nostr.getPublicKey();
  return {
    pubkey,
    signEvent: async (template) =>
      (await nostr.signEvent(template)) as VerifiedEvent,
  };
}

/* ===== イベント（Nostrイベント）の組み立て（純粋関数） ===== */

/** NIP-28 チャンネル作成（kind:40） */
/** 鍵の所有証明イベント (#199)。サーバーのchallengeに専用kindで署名する */
export const CHAT_KEY_PROOF_KIND = 27888;
export function buildChatKeyProofTemplate(
  challenge: string,
  eventerEventId: string,
): EventTemplate {
  return {
    kind: CHAT_KEY_PROOF_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["purpose", "eventer-chat-key"],
      ["eventer-event", eventerEventId],
      ["challenge", challenge],
    ],
    content: "",
  };
}

export function buildChannelCreateTemplate(eventTitle: string): EventTemplate {
  return {
    kind: 40,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: JSON.stringify({
      name: eventTitle,
      about: CHAT_CHANNEL_ABOUT,
    }),
  };
}

/** NIP-28 チャンネルメッセージ（kind:42）。relayHint は e タグに載せる推奨リレー */
export function buildChannelMessageTemplate(
  channelId: string,
  content: string,
  relayHint: string = CHAT_RELAYS[0],
): EventTemplate {
  return {
    kind: 42,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["e", channelId, relayHint, "root"]],
    content,
  };
}

/* ===== リレー接続 ===== */

export interface ChatRelayStatus {
  url: string;
  connected: boolean;
}

/** 購読の状態（再接続時の張り直しに使う） */
interface SubState {
  channelId: string;
  onEvent: (ev: NostrEvent) => void;
  /** リレー間・再購読間の重複排除（イベントID） */
  seen: Set<string>;
  /** 受信済みの最新 created_at。再購読時は since に使う */
  lastSeen: number;
  /** リレーURL → 購読停止関数 */
  closers: Map<string, () => void>;
}

const RECONNECT_MIN_MS = 3_000;
const RECONNECT_MAX_MS = 30_000;
const WATCHDOG_INTERVAL_MS = 15_000;

/**
 * 複数リレーへの接続・購読・発行をまとめる。リレーURLは運用設定
 * （chat-members の relays）から渡し、未取得時は既定の CHAT_RELAYS。
 * ライフサイクルは呼び出し側（コンポーネント）が持ち、unmount 時に close() すること。
 *
 * 再接続はプール自前で行う (#225)。nostr-tools の enableReconnect は
 * 確立済み接続が onerror 経由で切れると skipReconnection が立って
 * 以後再接続しないため使わない。切断は onclose＋死活監視で検知し、
 * バックオフ付きで張り直し、購読も since 付きで再開する。
 */
export class ChatRelayPool {
  private relays = new Map<string, Relay>();
  private closed = false;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private backoffMs = new Map<string, number>();
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private sub: SubState | null = null;
  /** 接続状態が変わったら呼ばれる（UI のステータス表示用） */
  onstatus: (() => void) | null = null;

  constructor(
    private signer: ChatSigner,
    private relayUrls: readonly string[] = CHAT_RELAYS,
  ) {}

  /** 全リレーへ接続（失敗したリレーはスキップ。1つも繋がらなくても throw しない） */
  async connect(): Promise<void> {
    // onclose が飛ばない形の切断（スリープ復帰等）も拾う死活監視
    this.watchdog = setInterval(() => {
      if (this.closed) return;
      for (const url of this.relayUrls) {
        if (!this.relays.get(url)?.connected) this.scheduleReconnect(url);
      }
    }, WATCHDOG_INTERVAL_MS);
    await Promise.all(this.relayUrls.map((url) => this.connectOne(url)));
  }

  private async connectOne(url: string): Promise<void> {
    if (this.closed || this.relays.get(url)?.connected) return;
    try {
      const relay = await Relay.connect(url);
      if (this.closed) {
        relay.close();
        return;
      }
      // NIP-42: AUTH チャレンジには投稿と同じ鍵（kind:22242）で自動応答する
      relay.onauth = (template) => this.signer.signEvent(template);
      relay.onclose = () => {
        this.onstatus?.();
        this.scheduleReconnect(url);
      };
      this.relays.set(url, relay);
      this.backoffMs.set(url, 0);
      this.onstatus?.();
      // 購読中なら新しい接続に購読を張り直す
      if (this.sub) this.subscribeOne(url, relay);
    } catch {
      // 接続失敗はバックオフ付きで再試行（もう一方のリレーで継続）
      this.onstatus?.();
      this.scheduleReconnect(url);
    }
  }

  private scheduleReconnect(url: string): void {
    if (this.closed || this.timers.has(url)) return;
    if (this.relays.get(url)?.connected) return;
    const prev = this.backoffMs.get(url) ?? 0;
    const delay =
      prev === 0 ? RECONNECT_MIN_MS : Math.min(prev * 2, RECONNECT_MAX_MS);
    this.backoffMs.set(url, delay);
    this.timers.set(
      url,
      setTimeout(() => {
        this.timers.delete(url);
        void this.connectOne(url);
      }, delay),
    );
  }

  statuses(): ChatRelayStatus[] {
    return this.relayUrls.map((url) => ({
      url,
      connected: this.relays.get(url)?.connected ?? false,
    }));
  }

  /** 1つ以上のリレーに接続できているか */
  get connected(): boolean {
    return this.statuses().some((s) => s.connected);
  }

  /**
   * チャンネルの kind:42 を購読する（履歴 limit 200＋新着）。
   * リレー間・再購読間の重複はイベントIDで除去。再接続時は自動で
   * since（最終受信時刻）付きで張り直す。戻り値は購読停止関数。
   */
  subscribe(channelId: string, onEvent: (ev: NostrEvent) => void): () => void {
    const sub: SubState = {
      channelId,
      onEvent,
      seen: new Set(),
      lastSeen: 0,
      closers: new Map(),
    };
    this.sub = sub;
    for (const [url, relay] of this.relays) {
      if (relay.connected) this.subscribeOne(url, relay);
    }
    return () => {
      if (this.sub === sub) this.sub = null;
      for (const close of sub.closers.values()) {
        try {
          close();
        } catch {
          /* noop */
        }
      }
    };
  }

  private subscribeOne(url: string, relay: Relay): void {
    const sub = this.sub;
    if (!sub) return;
    // 同一URLの旧購読（切断前の接続のもの）は閉じる
    try {
      sub.closers.get(url)?.();
    } catch {
      /* noop */
    }
    const filter: {
      kinds: number[];
      "#e": string[];
      limit: number;
      since?: number;
    } = { kinds: [42], "#e": [sub.channelId], limit: 200 };
    // 再購読では受信済み時刻から再開（同時刻の取りこぼし防止に -1 せず、IDで重複排除）
    if (sub.lastSeen > 0) filter.since = sub.lastSeen;
    const start = () => {
      const s = relay.subscribe([filter], {
        onevent: (ev) => {
          if (sub.seen.has(ev.id)) return;
          sub.seen.add(ev.id);
          if (ev.created_at > sub.lastSeen) sub.lastSeen = ev.created_at;
          sub.onEvent(ev);
        },
        onclose: (reason) => {
          // 読み取りにも AUTH を要求するリレー: 認証してから再購読
          if (
            reason.startsWith("auth-required:") &&
            !this.closed &&
            this.sub === sub &&
            relay.connected
          ) {
            relay
              .auth((t) => this.signer.signEvent(t))
              .then(() => {
                if (!this.closed && this.sub === sub) start();
              })
              .catch(() => undefined);
          }
        },
      });
      sub.closers.set(url, () => s.close());
    };
    try {
      start();
    } catch {
      // 切断中のリレーはスキップ（再接続時に張り直される）
    }
  }

  /**
   * 署名済みイベントを全リレーへ発行する。auth-required で拒否されたら
   * NIP-42 AUTH を行ってからリトライ。全リレー切断なら即時再接続を試み、
   * もう一度だけ発行し直す。1つ以上のリレーが受理したら true。
   * （サーバー署名の公式イベントも通すため VerifiedEvent ではなく NostrEvent）
   */
  async publish(event: NostrEvent): Promise<boolean> {
    const attempt = async (): Promise<boolean> => {
      const results = await Promise.all(
        [...this.relays.values()].map(async (relay) => {
          if (!relay.connected) return false;
          try {
            await relay.publish(event);
            return true;
          } catch (err) {
            if (
              err instanceof Error &&
              err.message.startsWith("auth-required:")
            ) {
              try {
                await relay.auth((t) => this.signer.signEvent(t));
                await relay.publish(event);
                return true;
              } catch {
                return false;
              }
            }
            return false;
          }
        }),
      );
      return results.some(Boolean);
    };
    if (await attempt()) return true;
    if (this.closed) return false;
    // 全滅していたら即時再接続してから1回だけリトライ (#225)
    await Promise.all(this.relayUrls.map((url) => this.connectOne(url)));
    return attempt();
  }

  close(): void {
    this.closed = true;
    if (this.watchdog) clearInterval(this.watchdog);
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const relay of this.relays.values()) {
      try {
        relay.close();
      } catch {
        /* noop */
      }
    }
    this.relays.clear();
    this.sub = null;
  }
}
