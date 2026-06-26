import { useEventEntries, useEventMembers } from "../api/hooks.js";

export interface ResolvedUser {
  username: string;
  name: string;
  avatarUrl: string | null;
}

/** entryId からプロフィールリンク用のユーザー情報を解決する関数を返す。
 * 個人エントリ（メンバー1人）のみ解決。チーム等は null（リンクしない）。 */
export function useEntryUserResolver(eventId: string) {
  const { data: entries } = useEventEntries(eventId);
  const { data: members } = useEventMembers(eventId, true);
  const userById = new Map(
    (members ?? []).map((m) => [m.user.id, m.user] as const),
  );
  const entryById = new Map((entries ?? []).map((e) => [e.id, e] as const));
  return (entryId: string): ResolvedUser | null => {
    const entry = entryById.get(entryId);
    if (!entry || entry.memberUserIds.length !== 1) return null;
    const u = userById.get(entry.memberUserIds[0]);
    if (!u) return null;
    return {
      username: u.username,
      name: u.globalName ?? u.username,
      avatarUrl: u.avatarUrl,
    };
  };
}
