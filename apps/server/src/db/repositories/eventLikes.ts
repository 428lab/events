import type {
  EventLikeKind,
  EventLikeUserTarget,
  EventLikesSummary,
} from "@eventer/shared";
import { many, one, run } from "../client.js";

interface TargetUserRow {
  id: string;
  username: string;
  global_name: string | null;
  avatar_url: string | null;
}

function toTarget(row: TargetUserRow, count: number): EventLikeUserTarget {
  return {
    userId: row.id,
    username: row.username,
    name: row.global_name ?? row.username,
    avatarUrl: row.avatar_url,
    count,
  };
}

/** 参加者によるワンタップのいいね (#155)。匿名集計のみで誰が押したかは公開しない */
export const eventLikesRepo = {
  /** いいねのON/OFF。ONは重複挿入を無視（冪等）、OFFは行削除 */
  async setLike(
    eventId: string,
    userId: string,
    kind: EventLikeKind,
    targetKey: string,
    on: boolean,
  ): Promise<void> {
    if (on) {
      await run(
        `INSERT OR IGNORE INTO event_like (id, event_id, user_id, kind, target_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        crypto.randomUUID(),
        eventId,
        userId,
        kind,
        targetKey,
        Date.now(),
      );
    } else {
      await run(
        "DELETE FROM event_like WHERE event_id = ? AND user_id = ? AND kind = ? AND target_key = ?",
        eventId,
        userId,
        kind,
        targetKey,
      );
    }
  },

  /** イベントのいいね集計＋閲覧者自身の状態。
   * 主催者・スタッフはいいね0件でも行を返す（Web側の表示用にユーザー情報を解決） */
  async summaryForEvent(
    eventId: string,
    viewerUserId: string,
  ): Promise<EventLikesSummary> {
    const counts = await many<{ kind: string; target_key: string; n: number }>(
      "SELECT kind, target_key, COUNT(*) AS n FROM event_like WHERE event_id = ? GROUP BY kind, target_key",
      eventId,
    );
    const countOf = (kind: string, targetKey: string) =>
      counts.find((c) => c.kind === kind && c.target_key === targetKey)?.n ?? 0;

    // 主催者（event.created_by）のユーザー情報
    const hostRow = await one<TargetUserRow>(
      `SELECT u.id, u.username, u.global_name, u.avatar_url
         FROM event e JOIN user u ON u.id = e.created_by
        WHERE e.id = ?`,
      eventId,
    );

    // 現役スタッフ（主催者本人は host 側に出すため除外）
    const staffRows = await many<TargetUserRow>(
      `SELECT u.id, u.username, u.global_name, u.avatar_url
         FROM event_member m
         JOIN user u ON u.id = m.user_id
         JOIN event e ON e.id = m.event_id
        WHERE m.event_id = ? AND m.role = 'staff' AND m.status = 'confirmed'
          AND m.user_id <> e.created_by
        ORDER BY m.created_at ASC`,
      eventId,
    );

    // 参加者行（#160）。エンドポイント自体がメンバー限定なので全員に返す
    const participantRows = await many<TargetUserRow>(
      `SELECT u.id, u.username, u.global_name, u.avatar_url
         FROM event_member m
         JOIN user u ON u.id = m.user_id
        WHERE m.event_id = ? AND m.role = 'participant' AND m.status = 'confirmed'
        ORDER BY m.created_at ASC`,
      eventId,
    );

    const mine = await many<{ kind: string; target_key: string }>(
      "SELECT kind, target_key FROM event_like WHERE event_id = ? AND user_id = ?",
      eventId,
      viewerUserId,
    );

    return {
      event: countOf("event", ""),
      host: hostRow ? toTarget(hostRow, countOf("host", hostRow.id)) : null,
      staff: staffRows.map((r) => toTarget(r, countOf("staff", r.id))),
      // コミュニティ対象は target_key を見ずイベント単位で合算
      //（イベントのコミュニティは1つなので実質同値）
      community: counts
        .filter((c) => c.kind === "community")
        .reduce((sum, c) => sum + c.n, 0),
      participants: participantRows.map((r) =>
        toTarget(r, countOf("participant", r.id)),
      ),
      mine: mine.map((m) => ({
        kind: m.kind as EventLikeKind,
        targetKey: m.target_key,
      })),
    };
  },

  /** ユーザーが主催・スタッフとしてもらったいいね合計（公開イベントのみ） */
  async receivedCountForUser(userId: string): Promise<number> {
    const row = await one<{ v: number }>(
      `SELECT COUNT(*) AS v FROM event_like l
        JOIN event e ON e.id = l.event_id
        WHERE l.kind IN ('host', 'staff', 'participant') AND l.target_key = ?
          AND e.status = 'published'`,
      userId,
    );
    return row?.v ?? 0;
  },

  /** コミュニティがもらったいいね合計（公開イベントのみ） */
  async receivedCountForCommunity(communityId: string): Promise<number> {
    const row = await one<{ v: number }>(
      `SELECT COUNT(*) AS v FROM event_like l
        JOIN event e ON e.id = l.event_id
        WHERE l.kind = 'community' AND l.target_key = ?
          AND e.status = 'published'`,
      communityId,
    );
    return row?.v ?? 0;
  },
};
