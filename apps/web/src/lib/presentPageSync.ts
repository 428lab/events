import { useCallback, useEffect, useRef, useState } from "react";
import { finalizeEvent, getPublicKey, verifyEvent, type Event as NostrEvent, type EventTemplate } from "nostr-tools/pure";
import { PRESENT_PAGE_KIND, type PresentControlConfig, type PresentPagePayload } from "@eventer/shared";
import { ChatRelayPool, randomLocalSigner, type ChatSigner } from "./nostrChat.js";

/**
 * 発表のページめくりの同期（docs/contest-organizer-ux.md「発表のページめくり」）。
 *
 * - めくれる人（設定に `secret` が付いた画面）は、めくるたびにページ番号を kind 21080 で送る。
 *   途中から開いた人のため、3 秒ごとに今のページを送り直す（setTimeout の連鎖。定期の取り直しではない）
 * - 見ている画面は、その世代の公開鍵で署名されたものだけを受け取る（`pubkey`・`v`・`t`・署名・slug を確かめる）
 * - めくるたびの DB 書き込みは無い。世代が変わったら `event-state` の合図で設定を取り直し、張り直す
 */

const RESEND_MS = 3000;
const MAX_PAGE = 10_000;

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** 受け取ったイベントを確かめてページ番号を返す。違う鍵・違う世代・違うスライド・壊れたものは null */
export function openPresentPageEvent(
  ev: NostrEvent,
  config: Pick<PresentControlConfig, "topic" | "version" | "pubkey">,
  slug: string,
): PresentPagePayload | null {
  if (ev.kind !== PRESENT_PAGE_KIND || ev.pubkey !== config.pubkey) return null;
  if (!ev.tags.some((t) => t[0] === "t" && t[1] === config.topic)) return null;
  if (!ev.tags.some((t) => t[0] === "v" && t[1] === String(config.version))) return null;
  if (ev.content.length > 500 || !verifyEvent(ev)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(ev.content);
  } catch {
    return null;
  }
  const p = raw as Partial<PresentPagePayload> | null;
  if (!p || p.slug !== slug) return null;
  if (typeof p.page !== "number" || !Number.isInteger(p.page) || p.page < 0 || p.page > MAX_PAGE) return null;
  const at = typeof p.at === "number" && Number.isSafeInteger(p.at) ? p.at : ev.created_at * 1000;
  // 先の時刻を付けた送信で、その世代を固めさせない（受け取った側の last がそれ以上進めなくなる）
  if (at > Date.now() + 60_000) return null;
  return { slug, page: p.page, at };
}

export function sealPresentPage(
  payload: PresentPagePayload,
  config: Pick<PresentControlConfig, "topic" | "version">,
): EventTemplate {
  return {
    kind: PRESENT_PAGE_KIND,
    created_at: Math.floor(payload.at / 1000),
    tags: [["t", config.topic], ["v", String(config.version)], ["-"]],
    content: JSON.stringify(payload),
  };
}

/** 送受信の口。テストでは差し替える */
export interface PresentPageTransport {
  subscribe: (topic: string, since: number, onEvent: (ev: NostrEvent) => void) => () => void;
  publish: (template: EventTemplate) => Promise<boolean>;
  close: () => void;
}

/** めくれる人はその世代の鍵で署名し、AUTH も同じ鍵で応じる（NIP-70 `["-"]`）。見るだけなら使い捨ての鍵 */
export function relayPresentTransport(relays: readonly string[], secret: string | undefined): PresentPageTransport {
  let signer: ChatSigner;
  if (secret) {
    const sk = hexToBytes(secret);
    signer = { pubkey: getPublicKey(sk), signEvent: async (t) => finalizeEvent(t, sk) };
  } else {
    signer = randomLocalSigner();
  }
  const pool = new ChatRelayPool(signer, relays);
  void pool.connect();
  return {
    subscribe: (topic, since, onEvent) => pool.subscribeTopic(PRESENT_PAGE_KIND, topic, since, onEvent),
    publish: async (template) => pool.publish(await signer.signEvent(template)),
    close: () => pool.close(),
  };
}

export type MakePresentTransport = (relays: readonly string[], secret: string | undefined) => PresentPageTransport;

/**
 * 発表画面のページを、めくっている人に合わせる。
 * - `holder`: この画面がめくる（送る）側か
 * - `following`: 見ている側が発表者に合わせているか。手元でめくると false になり、`follow()` で戻る
 * 設定が無い（サービス鍵なし・リレーなし）なら手元だけでめくる今の動作
 */
export function usePresentPageSync(
  config: PresentControlConfig | null | undefined,
  slug: string,
  total: number,
  makeTransport: MakePresentTransport = relayPresentTransport,
) {
  const active = Boolean(config && config.relays.length > 0);
  const holder = Boolean(active && config?.secret);
  const [page, setPage] = useState(0);
  const [following, setFollowing] = useState(true);
  const [remotePage, setRemotePage] = useState<number | null>(null);
  const last = useRef(0);
  const transport = useRef<PresentPageTransport | null>(null);
  const pageRef = useRef(0);
  pageRef.current = page;
  // 今のページを知っているか（自分でめくった・受け取った）。開いたばかりのめくる側が
  // 何も知らないまま 1 ページ目を送り直し、全員を最初に戻すのを防ぐ
  const known = useRef(false);
  const followingRef = useRef(true);
  followingRef.current = following;
  const clamp = useCallback((p: number) => Math.min(Math.max(p, 0), Math.max(total - 1, 0)), [total]);

  const topic = config?.topic;
  const version = config?.version;
  const pubkey = config?.pubkey;
  const secret = config?.secret;
  const relayKey = config?.relays.join(" ");

  useEffect(() => {
    if (!active || !topic || version === undefined || !pubkey) return;
    const cfg = { topic, version, pubkey };
    const t = makeTransport(relayKey!.split(" "), secret);
    transport.current = t;
    last.current = 0;
    known.current = false;
    const unsub = t.subscribe(topic, Math.floor(Date.now() / 1000) - 60, (ev) => {
      const p = openPresentPageEvent(ev, cfg, slug);
      if (!p || p.at <= last.current) return;
      last.current = p.at;
      known.current = true;
      setRemotePage(p.page);
      // 自分がめくる側なら、ほかのメンバーがめくったページにも合わせる（チームの誰がめくってもよい）
      if (secret || followingRef.current) setPage(p.page);
    });
    return () => {
      unsub();
      t.close();
      if (transport.current === t) transport.current = null;
    };
  }, [active, topic, version, pubkey, secret, relayKey, slug, makeTransport]);

  const send = useCallback((p: number) => {
    const t = transport.current;
    if (!holder || !t || !topic || version === undefined) return;
    const at = Math.max(Date.now(), last.current + 1);
    last.current = at;
    known.current = true;
    void t.publish(sealPresentPage({ slug, page: p, at }, { topic, version }));
  }, [holder, topic, version, slug]);

  // 途中から開いた人のため、めくる側は今のページを送り直す（画面を見ていないタブからは送らない）
  useEffect(() => {
    if (!holder) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (known.current && (typeof document === "undefined" || !document.hidden)) send(pageRef.current);
      timer = setTimeout(tick, RESEND_MS);
    };
    timer = setTimeout(tick, RESEND_MS);
    return () => clearTimeout(timer);
  }, [holder, send]);

  /** ‹ › と ← →。めくる側は送る。見ている側は手元でめくり、合わせるのをやめる */
  const go = useCallback((d: number) => {
    const next = clamp(pageRef.current + d);
    if (next === pageRef.current) return;
    setPage(next);
    if (holder) send(next);
    else if (active) setFollowing(false);
  }, [clamp, holder, active, send]);

  const follow = useCallback(() => {
    setFollowing(true);
    if (remotePage !== null) setPage(remotePage);
  }, [remotePage]);

  return { page: clamp(page), go, holder, active, following: !holder && active ? following : true, follow };
}
