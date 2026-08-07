import type { Event, EventRole } from "@eventer/shared";
import { useEvent, useEventMembers, useMe } from "../api/hooks.js";

export interface EventChatAccess {
  event: Event | null;
  myRole: EventRole | null;
  /** 参加確定メンバーか（チャット・Q&Aの閲覧条件） */
  canChat: boolean;
  /** チャットが実際に使えるか（イベント側の設定・状態も見る） */
  chatAvailable: boolean;
  isLoading: boolean;
  isError: boolean;
}

/**
 * チャット/Q&A を開ける条件をまとめたフック (#215)。
 * 判定は EventDetailPage の canComment と同じ（参加確定メンバーのみ）。
 * 専用ページ・投影用画面・登壇者サイドパネルで同じ条件を使うために切り出してある。
 */
export function useEventChatAccess(eventId: string): EventChatAccess {
  const { data: me } = useMe();
  const { data, isLoading, isError } = useEvent(eventId);
  const { data: members } = useEventMembers(eventId, true);

  const event = data?.event ?? null;
  const myRole = data?.myRole ?? null;
  const myMembership = members?.find((m) => me && m.userId === me.id);
  const canChat = myMembership
    ? myMembership.status === "confirmed"
    : Boolean(myRole);
  const chatAvailable =
    event !== null &&
    canChat &&
    event.chatEnabled &&
    !event.scheduling &&
    event.startsAt > 0 &&
    event.status === "published";

  return { event, myRole, canChat, chatAvailable, isLoading, isError };
}
