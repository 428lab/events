import { Relay } from "nostr-tools/relay";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
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

/**
 * 読み取り専用の使い捨て署名器 (#215)。投影用画面のように「参加せずに読むだけ」の
 * 画面で、リレーの NIP-42 AUTH に応答するためだけに使う。
 * この鍵で発言することはない（投影用画面には入力欄が無い）ので、
 * サーバーにも localStorage にも残さず、その場で作って捨てる。
 */
export function randomLocalSigner(): ChatSigner {
  const secretKey = generateSecretKey();
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
/** 接続試行のタイムアウト（nostr-tools はデフォルト無制限のため必須） */
const CONNECT_TIMEOUT_MS = 8_000;
/** 再購読時に since から引くマージン。投稿者の時計ずれで
 * created_at が過去になったイベントの取りこぼし防止（重複はIDで排除） */
const RESUBSCRIBE_MARGIN_SEC = 300;
/** 重複排除の記憶件数の上限 (#215)。投影用画面は何時間もつけっぱなしにするので、
 * 際限なく貯めると Set がそのまま増え続ける。超えたら古いものから捨てる
 * （直近の再購読ぶんが残っていれば取りこぼしは起きない） */
const SEEN_MAX = 2_000;

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
  /** 接続試行中のURL（pending中の watchdog/publish からの二重接続防止） */
  private connecting = new Set<string>();
  private sub: SubState | null = null;
  /** 接続状態が変わったら呼ばれる（UI のステータス表示用） */
  onstatus: (() => void) | null = null;

  constructor(
    private signer: ChatSigner,
    private relayUrls: readonly string[] = CHAT_RELAYS,
  ) {}

  /** 全リレーへ接続（失敗したリレーはスキップ。1つも繋がらなくても throw しない） */
  async connect(): Promise<void> {
    if (this.watchdog) return; // 再入ガード（intervalのリーク防止）
    // タイマー取りこぼしの保険。onclose が飛ばないゾンビ接続は
    // enablePing（無応答なら nostr-tools が ws.close → onclose）で検知する
    this.watchdog = setInterval(() => {
      if (this.closed) return;
      for (const url of this.relayUrls) {
        if (!this.relays.get(url)?.connected) this.scheduleReconnect(url);
      }
    }, WATCHDOG_INTERVAL_MS);
    await Promise.all(this.relayUrls.map((url) => this.connectOne(url)));
  }

  private async connectOne(url: string): Promise<void> {
    if (
      this.closed ||
      this.connecting.has(url) ||
      this.relays.get(url)?.connected
    ) {
      return;
    }
    this.connecting.add(url);
    try {
      // static Relay.connect は timeout を渡せないためインスタンス経由で接続する。
      // enablePing: 無応答接続を検知して onclose 経由の再接続に乗せる (#225)
      const relay = new Relay(url, { enablePing: true });
      await relay.connect({ timeout: CONNECT_TIMEOUT_MS });
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
      // 置き換え前の旧インスタンスが開いたままならリークするので閉じる
      const prev = this.relays.get(url);
      if (prev && prev !== relay) {
        try {
          prev.close();
        } catch {
          /* noop */
        }
      }
      this.relays.set(url, relay);
      this.backoffMs.set(url, 0);
      this.onstatus?.();
      // 購読中なら新しい接続に購読を張り直す
      if (this.sub) this.subscribeOne(url, relay);
    } catch {
      // 接続失敗はバックオフ付きで再試行（もう一方のリレーで継続）
      this.onstatus?.();
      this.scheduleReconnect(url);
    } finally {
      this.connecting.delete(url);
    }
  }

  private scheduleReconnect(url: string): void {
    if (this.closed || this.timers.has(url) || this.connecting.has(url)) return;
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
   * since（最終受信時刻−マージン）付きで張り直す。戻り値は購読停止関数。
   * 契約: 同時に持てる購読は1つ（再呼び出しは前の購読を置き換える）。
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
    sub.closers.delete(url);
    const filter: {
      kinds: number[];
      "#e": string[];
      limit: number;
      since?: number;
    } = { kinds: [42], "#e": [sub.channelId], limit: 200 };
    // 再購読は受信済み時刻−マージンから再開（投稿者の時計ずれで created_at が
    // 過去のイベントも取りこぼさない。重なった分はIDで重複排除される）
    if (sub.lastSeen > 0) {
      filter.since = Math.max(0, sub.lastSeen - RESUBSCRIBE_MARGIN_SEC);
    }
    // AUTH後も auth-required を返し続ける行儀の悪いリレーでの無限再購読防止
    let authRetries = 0;
    const start = () => {
      const s = relay.subscribe([filter], {
        onevent: (ev) => {
          if (sub.seen.has(ev.id)) return;
          sub.seen.add(ev.id);
          // Set は挿入順に反復するので、あふれた分は古い側から捨てられる
          if (sub.seen.size > SEEN_MAX) {
            for (const id of sub.seen) {
              sub.seen.delete(id);
              if (sub.seen.size <= SEEN_MAX / 2) break;
            }
          }
          if (ev.created_at > sub.lastSeen) sub.lastSeen = ev.created_at;
          sub.onEvent(ev);
        },
        onclose: (reason) => {
          // 読み取りにも AUTH を要求するリレー: 認証してから再購読
          if (
            reason.startsWith("auth-required:") &&
            !this.closed &&
            this.sub === sub &&
            relay.connected &&
            authRetries < 3
          ) {
            authRetries++;
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
