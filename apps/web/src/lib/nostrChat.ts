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
import { CHAT_RELAYS } from "@eventer/shared";

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

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function chatKeyStorageKey(eventId: string): string {
  return `eventer:chatkey:${eventId}`;
}

/** イベント用の一時鍵を localStorage から読む（無ければ null） */
export function loadLocalChatKey(eventId: string): Uint8Array | null {
  const hex = localStorage.getItem(chatKeyStorageKey(eventId));
  return hex && /^[0-9a-f]{64}$/.test(hex) ? hexToBytes(hex) : null;
}

/** イベント用の一時鍵を読み込み（無ければ生成して保存） */
export function loadOrCreateLocalChatKey(eventId: string): Uint8Array {
  const existing = loadLocalChatKey(eventId);
  if (existing) return existing;
  const sk = generateSecretKey();
  localStorage.setItem(chatKeyStorageKey(eventId), bytesToHex(sk));
  return sk;
}

/** ローカル一時鍵で署名する署名器 */
export function localSigner(secretKey: Uint8Array): ChatSigner {
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
      about: "events lab のイベントチャット",
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

/**
 * 複数リレーへの接続・購読・発行をまとめる。リレーURLは運用設定
 * （chat-members の relays）から渡し、未取得時は既定の CHAT_RELAYS。
 * ライフサイクルは呼び出し側（コンポーネント）が持ち、unmount 時に close() すること。
 */
export class ChatRelayPool {
  private relays = new Map<string, Relay>();
  private closed = false;
  /** 接続状態が変わったら呼ばれる（UI のステータス表示用） */
  onstatus: (() => void) | null = null;

  constructor(
    private signer: ChatSigner,
    private relayUrls: readonly string[] = CHAT_RELAYS,
  ) {}

  /** 全リレーへ接続（失敗したリレーはスキップ。1つも繋がらなくても throw しない） */
  async connect(): Promise<void> {
    await Promise.all(
      this.relayUrls.map(async (url) => {
        try {
          const relay = await Relay.connect(url, { enableReconnect: true });
          if (this.closed) {
            relay.close();
            return;
          }
          // NIP-42: AUTH チャレンジには投稿と同じ鍵（kind:22242）で自動応答する
          relay.onauth = (template) => this.signer.signEvent(template);
          relay.onclose = () => this.onstatus?.();
          this.relays.set(url, relay);
          this.onstatus?.();
        } catch {
          // 接続失敗はステータス表示に任せる（もう一方のリレーで継続）
          this.onstatus?.();
        }
      }),
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
   * リレー間の重複はイベントIDで除去。購読が auth-required で閉じられたら
   * AUTH 後に再購読する。戻り値は購読停止関数。
   */
  subscribe(channelId: string, onEvent: (ev: NostrEvent) => void): () => void {
    const seen = new Set<string>();
    const closers: (() => void)[] = [];
    const filter = { kinds: [42], "#e": [channelId], limit: 200 };
    for (const relay of this.relays.values()) {
      const start = () => {
        const sub = relay.subscribe([filter], {
          onevent: (ev) => {
            if (seen.has(ev.id)) return;
            seen.add(ev.id);
            onEvent(ev);
          },
          onclose: (reason) => {
            // 読み取りにも AUTH を要求するリレー: 認証してから再購読
            if (reason.startsWith("auth-required:") && !this.closed) {
              relay
                .auth((t) => this.signer.signEvent(t))
                .then(() => {
                  if (!this.closed) start();
                })
                .catch(() => undefined);
            }
          },
        });
        closers.push(() => sub.close());
      };
      try {
        start();
      } catch {
        // 切断中のリレーはスキップ
      }
    }
    return () => {
      for (const close of closers) {
        try {
          close();
        } catch {
          /* noop */
        }
      }
    };
  }

  /**
   * 署名済みイベントを全リレーへ発行する。auth-required で拒否されたら
   * NIP-42 AUTH を行ってからリトライ。1つ以上のリレーが受理したら true。
   */
  async publish(event: VerifiedEvent): Promise<boolean> {
    const results = await Promise.all(
      [...this.relays.values()].map(async (relay) => {
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
  }

  close(): void {
    this.closed = true;
    for (const relay of this.relays.values()) {
      try {
        relay.close();
      } catch {
        /* noop */
      }
    }
    this.relays.clear();
  }
}
