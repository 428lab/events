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
 * - NIP-70 (#460): リレーへ発行するイベントには `["-"]` タグを付け、
 *   第三者による他リレーへの持ち込みを対応リレーが拒否する
 *   （docs/nip70-protected-chat.md）。封じ込めは「書き込みは自リレー限定＋
 *   NIP-42 AUTH」に加えて、この protected 宣言で担保する
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
    // NIP-70 (#460): 著者本人の AUTH 済み接続以外からの持ち込みを拒否させる
    tags: [["-"]],
    content: JSON.stringify({
      name: eventTitle,
      about: CHAT_CHANNEL_ABOUT,
    }),
  };
}

/** NIP-28 チャンネルメッセージ（kind:42）。relayHint は e タグに載せる推奨リレー。
 * kind はスタッフチャット (#382) が独自 kind（GROUP_CHAT_KIND）で同じ形を使うため
 * 引数化してある（既定は 42。既存の呼び出しは無変更） */
export function buildChannelMessageTemplate(
  channelId: string,
  content: string,
  relayHint: string = CHAT_RELAYS[0],
  kind: number = 42,
): EventTemplate {
  return {
    kind,
    created_at: Math.floor(Date.now() / 1000),
    // NIP-70 の ["-"] は kind:42 とスタッフチャット (#382 GROUP_CHAT_KIND) の
    // 両方にここ1か所で付く（sealStaffChatMessage も この builder を通る）
    tags: [
      ["e", channelId, relayHint, "root"],
      ["-"],
    ],
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
  /** 購読する kind（既定 42。スタッフチャット #382 は独自 kind） */
  kind: number;
  onEvent: (ev: NostrEvent) => void;
  /** リレー間・再購読間の重複排除（イベントID） */
  seen: Set<string>;
  /** 受信済みの最新 created_at。再購読時は since に使う */
  lastSeen: number;
  /** リレーURL → 購読停止関数 */
  closers: Map<string, () => void>;
}

/**
 * リレー1本ぶんの AUTH の状態 (#464)。
 *
 * nostr-tools はリレーから `["AUTH", challenge]` が届くと**自分で** `onauth` を
 * 呼んで `authPromise` を作り込む。つまり AUTH の入り口は「こちらから
 * `authenticate()` を呼ぶ」場合と「リレーの都合で始まる」場合の2つあり、
 * どちらから入っても署名器の失敗がここに集まるようにする。集めないと、
 * 先に始まったほうの promise を待つだけになって期限も例外も効かない。
 */
interface AuthState {
  /** 署名器が失敗した理由（拒否・時間切れ）。入っていればこの接続では
   * もう AUTH できない（nostr-tools が失敗した authPromise を使い回すため） */
  failure: Error | null;
  /** 失敗を待っている `authenticate()` への通知 */
  listeners: Set<(err: Error) => void>;
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

const RECONNECT_MIN_MS = 3_000;
const RECONNECT_MAX_MS = 30_000;
const WATCHDOG_INTERVAL_MS = 15_000;
/** 接続試行のタイムアウト（nostr-tools はデフォルト無制限のため必須） */
const CONNECT_TIMEOUT_MS = 8_000;
/**
 * AUTH イベントの**署名**を待つ上限 (#464)。人が拡張の署名ダイアログを操作する
 * 時間なので、接続や EVENT の待ち（nostr-tools 既定 4.4 秒）より長く取る。
 *
 * 期限を署名の段だけに掛けるのは、リレーとの往復には nostr-tools 自身の
 * `publishTimeout` が既に効いているため（`auth()` は署名が返ってから
 * そのタイマーを張る）。両方を覆う1本のタイマーで囲うと、遅れて承認された
 * 署名を「もう手遅れ」と切ってしまう。段ごとに順番に期限を持たせる。
 *
 * nostr-tools 2.24.1 の `relay.auth()` は署名器が投げたときに resolve も reject も
 * せず、その promise を `authPromise` として使い回す（abstract-relay.js の
 * `catch { console.warn(...) }`）。NIP-70 (#460) で全発言が protected になり
 * AUTH が毎回走るようになったため、NIP-07 の署名を拒否・放置されると
 * `publish` がそのまま永久に待ち、送信が成功とも失敗とも表示されなくなる。
 */
const AUTH_SIGN_TIMEOUT_MS = 15_000;
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
  /** リレーごとの AUTH の状態 (#464)。接続を張り直せば新しい Relay になり、
   * nostr-tools の authPromise ごと state も作り直される */
  private authStates = new WeakMap<Relay, AuthState>();
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
      // NIP-42: AUTH チャレンジには投稿と同じ鍵（kind:22242）で自動応答する。
      // リレー発の AUTH もこちら発の AUTH も署名は signAuth 1 か所を通す (#464)
      relay.onauth = (template) => this.signAuth(relay, template);
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

  private authState(relay: Relay): AuthState {
    let state = this.authStates.get(relay);
    if (!state) {
      state = { failure: null, listeners: new Set() };
      this.authStates.set(relay, state);
    }
    return state;
  }

  /** この接続では以後 AUTH できないことを記録し、待っている人に知らせる (#464) */
  private markAuthFailed(relay: Relay, err: Error): void {
    const state = this.authState(relay);
    if (!state.failure) state.failure = err;
    for (const notify of [...state.listeners]) notify(state.failure);
  }

  /**
   * AUTH イベント（kind:22242）に署名する。AUTH の入り口はリレー発
   * （nostr-tools が `onauth` を呼ぶ）とこちら発（`authenticate`）の2つあるが、
   * 署名はどちらもここを通るので、期限と失敗の記録はこの1か所で済む (#464)。
   *
   * nostr-tools はここで投げた例外を握り潰して promise を宙吊りにするので、
   * 投げる前に `markAuthFailed` で待っている人に知らせる。
   */
  private async signAuth(
    relay: Relay,
    template: EventTemplate,
  ): Promise<VerifiedEvent> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("auth_sign_timeout")),
        AUTH_SIGN_TIMEOUT_MS,
      );
    });
    try {
      return await Promise.race([this.signer.signEvent(template), timedOut]);
    } catch (err) {
      // 拒否は即座に、放置は期限で。どちらもこの接続を使えなくする
      this.markAuthFailed(relay, toError(err));
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * NIP-42 AUTH を待つ (#464)。成功で resolve、拒否・時間切れ・リレーの拒絶で
   * reject する。AUTH を待つ場所（publish の auth-required リトライ、購読の
   * 張り直し）はすべてここを通す。
   *
   * `relay.auth()` は先に始まっている AUTH があればその promise を返すだけなので、
   * 署名の失敗は `signAuth` からの通知で受け取る（この経路が無いと、リレー発の
   * AUTH が先に走ったときに宙吊りの promise をただ待つことになる）。
   * リレーとの往復の期限は nostr-tools 側の `publishTimeout` が持つ。
   */
  private authenticate(relay: Relay): Promise<void> {
    const state = this.authState(relay);
    // 一度断られた接続は nostr-tools が失敗した authPromise を使い回すので、
    // 署名を求め直すことすらできない。待たずに失敗させる（張り直しは publish 側）
    if (state.failure) return Promise.reject(state.failure);
    let listener: (err: Error) => void = () => {};
    const signerFailed = new Promise<never>((_, reject) => {
      listener = reject;
      state.listeners.add(listener);
    });
    return Promise.race([
      relay.auth((template) => this.signAuth(relay, template)),
      signerFailed,
    ])
      .then(() => undefined)
      .catch((err: unknown) => {
        // リレーが AUTH を拒んだ場合も authPromise は失敗のまま残る
        this.markAuthFailed(relay, toError(err));
        throw toError(err);
      })
      .finally(() => state.listeners.delete(listener));
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
   * チャンネルのメッセージを購読する（履歴 limit 200＋新着。既定は kind:42）。
   * リレー間・再購読間の重複はイベントIDで除去。再接続時は自動で
   * since（最終受信時刻−マージン）付きで張り直す。戻り値は購読停止関数。
   * 契約: 同時に持てる購読は1つ（再呼び出しは前の購読を置き換える）。
   */
  subscribe(
    channelId: string,
    onEvent: (ev: NostrEvent) => void,
    kind = 42,
  ): () => void {
    const sub: SubState = {
      channelId,
      kind,
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
    } = { kinds: [sub.kind], "#e": [sub.channelId], limit: 200 };
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
            // AUTH は publish と同じ authenticate を通す (#464)。ここで失敗した
            // 接続を publish のように即座に張り直さないのは、読み取りは自動で
            // 何度でも起きるため、署名を断った人にダイアログを出し続けることに
            // なるから。張り直しは次の送信（reconnectAuthFailed）か再接続に任せ、
            // そのとき connectOne が購読も張り直す
            this.authenticate(relay)
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
   * AUTH は `authenticate` で期限付きなので、署名を拒否・放置されても
   * 待ち続けずに false になる (#464)。
   * （サーバー署名の公式イベントも通すため VerifiedEvent ではなく NostrEvent）
   */
  async publish(event: NostrEvent): Promise<boolean> {
    // 前回 AUTH を断られた接続はここで捨てて張り直す (#464)。署名ダイアログは
    // 張り直した接続で出るので、「送信していないのにダイアログが出る」ことにも、
    // 「ダイアログが出ないまま時間切れになる」ことにもならない
    await this.reconnectAuthFailed();
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
                // 期限付きの AUTH (#464)。拒否・放置で false を返し、
                // 送信側（EventChat.send）が失敗を表示できるようにする
                await this.authenticate(relay);
              } catch {
                return false;
              }
              // AUTH は通ったので、ここから先の失敗は接続の問題ではない
              try {
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
    // 全滅していたら即時再接続してから1回だけリトライ (#225)。AUTH を断られた
    // リレーはこの再試行でも即座に失敗する（`authenticate` が待たない）ので、
    // 「もう1台が単に切れていただけ」の救済はそのまま残る
    await Promise.all(this.relayUrls.map((url) => this.connectOne(url)));
    return attempt();
  }

  /**
   * AUTH に失敗した接続を捨てて張り直す (#464)。nostr-tools は失敗した
   * `authPromise` をその接続が生きているあいだ使い回すので、放っておくと以後は
   * 署名を求めることすらできない。`connect()` が `authPromise` を捨てるため、
   * 繋ぎ直せば署名からやり直せる。
   *
   * 呼ぶのは送信の直前だけにする。失敗した瞬間に張り直すと、リレーが接続直後に
   * 送ってくる AUTH チャレンジで署名ダイアログが出てしまい、利用者から見れば
   * 「何も送っていないのに署名を求められた」ことになる。
   */
  private async reconnectAuthFailed(): Promise<void> {
    const stale = [...this.relays.entries()].filter(
      ([, relay]) => this.authState(relay).failure,
    );
    if (stale.length === 0) return;
    for (const [, relay] of stale) {
      try {
        relay.close();
      } catch {
        /* noop */
      }
    }
    this.onstatus?.();
    await Promise.all(stale.map(([url]) => this.connectOne(url)));
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
