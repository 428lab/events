import { useEffect, useMemo, useRef, useState } from "react";
import type { Event as NostrEvent } from "nostr-tools/pure";
import type { EncryptedChatPayload } from "@eventer/shared";
import { CHAT_RELAYS, GROUP_CHAT_KIND } from "@eventer/shared";
import {
  appendChatMessage,
  bufferAllowPredicate,
} from "../../lib/chatMessageBuffer.js";
import {
  openGroupChatMessage,
  sealGroupChatMessage,
  visibleAfterRevocation,
} from "../../lib/groupChatCrypto.js";
import {
  ChatRelayPool,
  localSignerFromHex,
  randomLocalSigner,
} from "../../lib/nostrChat.js";
import type { ChatSigner } from "../../lib/nostrChat.js";
import type { ChatSendResult } from "./useChatChannel.js";

export interface EncryptedChatChannelState {
  /** 復号済み（content を平文に置き換えた）メッセージ。失効後の発言と
   * 開けないものは除いてある。許可リスト・非表示・上限の絞り込みは呼び出し側
   * （selectVisibleChatMessages） */
  messages: NostrEvent[];
  relayConnected: boolean;
  /** 発言できる状態か（自分の鍵があり、部屋が決まっている） */
  canSend: boolean;
  send: (text: string) => Promise<ChatSendResult>;
}

/**
 * 参加者の暗号化チャット (#582) の接続・購読・復号・送信（設計 4.1）。
 *
 * 戻り値は useChatChannel と同じ形に寄せてあり、表示側（ChatMessageList など）は
 * 平文の場合と区別しない。暗号処理（groupChatCrypto）はスタッフチャットと共用。
 *
 * - 発言鍵は**サーバー管理の一時鍵だけ**（payload の myKey）。NIP-07 の本鍵は使わない
 * - 投影用（display）は読むだけ: リレーの AUTH に答えるための使い捨て鍵で購読し、送信しない
 * - 受信バッファは暗号文のまま持ち、描画時に**その時点の鍵束**で開ける。
 *   ローテーション直後に新しい世代の発言が先に届いても、次のポーリングで鍵が
 *   増えた時点で表示される（設計 7.3。開けないあいだはエラーにしない）
 * - 送信の直前に payload を取り直し、その最新 version で封をする（設計 3.2）。
 *   資格を失った人の取り直しは失敗するので、古い鍵のまま送ることはない
 */
export function useEncryptedChatChannel({
  eventId,
  chat,
  display,
  chatUnavailable,
  refresh,
}: {
  eventId: string;
  chat: EncryptedChatPayload | null | undefined;
  /** 投影用画面か (#215)。読むだけで送信しない */
  display: boolean;
  /** 繋がせない状態 (#283 / 資格喪失)。リレーにも接続しない */
  chatUnavailable: boolean;
  /** 送信直前の取り直し。失敗（403 等）は throw する */
  refresh: () => Promise<EncryptedChatPayload | null | undefined>;
}): EncryptedChatChannelState {
  const [messages, setMessages] = useState<NostrEvent[]>([]);
  const [relayConnected, setRelayConnected] = useState(false);
  const poolRef = useRef<ChatRelayPool | null>(null);

  // 発言用の署名器（サーバー管理の一時鍵。localStorage には置かない）
  const mySecret = display ? null : (chat?.myKey?.secret ?? null);
  const signer = useMemo<ChatSigner | null>(
    () => (mySecret ? localSignerFromHex(mySecret) : null),
    [mySecret],
  );
  // 投影用は使い捨ての鍵で購読だけする（この鍵では発言しない）
  const readOnlySignerRef = useRef<ChatSigner | null>(null);
  if (display && !readOnlySignerRef.current) {
    readOnlySignerRef.current = randomLocalSigner();
  }
  const activeSigner = signer ?? (display ? readOnlySignerRef.current : null);

  const relays = useMemo(
    () => (chat?.relays?.length ? chat.relays : [...CHAT_RELAYS]),
    [chat],
  );
  const relaysKey = relays.join(" ");
  const roomId = chat?.roomId ?? null;

  // 満杯時に捨てる順序の許可リスト（chatMessageBuffer.ts）。購読コールバックは
  // effect 内で閉じるので、ポーリングで更新される最新の集合を ref で見せる
  const keepRef = useRef<(pubkey: string) => boolean>(() => true);
  keepRef.current = bufferAllowPredicate(
    new Set((chat?.members ?? []).map((m) => m.pubkey)),
    signer?.pubkey,
  );
  const append = (prev: NostrEvent[], ev: NostrEvent) =>
    appendChatMessage(prev, ev, (pk) => keepRef.current(pk));

  useEffect(() => {
    if (!activeSigner || !roomId || chatUnavailable) return;
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    const pool = new ChatRelayPool(activeSigner, relaysKey.split(" "));
    poolRef.current = pool;
    pool.onstatus = () => {
      if (!disposed) setRelayConnected(pool.connected);
    };
    void (async () => {
      await pool.connect();
      if (disposed) return;
      unsubscribe = pool.subscribe(
        roomId,
        (ev) => {
          if (disposed) return;
          setMessages((prev) => append(prev, ev));
        },
        GROUP_CHAT_KIND,
      );
    })();
    const stop = () => {
      disposed = true;
      unsubscribe?.();
      pool.close();
      poolRef.current = null;
      setRelayConnected(false);
      setMessages([]);
    };
    // 閲覧権の失効・アカウント切替 (eventAccessLifecycle) で接続と受信ぶんを捨てる
    const onReset = (e: Event) => {
      const id = (e as CustomEvent<string | undefined>).detail;
      if (!id || id === eventId) stop();
    };
    window.addEventListener("event-access-reset", onReset);
    return () => {
      window.removeEventListener("event-access-reset", onReset);
      stop();
    };
    // append は ref 経由で最新を見るので依存に含めない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSigner, roomId, relaysKey, chatUnavailable, eventId]);

  // 復号結果のキャッシュ。鍵束が増えたら（ローテーション）開け直す
  const decryptedRef = useRef(new Map<string, string | null>());
  const keys = chat?.keys;
  const keysKey = (keys ?? []).map((k) => k.version).join(",");
  const members = chat?.members;

  const decrypted = useMemo(() => {
    if (!keys || !members || chatUnavailable) return [];
    const revokedAt = new Map(members.map((m) => [m.pubkey, m.revokedAt]));
    const cache = decryptedRef.current;
    const out: NostrEvent[] = [];
    for (const ev of messages) {
      // 許可リスト外はここで落とさない（呼び出し側の絞り込みに任せる）が、
      // 失効した人の失効後の発言はここで落とす（設計 7.3）
      const revoked = revokedAt.get(ev.pubkey);
      if (revoked !== undefined && !visibleAfterRevocation(revoked, ev.created_at)) {
        continue;
      }
      const cacheKey = `${ev.id}:${keysKey}`;
      let text = cache.get(cacheKey);
      if (text === undefined) {
        text = openGroupChatMessage(keys, ev);
        cache.set(cacheKey, text);
      }
      if (text === null) continue;
      out.push({ ...ev, content: text });
    }
    return out;
    // keysKey が keys の変化を値で代表する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, members, keysKey, chatUnavailable]);

  const canSend = Boolean(signer && roomId && !chatUnavailable);

  /** 送信直前に payload を取り直して最新 version で封をする（設計 3.2） */
  const send = async (text: string): Promise<ChatSendResult> => {
    if (!canSend) return "failed";
    try {
      const latest = await refresh();
      if (!latest?.myKey) return "failed";
      const template = sealGroupChatMessage(
        latest.roomId,
        latest.keys,
        text,
        (latest.relays[0] ?? relays[0])!,
      );
      if (!template) return "failed";
      // 取り直した鍵で署名する（失効から復帰して鍵が替わった場合も含めて最新に揃える）
      const ev = await localSignerFromHex(latest.myKey.secret).signEvent(
        template,
      );
      const ok = await poolRef.current?.publish(ev);
      if (!ok) return "offline";
      // リレーからの折返しを待たず即時表示（購読側とはIDで重複排除）
      setMessages((prev) => append(prev, ev));
      return "ok";
    } catch {
      return "failed";
    }
  };

  return { messages: decrypted, relayConnected, canSend, send };
}
