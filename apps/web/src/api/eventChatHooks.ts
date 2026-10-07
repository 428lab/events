import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChatMembersPayload } from "@eventer/shared";
import { api, ApiError } from "./client.js";

/** Nostrイベントチャット (#199) の紐付けAPI。チャット本文はリレー直通でここを通らない */

/** 配信画面（OBS の /live/screen）だけがチャットの許可リストを取り直す間隔 */
export const LIVE_SCREEN_CHAT_POLL_MS = 5000;

/** 表示許可リスト＋チャンネルID＋非表示リスト。
 *
 * 定期の取り直しはしない（D-POLL-MIN。チャット本文は Nostr で届く）。取り直すのは:
 * 開いたとき・タブ復帰・知らない pubkey の発言（useChatChannel）・手動の「もう一度」・
 * 自分の参加や非表示の操作（invalidate）。
 *
 * poll は配信画面（OBS の /live/screen）だけが立てる（5秒・非表示でも継続）:
 * 配信に載せるコメントの許可（非表示・締め出し・オフ）を数秒で反映しなければならず、
 * OBS のブラウザソースは常に hidden 扱いで誰も触れないため */
export function useChatMembers(eventId: string, enabled: boolean, failClosed = false, poll = false) {
  return useQuery({
    queryKey: ["event", eventId, "chatMembers"],
    enabled: enabled && Boolean(eventId),
    refetchInterval: poll ? LIVE_SCREEN_CHAT_POLL_MS : false,
    refetchIntervalInBackground: poll,
    refetchOnWindowFocus: true,
    // 403（繋がせない状態 #283 / 参加確定前）は再試行しても結果が変わらないので
    // 既定の3回リトライを待たずに画面へ返す。締め出しが解除されたら、
    // タブ復帰・「もう一度」で取り直したときに元に戻る。
    // 403以外は既定のまま: react-query は失敗のたびに 0 から数えた count を渡し、
    // 既定の retry:3 も `count < 3` で判定するので、この式は既定と同じ3回になる
    retry: (count, err) =>
      !failClosed && !(err instanceof ApiError && [401,403,404].includes(err.status)) && count < 3,
    queryFn: () =>
      api.get<ChatMembersPayload>(`/events/${eventId}/chat-members`),
  });
}

/** サーバー管理の一時鍵 (#223)。未発行・NIP-07登録中（404）は null、それ以外の失敗は throw */
export async function fetchEphemeralChatKey(
  eventId: string,
): Promise<{ secret: string; pubkey: string } | null> {
  try {
    return await api.get<{ secret: string; pubkey: string }>(
      `/events/${eventId}/chat-key/ephemeral`,
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/** 一時鍵を発行して発言鍵として登録（既にあれば同じ鍵が返る） */
export function useCreateEphemeralChatKey(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ secret: string; pubkey: string }>(
        `/events/${eventId}/chat-key/ephemeral`,
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["event", eventId, "chatMembers"] }),
  });
}

/** 発言用の公開鍵を登録（再登録で置き換え） */
export function useRegisterChatKey(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (proof: object) =>
      api.post(`/events/${eventId}/chat-key`, { proof }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["event", eventId, "chatMembers"] }),
  });
}

/** チャンネルID（kind:40）を登録。先勝ちのため、確定したIDが返る */
export function useRegisterChatChannel(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channelEvent: object) =>
      api.post<{ channelId: string | null }>(`/events/${eventId}/chat-channel`, {
        channelEvent,
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["event", eventId, "chatMembers"] }),
  });
}

/** 公式サービス鍵でチャンネルを開設する (#460)。署名・リレーへの発行・登録まで
 * サーバーが1リクエストで行い、確定した channelId が返る（既設なら既存ID）。
 * 公式鍵未設定は 503 (service_key_unset)、全リレー失敗は 502 (relay_publish_failed) */
export function useCreateChatChannel(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ channelId: string | null }>(
        `/events/${eventId}/chat-channel/create`,
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["event", eventId, "chatMembers"] }),
  });
}

/** メッセージをアプリ側で非表示にする（staff） */
export function useHideChatNote(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) =>
      api.post(`/events/${eventId}/chat-hidden`, { noteId }),
    // 非表示リストは平文・暗号化 (#582) で共通の表。どちらの画面にもすぐ反映する
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["event", eventId, "chatMembers"] }),
        qc.invalidateQueries({ queryKey: ["event", eventId, "encryptedChat"] }),
      ]),
  });
}

/** 非表示を解除する（staff） */
export function useUnhideChatNote(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) =>
      api.del(`/events/${eventId}/chat-hidden/${noteId}`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["event", eventId, "chatMembers"] }),
  });
}

/** チャンネルIDをリセット（staff・部屋の作り直し用） */
export function useResetChatChannel(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.del(`/events/${eventId}/chat-channel`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["event", eventId, "chatMembers"] }),
  });
}
