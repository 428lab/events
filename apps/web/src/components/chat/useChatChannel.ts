import { useEffect, useMemo, useRef, useState } from "react";
import type { Event as NostrEvent } from "nostr-tools/pure";
import type { ChatMembersPayload } from "@eventer/shared";
import { CHAT_RELAYS } from "@eventer/shared";
import {
  useCreateChatChannel,
  useRegisterChatChannel,
} from "../../api/eventChatHooks.js";
import { chatChannelErrorKey } from "../../lib/chatApiErrors.js";
import type { ChatChannelErrorKey } from "../../lib/chatApiErrors.js";
import {
  appendChatMessage,
  bufferAllowPredicate,
} from "../../lib/chatMessageBuffer.js";
import {
  ChatRelayPool,
  buildChannelCreateTemplate,
  buildChannelMessageTemplate,
} from "../../lib/nostrChat.js";
import type { ChatSigner } from "../../lib/nostrChat.js";

/** 送信の結果。文言は表示側が決める（このフックは i18n を知らない） */
export type ChatSendResult = "ok" | "offline" | "failed";

export interface ChatChannelState {
  /** 受信バッファ（表示の絞り込みは呼び出し側） */
  messages: NostrEvent[];
  /** 確定したチャンネルID（未確定は null） */
  channelId: string | null;
  relayConnected: boolean;
  /** 部屋の開設に失敗したときの文言キー（表示側で t() する） */
  channelErrorKey: ChatChannelErrorKey | null;
  /** 使用するリレー（運用設定。payload 取得前は既定値） */
  relays: string[];
  send: (text: string) => Promise<ChatSendResult>;
}

/**
 * リレーへの接続・チャンネルの確定・購読・送信 (#199 / #215)。
 *
 * 鍵の選び方 (useChatSigner) とは分けてある: 鍵まわりを直すときに購読や
 * 投影用画面を壊さないため (#335)。繋ぐのは渡された署名器で行い、
 * それが本人の鍵か一時鍵か読み取り専用かはここでは区別しない
 * （部屋の開設経路の判定にだけ isOrganizerNip07 を使う）。
 */
export function useChatChannel({
  eventId,
  eventTitle,
  chat,
  signer,
  activeSigner,
  isOrganizerNip07,
  canOpenChannel,
  chatUnavailable,
}: {
  eventId: string;
  eventTitle: string;
  chat: ChatMembersPayload | undefined;
  /** 発言に使う署名器（未参加・投影用は null。送信にはこれだけを使う） */
  signer: ChatSigner | null;
  /** リレーに繋ぐ署名器（投影用は読み取り専用の使い捨て鍵） */
  activeSigner: ChatSigner | null;
  /** 部屋を開く人が「主催者本人 × 本人の鍵」か (#199 / NIP-70 #460)。
   * 非同期処理の途中で最新の値を見るため、値ではなく関数で受け取る */
  isOrganizerNip07: () => boolean;
  /** 部屋を開設してよい立場か（スタッフのみ #221） */
  canOpenChannel: boolean;
  /** 繋がせない状態 (#283)。リレーにも接続しない */
  chatUnavailable: boolean;
}): ChatChannelState {
  const registerChannel = useRegisterChatChannel(eventId);
  const createChannel = useCreateChatChannel(eventId);

  const [messages, setMessages] = useState<NostrEvent[]>([]);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [relayConnected, setRelayConnected] = useState(false);
  const [channelErrorKey, setChannelErrorKey] =
    useState<ChatChannelErrorKey | null>(null);
  const poolRef = useRef<ChatRelayPool | null>(null);

  const relays = useMemo(
    () => (chat?.relays?.length ? chat.relays : [...CHAT_RELAYS]),
    [chat],
  );
  // 内容が同じなら再接続しないための比較キー
  const relaysKey = relays.join(" ");

  // チャンネル確定処理から最新の chat-members を参照するための ref
  const chatRef = useRef(chat);
  chatRef.current = chat;
  // 受信バッファの捨てる順序に使う許可リスト（chatMessageBuffer.ts）。
  // チャンネルIDは公開値なので部外者がゴミ投稿を流し込める。購読コールバックは
  // effect 内で閉じるので、ポーリングで更新される最新の集合を ref 経由で見せる
  // 自分の鍵も「捨ててよくない」側に入れる: 許可リストは〜5秒遅れて届くので、
  // 入った直後に発言した本人はリスト上まだ部外者に見え、満杯のバッファでは
  // いま送った自分の発言が真っ先に捨てられてしまう (#335 レビュー指摘)
  const keepRef = useRef<(pubkey: string) => boolean>(() => true);
  keepRef.current = bufferAllowPredicate(
    new Set((chat?.members ?? []).map((m) => m.pubkey)),
    signer?.pubkey,
  );
  const append = (prev: NostrEvent[], ev: NostrEvent) =>
    appendChatMessage(prev, ev, (pk) => keepRef.current(pk));

  // サーバーに登録済みのチャンネルID（未開設は null。ポーリングで反映）
  const serverChannelId = chat?.channelId ?? null;

  // 接続・チャンネル確定・購読。署名器が決まったら開始し、unmount で切断
  useEffect(() => {
    if (!activeSigner) return;
    // 繋がせない状態 (#283) ではリレーにも接続しない。
    // 署名器が手元に残っていても、購読も送信も始めない
    if (chatUnavailable) return;
    // 部屋が未開設なら、開設できる人以外は待つ
    // （serverChannelId が入ると deps 経由でこの effect が再実行される）
    if (!serverChannelId && !canOpenChannel) return;
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

      // チャンネルIDを確定する（未登録ならスタッフの操作で開設して先勝ちで登録）
      let cid = chatRef.current?.channelId ?? serverChannelId;
      if (!cid) {
        try {
          // チャンネル作成鍵の方針 (#199): 参加者個人の鍵では作らない。
          // NIP-70 (#460) の「AUTH 済み pubkey ＝ イベントの pubkey」を満たすため、
          // 署名した鍵の持ち主の接続から発行する:
          // - 主催者(createdBy)本人が NIP-07 で参加している → 主催者の鍵で署名し、
          //   本人の AUTH 済み接続（このプール）から発行して登録する
          // - それ以外（参加者が最初に開いた等） → サーバーが公式サービス鍵で
          //   署名・リレー発行・登録まで行う（/chat-channel/create 1発）
          if (isOrganizerNip07()) {
            const created: NostrEvent = await activeSigner.signEvent(
              buildChannelCreateTemplate(eventTitle),
            );
            // リレーに受理されたことを確認してからサーバーへ登録する
            // （不達のまま登録すると「リレー上に存在しない部屋」を参照し続けてしまう）
            const accepted = await pool.publish(created);
            if (!accepted) {
              if (!disposed) {
                setChannelErrorKey("eventSocial.chatChannelCreateRejected");
              }
              return;
            }
            const { channelId: settled } =
              await registerChannel.mutateAsync(created);
            cid = settled ?? created.id;
          } else {
            const { channelId: settled } = await createChannel.mutateAsync();
            if (!settled) throw new Error("channel_not_settled");
            cid = settled;
          }
        } catch (err) {
          if (!disposed) setChannelErrorKey(chatChannelErrorKey(err));
          return;
        }
      }
      if (disposed) return;
      setChannelId(cid);
      unsubscribe = pool.subscribe(cid, (ev) => {
        if (disposed) return;
        setMessages((prev) => append(prev, ev));
      });
    })();

    return () => {
      disposed = true;
      unsubscribe?.();
      pool.close();
      poolRef.current = null;
      setRelayConnected(false);
      setMessages([]);
      setChannelId(null);
    };
    // registerChannel / createChannel（mutation オブジェクト）は
    // 毎レンダーで変わるため依存に含めない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeSigner,
    eventTitle,
    relaysKey,
    serverChannelId,
    canOpenChannel,
    chatUnavailable,
  ]);

  /** 発言する。**署名は signer（参加した鍵）だけ**で行う
   * ＝投影用の読み取り専用鍵では送信できない (#215) */
  const send = async (text: string): Promise<ChatSendResult> => {
    if (!signer || !channelId) return "failed";
    try {
      const ev = await signer.signEvent(
        buildChannelMessageTemplate(channelId, text, relays[0]),
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

  return {
    messages,
    channelId,
    relayConnected,
    channelErrorKey,
    relays,
    send,
  };
}
