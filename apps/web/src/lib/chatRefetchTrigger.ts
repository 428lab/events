import { useEffect, useRef } from "react";
import { GROUP_CHAT_VERSION_TAG } from "@eventer/shared";

/** 同じ部屋で取り直しを起こす最短の間隔 */
export const CHAT_REFETCH_THROTTLE_MS = 10_000;

/**
 * チャットの許可リスト・鍵一式を「必要になったときだけ」取り直すきっかけ（D-POLL-MIN）。
 * 定期の取り直しの代わりに、Nostr で届いた発言から次の2つを拾う:
 * - 許可リストに無い pubkey の発言（新しく参加した人・鍵を登録した人）
 * - 手元に無い鍵世代（v タグ）の暗号文（ローテーション）
 *
 * 同じきっかけ（key）では1回だけ取り直す。部屋ごとに CHAT_REFETCH_THROTTLE_MS に
 * 1回までで、間隔内に来たものは間隔の終わりにまとめて1回取り直す
 * （部外者がゴミ投稿を流し込んでも、取り直しはこの頻度を超えない）。
 */
export function createChatRefetchTrigger(
  refetch: () => void,
  now: () => number = Date.now,
) {
  const seen = new Set<string>();
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = () => {
    timer = null;
    last = now();
    refetch();
  };
  return {
    request(key: string) {
      if (seen.has(key)) return;
      seen.add(key);
      if (timer) return;
      const wait = last + CHAT_REFETCH_THROTTLE_MS - now();
      if (wait <= 0) run();
      else timer = setTimeout(run, wait);
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/** createChatRefetchTrigger を部屋（roomKey）ごとに持つ。部屋が変わったら数え直す。
 * refetch は ref 経由で最新を呼ぶので、毎レンダー新しい関数を渡してよい */
export function useChatRefetchTrigger(
  refetch: (() => unknown) | undefined,
  roomKey: string,
): (key: string) => void {
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  const triggerRef = useRef<ReturnType<typeof createChatRefetchTrigger> | null>(
    null,
  );
  const roomRef = useRef<string | null>(null);
  if (roomRef.current !== roomKey) {
    triggerRef.current?.dispose();
    roomRef.current = roomKey;
    triggerRef.current = createChatRefetchTrigger(() => {
      void refetchRef.current?.();
    });
  }
  useEffect(() => () => triggerRef.current?.dispose(), []);
  const requestRef = useRef((key: string) => triggerRef.current?.request(key));
  return requestRef.current;
}

/** 暗号文の鍵世代（v タグ）が、手元のどの鍵より新しいか。
 * 新しいものはローテーションの合図なので取り直す（古い世代は取り直しても開けない） */
export function newerKeyVersion(
  tags: string[][],
  knownVersions: number[],
): number | null {
  const tag = tags.find((t) => t[0] === GROUP_CHAT_VERSION_TAG && t[1]);
  if (!tag) return null;
  const version = Number(tag[1]);
  if (!Number.isInteger(version)) return null;
  const max = knownVersions.length ? Math.max(...knownVersions) : 0;
  return version > max ? version : null;
}
