import type {
  Community,
  CommunityMember,
  CommunityRole,
  CommunitySummary,
  CreateCommunityInput,
  UpdateCommunityInput,
} from "@eventer/shared";
import { batch, many, one, run } from "../client.js";

interface CommunityRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon_url: string | null;
  owner_id: string;
  created_at: number;
  member_count: number;
  event_count: number;
}

const SELECT_COMMUNITY = `SELECT c.*,
  (SELECT COUNT(1) FROM community_member m WHERE m.community_id = c.id) AS member_count,
  (SELECT COUNT(1) FROM event e WHERE e.community_id = c.id AND e.status = 'published') AS event_count
  FROM community c`;

function toCommunity(row: CommunityRow): Community {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    iconUrl: row.icon_url,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    memberCount: row.member_count ?? 0,
    eventCount: row.event_count ?? 0,
  };
}

export const communitiesRepo = {
  async findBySlug(slug: string): Promise<Community | null> {
    const row = await one<CommunityRow>(
      `${SELECT_COMMUNITY} WHERE c.slug = ? COLLATE NOCASE`,
      slug,
    );
    return row ? toCommunity(row) : null;
  },

  async findById(id: string): Promise<Community | null> {
    const row = await one<CommunityRow>(`${SELECT_COMMUNITY} WHERE c.id = ?`, id);
    return row ? toCommunity(row) : null;
  },

  async slugTaken(slug: string): Promise<boolean> {
    const row = await one<{ id: string }>(
      "SELECT id FROM community WHERE slug = ? COLLATE NOCASE",
      slug,
    );
    return Boolean(row);
  },

  async list(): Promise<Community[]> {
    const rows = await many<CommunityRow>(
      `${SELECT_COMMUNITY} ORDER BY c.created_at DESC`,
    );
    return rows.map(toCommunity);
  },

  /** owner として作成し、オーナーをメンバー(role=owner)に登録 */
  async create(input: CreateCommunityInput, ownerId: string): Promise<Community> {
    const id = crypto.randomUUID();
    const now = Date.now();
    await run(
      `INSERT INTO community (id, slug, name, description, icon_url, owner_id, created_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      id,
      input.slug,
      input.name,
      input.description ?? "",
      ownerId,
      now,
    );
    await run(
      `INSERT INTO community_member (id, community_id, user_id, role, created_at)
       VALUES (?, ?, ?, 'owner', ?)`,
      crypto.randomUUID(),
      id,
      ownerId,
      now,
    );
    return (await this.findById(id))!;
  },

  async setIcon(id: string, iconUrl: string | null): Promise<void> {
    await run("UPDATE community SET icon_url = ? WHERE id = ?", iconUrl, id);
  },

  async update(id: string, input: UpdateCommunityInput): Promise<Community | null> {
    const current = await this.findById(id);
    if (!current) return null;
    await run(
      "UPDATE community SET name = ?, description = ? WHERE id = ?",
      input.name ?? current.name,
      input.description ?? current.description,
      id,
    );
    return this.findById(id);
  },

  async delete(id: string): Promise<void> {
    // event.community_id はFK制約を張っていないため手動で外す
    await run("UPDATE event SET community_id = NULL WHERE community_id = ?", id);
    await run("DELETE FROM community WHERE id = ?", id);
  },

  async memberRole(
    communityId: string,
    userId: string,
  ): Promise<CommunityRole | null> {
    const row = await one<{ role: string }>(
      "SELECT role FROM community_member WHERE community_id = ? AND user_id = ?",
      communityId,
      userId,
    );
    return (row?.role as CommunityRole | undefined) ?? null;
  },

  /** owner/admin（コミュニティ管理者）か */
  async isManager(communityId: string, userId: string): Promise<boolean> {
    const role = await this.memberRole(communityId, userId);
    return role === "owner" || role === "admin";
  },

  /** admin↔member のロール変更（owner は対象外。member でなければ先に参加させる） */
  async setMemberRole(
    communityId: string,
    userId: string,
    role: "admin" | "member",
  ): Promise<void> {
    const existing = await this.memberRole(communityId, userId);
    if (existing === "owner") return; // owner は変更不可
    if (existing == null) {
      await run(
        `INSERT INTO community_member (id, community_id, user_id, role, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        crypto.randomUUID(),
        communityId,
        userId,
        role,
        Date.now(),
      );
      return;
    }
    await run(
      "UPDATE community_member SET role = ? WHERE community_id = ? AND user_id = ?",
      role,
      communityId,
      userId,
    );
  },

  /** オーナー譲渡: toUser を owner、旧 owner を admin に。community.owner_id も更新 */
  async transferOwnership(
    communityId: string,
    fromUserId: string,
    toUserId: string,
  ): Promise<void> {
    await batch([
      {
        sql: "UPDATE community_member SET role = 'admin' WHERE community_id = ? AND user_id = ?",
        args: [communityId, fromUserId],
      },
      {
        sql: "UPDATE community_member SET role = 'owner' WHERE community_id = ? AND user_id = ?",
        args: [communityId, toUserId],
      },
      {
        sql: "UPDATE community SET owner_id = ? WHERE id = ?",
        args: [toUserId, communityId],
      },
    ]);
  },

  /** ユーザーが所属する全コミュニティ（プロフィール表示用、ロール付き） */
  async listForUser(userId: string): Promise<CommunitySummary[]> {
    const rows = await many<{
      id: string;
      slug: string;
      name: string;
      icon_url: string | null;
      role: string;
    }>(
      `SELECT c.id, c.slug, c.name, c.icon_url, m.role
       FROM community_member m JOIN community c ON c.id = m.community_id
       WHERE m.user_id = ?
       ORDER BY (m.role = 'owner') DESC, (m.role = 'admin') DESC, c.created_at DESC`,
      userId,
    );
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      iconUrl: r.icon_url,
      role: r.role as CommunityRole,
    }));
  },

  async join(communityId: string, userId: string): Promise<void> {
    await run(
      `INSERT OR IGNORE INTO community_member (id, community_id, user_id, role, created_at)
       VALUES (?, ?, ?, 'member', ?)`,
      crypto.randomUUID(),
      communityId,
      userId,
      Date.now(),
    );
  },

  /** オーナーは離脱不可（owner ロールは残す） */
  async leave(communityId: string, userId: string): Promise<void> {
    await run(
      "DELETE FROM community_member WHERE community_id = ? AND user_id = ? AND role <> 'owner'",
      communityId,
      userId,
    );
  },

  async listMembers(communityId: string): Promise<CommunityMember[]> {
    const rows = await many<{
      user_id: string;
      username: string;
      global_name: string | null;
      avatar_url: string | null;
      role: string;
    }>(
      `SELECT m.user_id, u.username, u.global_name, u.avatar_url, m.role
       FROM community_member m JOIN user u ON u.id = m.user_id
       WHERE m.community_id = ?
       ORDER BY (m.role = 'owner') DESC, m.created_at ASC`,
      communityId,
    );
    return rows.map((r) => ({
      userId: r.user_id,
      username: r.username,
      name: r.global_name ?? r.username,
      avatarUrl: r.avatar_url,
      role: r.role,
    }));
  },

  /** ユーザーがオーナー/管理者のコミュニティ（イベント紐付け先の候補） */
  async listOwnedByUser(userId: string): Promise<Community[]> {
    const rows = await many<CommunityRow>(
      `${SELECT_COMMUNITY}
       WHERE c.id IN (
         SELECT community_id FROM community_member
         WHERE user_id = ? AND role IN ('owner', 'admin')
       )
       ORDER BY c.created_at DESC`,
      userId,
    );
    return rows.map(toCommunity);
  },
};
