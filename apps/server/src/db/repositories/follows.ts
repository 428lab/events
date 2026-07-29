import { many, one, run } from "../client.js";

/** ユーザーフォロー (#21)。一覧は本人のみ・数は公開 */
export const followsRepo = {
  async follow(followerId: string, followeeId: string): Promise<void> {
    await run(
      `INSERT OR IGNORE INTO user_follow (follower_id, followee_id, created_at)
       VALUES (?, ?, ?)`,
      followerId,
      followeeId,
      Date.now(),
    );
  },

  async unfollow(followerId: string, followeeId: string): Promise<void> {
    await run(
      "DELETE FROM user_follow WHERE follower_id = ? AND followee_id = ?",
      followerId,
      followeeId,
    );
  },

  async isFollowing(followerId: string, followeeId: string): Promise<boolean> {
    const row = await one<{ n: number }>(
      "SELECT 1 AS n FROM user_follow WHERE follower_id = ? AND followee_id = ?",
      followerId,
      followeeId,
    );
    return Boolean(row);
  },

  async followerCount(userId: string): Promise<number> {
    const row = await one<{ n: number }>(
      "SELECT COUNT(1) AS n FROM user_follow WHERE followee_id = ?",
      userId,
    );
    return row?.n ?? 0;
  },

  async followingCount(userId: string): Promise<number> {
    const row = await one<{ n: number }>(
      "SELECT COUNT(1) AS n FROM user_follow WHERE follower_id = ?",
      userId,
    );
    return row?.n ?? 0;
  },

  /** フォロワーのユーザーID（通知ファンアウト用） */
  async followerIds(userId: string): Promise<string[]> {
    const rows = await many<{ follower_id: string }>(
      "SELECT follower_id FROM user_follow WHERE followee_id = ?",
      userId,
    );
    return rows.map((r) => r.follower_id);
  },

  /** 指定の通知種別をONにしているフォロワーのみ（行が無ければ既定=ON） */
  async followerIdsWanting(
    userId: string,
    kind: "followee_created" | "followee_joined",
  ): Promise<string[]> {
    // kind はリテラル2種のみ（ユーザー入力ではない）なので列名に直接使う
    const col = kind === "followee_created" ? "followee_created" : "followee_joined";
    const rows = await many<{ follower_id: string }>(
      `SELECT f.follower_id
         FROM user_follow f
         LEFT JOIN notification_pref p ON p.user_id = f.follower_id
        WHERE f.followee_id = ? AND COALESCE(p.${col}, 1) = 1`,
      userId,
    );
    return rows.map((r) => r.follower_id);
  },

  /** 自分がフォロー中のユーザー（マイページ用・本人のみ） */
  async listFollowing(userId: string): Promise<
    {
      id: string;
      username: string;
      globalName: string | null;
      avatarUrl: string | null;
    }[]
  > {
    const rows = await many<{
      id: string;
      username: string;
      global_name: string | null;
      avatar_url: string | null;
    }>(
      `SELECT u.id, u.username, u.global_name, u.avatar_url
         FROM user_follow f JOIN user u ON u.id = f.followee_id
        WHERE f.follower_id = ? ORDER BY f.created_at DESC`,
      userId,
    );
    return rows.map((r) => ({
      id: r.id,
      username: r.username,
      globalName: r.global_name,
      avatarUrl: r.avatar_url,
    }));
  },
};
