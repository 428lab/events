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
  openDeckSyncEvent,
  relayTransport,
  sealDeckSyncBatch,
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
  /** 取り直しで編集できなくなった（チームを抜けた・イベントが終わった） */
  onLost: () => void;
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
  const [connected, setConnected] = useState(false);
  const [offlineTooLong, setOfflineTooLong] = useState(false);
  const stopped = useRef(false);

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

  const receive = (ev: Parameters<typeof openDeckSyncEvent>[0]) => {
    const cfg = configRef.current;
    if (!cfg || stopped.current) return;
    const at = now();
    const batch = openDeckSyncEvent(ev, cfg, at);
    if (!batch || batch.clientId === clock.current.clientId) return;
    if (!limiter.current(batch.clientId, at)) {
      void refetch();
      return;
    }
    if (batch.refetch) setTimeout(() => void refetch(), REFETCH_REQUEST_DELAY_MS);
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
      if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
        stopped.current = true;
        optsRef.current.onLost();
      }
      return null;
    }
    if (!state.current) return null;
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
      refetching.current = load("gap").then(() => undefined).finally(() => {
        refetching.current = null;
      });
    }
    return refetching.current;
  };

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

  // 世代の切り替え・メンバーの変化の合図（§4.4）
  useEventSignal(config?.signal ?? null, () => void refetch());

  const active = Boolean(config) && !stopped.current && (connected || !offlineTooLong);
  return {
    active,
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
