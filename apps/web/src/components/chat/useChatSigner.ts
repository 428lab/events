import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMembersPayload, User } from "@eventer/shared";
import { api } from "../../api/client.js";
import {
  fetchEphemeralChatKey,
  useCreateEphemeralChatKey,
  useRegisterChatKey,
} from "../../api/eventChatHooks.js";
import { chatJoinErrorKey } from "../../lib/chatApiErrors.js";
import type { ChatJoinErrorKey } from "../../lib/chatApiErrors.js";
import { loadKeyMode, saveKeyMode } from "../../lib/chatKeyMode.js";
import type { KeyMode } from "../../lib/chatKeyMode.js";
import { hasNip07 } from "../../lib/nostr.js";
import {
  buildChatKeyProofTemplate,
  localSignerFromHex,
  nip07Signer,
  randomLocalSigner,
} from "../../lib/nostrChat.js";
import type { ChatSigner } from "../../lib/nostrChat.js";

/**
 * 発言に使う鍵を決める責務 (#199 / #223 / #332)。
 *
 * ここが持つのは「どの鍵で署名するか」だけ。リレー接続・購読・送信は
 * useChatChannel が持つ（鍵の話を触るときに投影用画面や購読を壊さないため #335）。
 *
 * 投影用画面 (#215) の「読むだけ」の性質はこのフックの中に閉じる:
 * 参加操作を一切せず、リレーの NIP-42 AUTH に応答するためだけの
 * 使い捨て鍵を1つ作って返す（この鍵では発言しない）。
 */
export interface ChatSignerState {
  /** 発言できる署名器（参加していなければ null。投影用では常に null） */
  signer: ChatSigner | null;
  /** リレーに繋ぐための署名器。投影用は読み取り専用の使い捨て鍵 */
  activeSigner: ChatSigner | null;
  /** 現在の signer が本人の鍵 (NIP-07) か。部屋の開設経路の判定に使う (#199) */
  isNip07Ref: React.MutableRefObject<boolean>;
  keyMode: KeyMode;
  setKeyMode: (mode: KeyMode) => void;
  join: () => Promise<void>;
  /** 参加処理の実行中（ボタンの二度押し防止） */
  joining: boolean;
  /** 参加に失敗したときの文言キー（表示側で t() する） */
  joinErrorKey: ChatJoinErrorKey | null;
}

export function useChatSigner({
  eventId,
  display,
  chat,
  me,
}: {
  eventId: string;
  /** 投影用画面か (#215) */
  display: boolean;
  chat: ChatMembersPayload | undefined;
  me: User | null | undefined;
}): ChatSignerState {
  const registerKey = useRegisterChatKey(eventId);
  const ephemeralKey = useCreateEphemeralChatKey(eventId);

  const [signer, setSigner] = useState<ChatSigner | null>(null);
  // 前回このイベントで選んだ手段を初期値にする (#332)。未選択なら従来どおり一時鍵
  const [keyMode, setKeyMode] = useState<KeyMode>(
    () => loadKeyMode(eventId) ?? "ephemeral",
  );
  const [joinErrorKey, setJoinErrorKey] = useState<ChatJoinErrorKey | null>(
    null,
  );
  // 現在の signer が NIP-07（Nostrアカウント）か。setSigner の直前に設定する
  const isNip07Ref = useRef(false);

  // 登録済みの自分の鍵がサーバー管理の一時鍵なら自動で再参加する (#223)。
  // 許可リストには**これまでに使った鍵が全部**載る (#332) ので、自分の鍵は複数ある。
  // 依存に使うのは `,` 連結した文字列。Set はレンダーのたびに新しい参照になり、
  // 中身が同じでも effect の依存としては「変わった」扱いになってしまう
  // （2秒ポーリングのたびに無駄に再実行される）ため、値として安定する文字列にする
  const myPubkeysKey = useMemo(
    () =>
      (chat?.members ?? [])
        .filter((m) => me && m.userId === me.id)
        .map((m) => m.pubkey)
        .sort()
        .join(","),
    [chat, me],
  );
  useEffect(() => {
    const myPubkeys = myPubkeysKey ? myPubkeysKey.split(",") : [];
    // 投影用は参加操作をしない（下の読み取り専用の鍵で購読するだけ）
    if (display || signer || myPubkeys.length === 0 || !me) return;
    // 前回このイベントで本人の鍵を選んだ人は、勝手に一時鍵へ戻さない (#332)。
    // サーバーは一時鍵を消さずに持ち続けるので、この分岐が無いと下の取得が
    // 毎回成功し、再読み込みのたびに黙って一時鍵の署名器へ切り替わってしまう
    // （＝本人の鍵で発言する選択が、告知なく失われる）。
    // 未選択の人と、前回一時鍵だった人はこれまでどおり自動で繋がる (#223)
    if (loadKeyMode(eventId) === "nip07") return;
    let cancelled = false;
    void (async () => {
      // 自動再参加は任意動作なので、一時的な取得失敗は黙ってスキップする
      const key = await fetchEphemeralChatKey(eventId).catch(() => null);
      if (cancelled || !key) return;
      const local = localSignerFromHex(key.secret);
      // 配られた一時鍵が自分の鍵として登録されていることを確かめてから使う
      if (myPubkeys.includes(local.pubkey)) {
        isNip07Ref.current = false;
        setSigner(local);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [display, signer, myPubkeysKey, eventId, me]);

  // 投影用画面は「読むだけ」なので、参加していなくても本文が出るようにする (#215)。
  // NIP-07 で参加している人が開くと一時鍵は取れず signer が決まらないため、
  // signer 頼みにするとメッセージが1件も出ない。リレーの NIP-42 AUTH に
  // 応答するためだけの使い捨て鍵で購読する（この鍵では発言しない）
  const readOnlySignerRef = useRef<ChatSigner | null>(null);
  if (display && !readOnlySignerRef.current) {
    readOnlySignerRef.current = randomLocalSigner();
  }
  const activeSigner = signer ?? (display ? readOnlySignerRef.current : null);

  const join = async () => {
    if (!me) return;
    setJoinErrorKey(null);
    // 「本人の鍵」を選んでいても、手元でその鍵が使えなければ一時鍵で参加する。
    // 失敗の説明を出し分けるのに使うので try の外で決める
    const useNip07 = keyMode === "nip07" && hasNip07();
    try {
      let s: ChatSigner;
      if (useNip07) {
        s = await nip07Signer();
        // 所有証明: サーバーのchallengeに署名して送る（他人のnpub紐付け防止）
        const { challenge } = await api.get<{ challenge: string }>(
          "/auth/nostr/challenge",
        );
        const proof = await s.signEvent(
          buildChatKeyProofTemplate(challenge, eventId),
        );
        await registerKey.mutateAsync(proof);
      } else {
        // 一時鍵はサーバーが生成・保管して配布する (#223)。発言鍵の登録も
        // サーバー側で行われるため所有証明は不要。複数端末でも同じ鍵になる
        const key = await ephemeralKey.mutateAsync();
        s = localSignerFromHex(key.secret);
      }
      isNip07Ref.current = useNip07;
      // 実際に使った手段を覚える (#332)。keyMode ではなく useNip07 を書くのは、
      // 「本人の鍵」を選んでいても拡張が無ければ一時鍵で参加しているため
      saveKeyMode(eventId, useNip07 ? "nip07" : "ephemeral");
      setSigner(s);
    } catch (err) {
      // 原因が分かる失敗は出し分ける (#223 / #283 / #332)。判定は lib/chatApiErrors.ts
      setJoinErrorKey(chatJoinErrorKey(err, useNip07));
    }
  };

  return {
    signer,
    activeSigner,
    isNip07Ref,
    keyMode,
    setKeyMode,
    join,
    joining: registerKey.isPending || ephemeralKey.isPending,
    joinErrorKey,
  };
}
