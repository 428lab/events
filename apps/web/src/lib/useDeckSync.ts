import { useEffect, useRef, useState } from "react";
import type { DeckContent, DeckForEdit, DeckOp, DeckSyncConfig } from "@eventer/shared";
import { ApiError, api } from "../api/client.js";
import { prepareLoadedContent } from "./deckPositions.js";
import {
  applyDeckOps,
  createDeckClock,
  deckDelta,
  diffDeck,
  expirePendingRecords,
  loadDeckState,
  projectDeckOps,
  rebaseAfterGap,
  rebaseOnConflict,
  splitFocusedText,
  stateDoc,
  type DeckDoc,
  type DeckSyncState,
  type FocusedText,
} from "./deckSync.js";
import {
  chunkDeckOps,
  createReceiveLimiter,
  openDeckSyncMessage,
  relayTransport,
  sealDeckSyncBatch,
  type DeckPresence,
  type DeckSyncHeartbeat,
  type DeckSyncTransport,
} from "./deckSyncChannel.js";
import { useEventSignal } from "./signalHub.js";

/**
 * チームのスライドの同時編集をつなぐ（docs/team-deck-live-sync.md §5–§7）。
 *
 * - 自分の操作: 基準の中身との差を op にして、150ms まとめて送る。pending log に残す
 * - 受け取った op: 形を確かめて当て、`onRemote` で画面へ入れる（保存はしない・送り返さない）
 * - 途切れ（再接続・合図・取り直しの依頼・保留の期限切れ）: 取り直して §7.4 A で合わせる
 * - 409: `rebase` を useDeckSave に渡す。途切れの後なら A、無ければ B で合わせる
 * - 心拍（§6.4）: 2 秒ごと（選択が変わったらすぐ）に「いま開いている・選んでいる」を送る。
 *   受け取った心拍は 6 秒届かなければ「編集中」から外す。タブが隠れているあいだは送らない
 * - `config` が null（機能オフ・個人のデッキ）のときは何もしない（今の動作）
 */

/** 送るまでのまとめの間隔（§6.4） */
const COALESCE_MS = 150;
/** リレーにつながらないまま、これだけ過ぎたら同期は無いものとして今の案内に戻す（§7.6） */
const OFFLINE_FALLBACK_MS = 10_000;
/** 購読を張るときに遡る秒数（strfry が保持しているぶんを受け取る） */
const SUBSCRIBE_BACK_SEC = 120;
/** 取り直しの依頼（相手が大きすぎる op を送れなかった）を受けてから取り直すまで */
const REFETCH_REQUEST_DELAY_MS = 2_000;
/** 重複を覚えておく件数（§7.2） */
const SEEN_MAX = 2_000;
/** 受け取った側から頼まれる取り直し（上限超え・refetch の依頼）の最短間隔。ひとりが送り続けても GET を続けさせない */
const REFETCH_MIN_GAP_MS = 5_000;
/** 心拍を送る間隔（§6.4）。setInterval ではなく setTimeout の連鎖 */
const HEARTBEAT_MS = 2_000;
/** これだけ心拍が届かなければ「編集中」から外す（§6.4） */
export const PRESENCE_TIMEOUT_MS = 6_000;
/** 選択が変わったときの心拍をまとめる間隔（1 秒 10 件の送信上限に収める） */
const PRESENCE_COALESCE_MS = 100;

/** いま同じスライドを開いているほかのメンバー（同じ人の複数のタブは1人にまとめる） */
export interface DeckPeer {
  userId: string;
  name: string;
  /** その人のタブが選んでいる要素（ページごと。複数のタブはまとめる） */
  selections: { slideId: string; elementIds: string[] }[];
}

export interface DeckSyncOptions {
  deckId: string;
  config: DeckSyncConfig | null | undefined;
  /** 画面の今の中身（読み込み前は null） */
  doc: DeckDoc | null;
  /** いまフォーカスしている文字欄（§5.4） */
  focused: FocusedText | null;
  /**
   * 受け取った変更・合わせた結果を画面へ入れる。`apply` は Undo・Redo のスナップショットへ写す射影。
   * それだけでは保存しない（useDeckSave.acceptRemote を通す。§7.4・§7.6）
   */
  onRemote: (doc: DeckDoc, apply: (content: DeckContent) => DeckContent) => void;
  /** 取り直した版（次の保存の baseRevision）。このタブ自身の GET の応答だけ */
  onRevision: (revision: number) => void;
  /** いまの baseRevision。これより古い版の GET の応答は当てない（保存のあとに古い応答が届いたとき） */
  revision?: () => number | undefined;
  /** 取り直しで編集できなくなった（チームを抜けた・イベントが終わった。agent_writing は AI が書き始めた） */
  onLost: (reason?: "agent_writing") => void;
  /** 自分の選択（心拍で送る）。null なら選択なしとして送る */
  presence?: DeckPresence | null;
  /** このタブが最後に保存できた版（心拍に載せる。表示用 §7.6） */
  savedRevision?: number;
  /** ほかのメンバーの心拍に、これまでより新しい保存の版が載っていた（「最後に保存」の表示用） */
  onPeerSaved?: (name: string, revision: number) => void;
  /** テスト用の差し替え */
  transport?: (relays: readonly string[]) => DeckSyncTransport;
  fetchDeck?: () => Promise<DeckForEdit>;
  now?: () => number;
}

export interface DeckSyncHandle {
  /** 同期が動いているか（リレーにつながらないまま 10 秒たったら false） */
  active: boolean;
  /** 409 のときに合わせる（useDeckSave に渡す）。同期が動いていなければ undefined */
  rebase: (() => Promise<DeckDoc | null>) | undefined;
  /** 保存を始めるときに呼ぶ。戻り値を `saved` に渡す */
  markSaveStart: () => number;
  /** 保存できたら呼ぶ。そこまでの pending log を消し、新しい世代なら取り直す */
  saved: (mark: number, syncVersion: number | null | undefined) => void;
  /** 読み込み直した（今の案内の「最新を読み込む」）とき */
  reset: (doc: DeckDoc) => void;
  /** いま編集中のほかのメンバー。同期が動いていなければ空 */
  peers: DeckPeer[];
}

const randomClientId = () => {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
};

export function useDeckSync(opts: DeckSyncOptions): DeckSyncHandle {
  const now = opts.now ?? Date.now;
  const [config, setConfig] = useState<DeckSyncConfig | null>(opts.config ?? null);
  const configRef = useRef(config);
  configRef.current = config;
  // 編集画面の読み込みで初めて設定が届く
  useEffect(() => {
    if (opts.config && !configRef.current) setConfig(opts.config);
  }, [opts.config]);

  const optsRef = useRef(opts);
  optsRef.current = opts;

  const clock = useRef(createDeckClock(randomClientId(), now));
  const state = useRef<DeckSyncState | null>(null);
  /** 最後に送った・当てた中身（§5.5 の基準） */
  const base = useRef<DeckDoc | null>(null);
  /** 自分の未保存の op（§7.3）。`dropped` は先頭から消した数（保存の印を数え続けるため） */
  const pending = useRef<{ ops: DeckOp[]; dropped: number }>({ ops: [], dropped: 0 });
  const outbox = useRef<DeckOp[]>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef<DeckOp[]>([]);
  /** 読み込み以降に途切れがあったか（§7.4 の A と B を分ける） */
  const gap = useRef(false);
  const seen = useRef(new Set<string>());
  const limiter = useRef(createReceiveLimiter());
  const transport = useRef<DeckSyncTransport | null>(null);
  const refetching = useRef<Promise<void> | null>(null);
  /** 受け取った側からの取り直しの予約（1つだけ）と、最後に取り直しを始めた時刻 */
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRefetchAt = useRef(Number.NEGATIVE_INFINITY);
  const [connected, setConnected] = useState(false);
  const [offlineTooLong, setOfflineTooLong] = useState(false);
  const stopped = useRef(false);
  /** 届いた心拍（clientId ごと）。受け取った時刻で期限を見る */
  const peerMap = useRef(new Map<string, { heartbeat: DeckSyncHeartbeat; at: number }>());
  const [peers, setPeers] = useState<DeckPeer[]>([]);
  const pruneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peersKey = useRef("[]");

  const docNow = (): DeckDoc | null => optsRef.current.doc;

  // ===== 読み込み =====
  useEffect(() => {
    if (!config || state.current || !opts.doc) return;
    state.current = { ...loadDeckState(opts.doc), content: opts.doc.content };
    base.current = opts.doc;
  }, [config, opts.doc]);

  // ===== 送る =====
  const flush = () => {
    flushTimer.current = null;
    const cfg = configRef.current;
    const t = transport.current;
    if (!cfg || !t || outbox.current.length === 0) return;
    const ops = outbox.current;
    outbox.current = [];
    const head = { v: cfg.key.version, clientId: clock.current.clientId, userId: cfg.me.userId, name: cfg.me.name };
    for (const batch of chunkDeckOps(head, ops)) void t.publish(sealDeckSyncBatch(batch, cfg)).catch(() => false);
  };
  const enqueue = (ops: readonly DeckOp[]) => {
    outbox.current.push(...ops);
    if (!flushTimer.current) flushTimer.current = setTimeout(flush, COALESCE_MS);
  };

  // ===== 自分の操作 =====
  useEffect(() => {
    const doc = opts.doc;
    if (!config || !doc || !state.current || !base.current || stopped.current) return;
    if (doc === base.current) return;
    if (doc.content === base.current.content && doc.title.trim() === base.current.title.trim()) {
      base.current = doc;
      return;
    }
    let ops: DeckOp[];
    try {
      ops = diffDeck(base.current, doc, clock.current);
    } catch {
      // pos の無い中身（起きないはず）。差分にできないので取り直して合わせる
      base.current = doc;
      void refetch();
      return;
    }
    base.current = doc;
    if (ops.length === 0) return;
    const applied = applyDeckOps(state.current, ops, now()).state;
    // 画面の中身をそのまま正にする（値は同じ。オブジェクトの同一性を保つ）
    state.current = { ...applied, content: doc.content };
    pending.current.ops.push(...ops);
    enqueue(ops);
  }, [config, opts.doc]);

  // ===== 受け取った変更を画面へ =====
  const pushRemote = (next: DeckSyncState, apply: (c: DeckContent) => DeckContent) => {
    state.current = next;
    const doc = stateDoc(next);
    base.current = doc;
    optsRef.current.onRemote(doc, apply);
  };

  const applyRemote = (ops: readonly DeckOp[]) => {
    if (!state.current || ops.length === 0) return;
    const at = now();
    const res = applyDeckOps(state.current, ops, at);
    const expired = expirePendingRecords(res.state, at);
    if (res.effective.length > 0 || res.state.content !== state.current.content || res.state.title !== state.current.title) {
      const effective = res.effective;
      pushRemote(expired.state, (c) => projectDeckOps({ title: "", content: c }, effective).content);
    } else {
      state.current = expired.state;
    }
    if (expired.refetch) void refetch();
  };

  /** そのデッキの画像か、その要素がすでに持っていた値のときだけ src を当てる（§8） */
  const allowSrc = (op: DeckOp): DeckOp => {
    const prefix = `/api/decks/${optsRef.current.deckId}/images/`;
    const ok = (v: string | null | undefined, current: unknown) => v === null || v === undefined || v.startsWith(prefix) || v === current;
    if (op.op === "el.add" && !ok(op.element.src, undefined)) {
      const { src: _src, ...element } = op.element;
      return { ...op, element };
    }
    if (op.op === "el.set" && op.fields.src !== undefined) {
      const current = state.current?.content.slides.find((s) => s.id === op.slideId)?.elements.find((e) => e.id === op.elementId)?.src;
      if (!ok(op.fields.src, current)) {
        const { src: _src, ...fields } = op.fields;
        return { ...op, fields };
      }
    }
    return op;
  };

  // ===== 心拍（§6.4） =====
  /** 期限の切れた心拍を外して、表示する一覧を作り直す。次に切れる時刻に合わせて1回だけ予約する */
  const refreshPeers = () => {
    if (pruneTimer.current) clearTimeout(pruneTimer.current);
    pruneTimer.current = null;
    const at = now();
    const me = configRef.current?.me.userId;
    let next = Number.POSITIVE_INFINITY;
    const byUser = new Map<string, DeckPeer>();
    for (const [clientId, p] of peerMap.current) {
      if (at - p.at >= PRESENCE_TIMEOUT_MS || p.heartbeat.presence === null) {
        peerMap.current.delete(clientId);
        continue;
      }
      next = Math.min(next, p.at + PRESENCE_TIMEOUT_MS);
      // 自分（別のタブを含む）は出さない
      if (p.heartbeat.userId === me) continue;
      const peer = byUser.get(p.heartbeat.userId) ?? { userId: p.heartbeat.userId, name: p.heartbeat.name, selections: [] };
      const presence = p.heartbeat.presence;
      const ids = [...presence.selected, ...(presence.editingText ? [presence.editingText] : [])];
      if (presence.slideId && ids.length > 0) peer.selections.push({ slideId: presence.slideId, elementIds: [...new Set(ids)] });
      byUser.set(p.heartbeat.userId, peer);
    }
    const list = [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name));
    // 心拍のたびに編集画面を描き直さない（中身が変わったときだけ）
    const key = JSON.stringify(list);
    if (key !== peersKey.current) {
      peersKey.current = key;
      setPeers(list);
    }
    if (Number.isFinite(next)) pruneTimer.current = setTimeout(refreshPeers, Math.max(0, next - at));
  };

  // タブ（clientId）ごとに見た保存の版。全体で一つにすると、大きすぎる値を一度送られただけで「最後に保存」が止まる
  const savedSeen = useRef(new Map<string, number>());
  const receiveHeartbeat = (hb: DeckSyncHeartbeat, at: number) => {
    if (hb.presence === null) peerMap.current.delete(hb.clientId);
    else peerMap.current.set(hb.clientId, { heartbeat: hb, at });
    if (typeof hb.savedRevision === "number" && hb.savedRevision > (savedSeen.current.get(hb.clientId) ?? 0)) {
      savedSeen.current.set(hb.clientId, hb.savedRevision);
      if (hb.userId !== configRef.current?.me.userId) optsRef.current.onPeerSaved?.(hb.name, hb.savedRevision);
    }
    refreshPeers();
  };

  const sendHeartbeat = (presence: DeckPresence | null) => {
    const cfg = configRef.current;
    const t = transport.current;
    if (!cfg || !t || stopped.current) return;
    const hb: DeckSyncHeartbeat = {
      v: cfg.key.version,
      clientId: clock.current.clientId,
      userId: cfg.me.userId,
      name: cfg.me.name,
      // 受け手は 201 個以上の選択を心拍ごと捨てる（deckSyncChannel）。切って送れば「編集中」から消えない
      presence: presence && presence.selected.length > 200 ? { ...presence, selected: presence.selected.slice(0, 200) } : presence,
      ...(typeof optsRef.current.savedRevision === "number" ? { savedRevision: optsRef.current.savedRevision } : {}),
    };
    void t.publish(sealDeckSyncBatch(hb, cfg)).catch(() => false);
  };

  const receive = (ev: Parameters<typeof openDeckSyncMessage>[0]) => {
    const cfg = configRef.current;
    if (!cfg || stopped.current) return;
    const at = now();
    const message = openDeckSyncMessage(ev, cfg, at);
    if (!message) return;
    if (message.kind === "heartbeat") {
      const hb = message.heartbeat;
      // 心拍は描画だけ。上限を超えた分は捨てる（取り直しは頼まない）
      if (hb.clientId === clock.current.clientId || !limiter.current(hb.clientId, at)) return;
      // リレーが保持していた古い心拍（購読を張ったときに届く）は「いま」ではない
      if (message.createdAt * 1000 < at - PRESENCE_TIMEOUT_MS) return;
      receiveHeartbeat(hb, at);
      return;
    }
    const batch = message.batch;
    if (batch.clientId === clock.current.clientId) return;
    if (!limiter.current(batch.clientId, at)) {
      requestRefetch(0);
      return;
    }
    if (batch.refetch) requestRefetch(REFETCH_REQUEST_DELAY_MS);
    const fresh: DeckOp[] = [];
    for (const op of batch.ops) {
      const key = `${op.hlc.clientId}:${op.hlc.t}:${op.hlc.c}`;
      if (seen.current.has(key)) continue;
      seen.current.add(key);
      if (seen.current.size > SEEN_MAX) {
        for (const k of seen.current) {
          seen.current.delete(k);
          if (seen.current.size <= SEEN_MAX / 2) break;
        }
      }
      clock.current.observe(op.hlc);
      fresh.push(allowSrc(op));
    }
    const { apply, held: hold } = splitFocusedText(fresh, optsRef.current.focused);
    held.current.push(...hold);
    applyRemote(apply);
  };

  // フォーカスが外れたら、保留していた文字を当てる（印を比べるので、あとに打ったほうが残る）
  const focusKey = opts.focused ? `${opts.focused.slideId}:${opts.focused.elementId}` : "";
  useEffect(() => {
    if (held.current.length === 0) return;
    const { apply, held: still } = splitFocusedText(held.current, optsRef.current.focused);
    held.current = still;
    applyRemote(apply);
  }, [focusKey]);

  // ===== 取り直し（§7.4 A）と世代の切り替え =====
  const switchVersion = (next: DeckSyncConfig) => {
    configRef.current = next;
    setConfig(next);
    // 先に切り替えた相手が古い宛先の op を受け取れないので、未保存の op を新しい宛先へ送り直す
    enqueue(pending.current.ops);
  };

  const fetchDeck = () => (optsRef.current.fetchDeck ?? (() => api.get<DeckForEdit>(`/decks/${optsRef.current.deckId}`)))();

  /** 取り直す。lost なら止める。合わせ方は gap（途切れ）があれば A、無ければ B */
  const load = async (mode: "gap" | "conflict"): Promise<DeckDoc | null> => {
    let fetched: DeckForEdit;
    try {
      fetched = await fetchDeck();
    } catch (error) {
      if (error instanceof ApiError && (error.status === 403 || error.status === 404 || error.status === 423)) {
        stopped.current = true;
        optsRef.current.onLost(error.status === 423 ? "agent_writing" : undefined);
      }
      return null;
    }
    if (!state.current) return null;
    // 保存の応答より先に始めた GET が、あとから届いた。古い中身で戻さない（版も戻さない）
    const known = optsRef.current.revision?.();
    if (typeof fetched.revision === "number" && typeof known === "number" && fetched.revision < known) return null;
    const current = docNow() ?? stateDoc(state.current);
    // 取り直すあいだに打ったぶんも pending log に入れてから合わせる
    if (base.current && current !== base.current) {
      const ops = diffDeck(base.current, current, clock.current);
      if (ops.length > 0) {
        pending.current.ops.push(...ops);
        enqueue(ops);
      }
    }
    const fetchedDoc: DeckDoc = { title: fetched.title, content: prepareLoadedContent(fetched.content) };
    const at = now();
    const next = mode === "gap" || gap.current
      ? rebaseAfterGap(state.current, fetchedDoc, pending.current.ops, at)
      : rebaseOnConflict(state.current, fetchedDoc, pending.current.ops, at);
    if (mode === "gap") gap.current = false;
    if (typeof fetched.revision === "number") optsRef.current.onRevision(fetched.revision);
    const delta = deckDelta(current, stateDoc(next));
    pushRemote(next, (c) => projectDeckOps({ title: "", content: c }, delta).content);
    const sync = fetched.sync ?? null;
    const cfg = configRef.current;
    if (!sync) {
      // 機能がオフになった。今の案内に戻る
      stopped.current = true;
      setConfig(null);
    } else if (cfg && sync.key.version !== cfg.key.version) {
      switchVersion(sync);
    }
    return stateDoc(next);
  };

  const refetch = (): Promise<void> => {
    if (stopped.current) return Promise.resolve();
    gap.current = true;
    if (!refetching.current) {
      lastRefetchAt.current = now();
      refetching.current = load("gap").then(() => undefined).finally(() => {
        refetching.current = null;
      });
    }
    return refetching.current;
  };

  /**
   * 受け取った側から頼まれた取り直し（§6.4）。予約は1つだけで、予約中・取り直し中・最短間隔のあいだの
   * 依頼は捨てる（予約した1回で足りる）。上限超えと refetch の依頼の両方がここを通る
   */
  const requestRefetch = (delay: number) => {
    if (stopped.current || refetchTimer.current) return;
    const wait = Math.max(delay, lastRefetchAt.current + REFETCH_MIN_GAP_MS - now(), 0);
    refetchTimer.current = setTimeout(() => {
      refetchTimer.current = null;
      void refetch();
    }, wait);
  };
  useEffect(() => () => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
  }, []);

  // ===== 接続と購読 =====
  const relaysKey = config ? config.relays.join(" ") : "";
  useEffect(() => {
    const cfg = configRef.current;
    if (!cfg) return;
    const t = (optsRef.current.transport ?? relayTransport)(cfg.relays);
    transport.current = t;
    let wasConnected = false;
    let offlineTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => setOfflineTooLong(true), OFFLINE_FALLBACK_MS);
    t.onStatus(() => {
      const up = t.connected();
      setConnected(up);
      if (up) {
        if (offlineTimer) clearTimeout(offlineTimer);
        offlineTimer = null;
        setOfflineTooLong(false);
        // つなぎ直した: 切れていたあいだの op を受け取れていないかもしれない
        if (wasConnected) void refetch();
        wasConnected = true;
      } else if (!offlineTimer) {
        offlineTimer = setTimeout(() => setOfflineTooLong(true), OFFLINE_FALLBACK_MS);
      }
    });
    return () => {
      if (offlineTimer) clearTimeout(offlineTimer);
      if (flushTimer.current) {
        clearTimeout(flushTimer.current);
        flush();
      }
      // 画面を離れた（「離れた」を1回送る。届かなくても 6 秒で外れる）
      sendHeartbeat(null);
      t.close();
      transport.current = null;
    };
  }, [relaysKey]);

  const topic = config?.topic ?? "";
  useEffect(() => {
    const t = transport.current;
    if (!topic || !t) return;
    return t.subscribe(topic, Math.floor(now() / 1000) - SUBSCRIBE_BACK_SEC, (ev) => receive(ev));
  }, [topic, relaysKey]);

  // 心拍の送信。2 秒ごとの setTimeout の連鎖。隠れているあいだは送らず、見えたらすぐ送る
  const presenceKey = JSON.stringify(opts.presence ?? null);
  const heartbeatTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const beat = () => {
    if (heartbeatTimer.current) clearTimeout(heartbeatTimer.current);
    heartbeatTimer.current = null;
    if (!configRef.current) return;
    // 止まっているあいだも連鎖は続け、送るだけやめる（sendHeartbeat が stopped を見る）。
    // ここで抜けると、reset() で同期が戻っても心拍だけ止まったままになる
    if (typeof document === "undefined" || !document.hidden) {
      sendHeartbeat(optsRef.current.presence ?? { selected: [], slideId: null });
    }
    heartbeatTimer.current = setTimeout(beat, HEARTBEAT_MS);
  };
  useEffect(() => {
    if (!topic || !transport.current) return;
    beat();
    const onVisible = () => {
      if (!document.hidden) beat();
    };
    const onLeave = () => sendHeartbeat(null);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pagehide", onLeave);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pagehide", onLeave);
      if (heartbeatTimer.current) clearTimeout(heartbeatTimer.current);
      heartbeatTimer.current = null;
    };
  }, [topic, relaysKey]);
  // 選択や打っている欄が変わったら、次の 2 秒を待たずに送る（短くまとめる）
  useEffect(() => {
    if (!topic || !transport.current || !heartbeatTimer.current) return;
    clearTimeout(heartbeatTimer.current);
    heartbeatTimer.current = setTimeout(beat, PRESENCE_COALESCE_MS);
  }, [presenceKey]);
  useEffect(() => () => {
    if (pruneTimer.current) clearTimeout(pruneTimer.current);
  }, []);

  // 世代の切り替え・メンバーの変化の合図（§4.4）
  useEventSignal(config?.signal ?? null, () => void refetch());

  const active = Boolean(config) && !stopped.current && (connected || !offlineTooLong);
  return {
    active,
    peers: active ? peers : [],
    rebase: active ? () => load("conflict") : undefined,
    markSaveStart: () => pending.current.dropped + pending.current.ops.length,
    saved: (mark, syncVersion) => {
      const p = pending.current;
      const n = Math.min(Math.max(0, mark - p.dropped), p.ops.length);
      p.ops = p.ops.slice(n);
      p.dropped += n;
      const cfg = configRef.current;
      if (cfg && typeof syncVersion === "number" && syncVersion > cfg.key.version) void refetch();
    },
    reset: (doc) => {
      if (!configRef.current) return;
      state.current = { ...loadDeckState(doc), content: doc.content };
      base.current = doc;
      pending.current = { ops: [], dropped: pending.current.dropped + pending.current.ops.length };
      held.current = [];
      gap.current = false;
      stopped.current = false;
    },
  };
}
