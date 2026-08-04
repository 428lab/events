import type {
  Community,
  CommunityLink,
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
  icon_updated_at: number | null;
  banner_updated_at: number | null;
  links: string | null;
  owner_id: string;
  created_at: number;
  member_count: number;
  event_count: number;
}

function parseLinks(json: string | null): CommunityLink[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function communityImageUrl(
  id: string,
  kind: "icon" | "banner",
  updatedAt: number | null,
): string | null {
  return updatedAt ? `/api/communities/${id}/${kind}?v=${updatedAt}` : null;
}

// メンバー数＝明示メンバー ∪ 所属イベントの確定参加者（重複排除）。
// 退会申請中 (#250) はメンバー一覧に出さないので数からも外す（数字が合わなくなる）
const SELECT_COMMUNITY = `SELECT c.*,
  (SELECT COUNT(*) FROM (
     SELECT user_id FROM community_member WHERE community_id = c.id
     UNION
     SELECT em.user_id FROM event_member em JOIN event e ON e.id = em.event_id
       WHERE e.community_id = c.id AND em.status = 'confirmed'
   ) ids JOIN user u ON u.id = ids.user_id AND u.deleted_at IS NULL) AS member_count,
  (SELECT COUNT(1) FROM event e WHERE e.community_id = c.id AND e.status = 'published') AS event_count
  FROM community c`;

function toCommunity(row: CommunityRow): Community {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    iconUrl: communityImageUrl(row.id, "icon", row.icon_updated_at),
    bannerUrl: communityImageUrl(row.id, "banner", row.banner_updated_at),
    links: parseLinks(row.links),
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
      "UPDATE community SET name = ?, description = ?, links = ? WHERE id = ?",
      input.name ?? current.name,
      input.description ?? current.description,
      JSON.stringify(input.links ?? current.links),
      id,
    );
    return this.findById(id);
  },

  /** 画像アップロード時刻の取得（配信ルートの ETag/404 判定用） */
  async imageUpdatedAt(
    id: string,
    kind: "icon" | "banner",
  ): Promise<number | null> {
    const col = kind === "icon" ? "icon_updated_at" : "banner_updated_at";
    const row = await one<{ v: number | null }>(
      `SELECT ${col} AS v FROM community WHERE id = ?`,
      id,
    );
    return row?.v ?? null;
  },

  async setImageUpdated(
    id: string,
    kind: "icon" | "banner",
    ts: number,
  ): Promise<void> {
    const col = kind === "icon" ? "icon_updated_at" : "banner_updated_at";
    await run(`UPDATE community SET ${col} = ? WHERE id = ?`, ts, id);
  },

  async delete(id: string): Promise<void> {
    // event.community_id はFK制約を張っていないため手動で外す
    await run("UPDATE event SET community_id = NULL WHERE community_id = ?", id);
    // たまごは全体たまご化（メンバー限定は所属先が消えるので限定も解除）
    await run(
      "UPDATE event_request SET community_id = NULL, members_only = 0 WHERE community_id = ?",
      id,
    );
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

  /** ユーザーが所属する全コミュニティ（明示メンバー ∪ イベント確定参加）。プロフィール表示用 */
  async listForUser(userId: string): Promise<CommunitySummary[]> {
    const rows = await many<{
      id: string;
      slug: string;
      name: string;
      icon_updated_at: number | null;
      role: string;
      my_event_count: number;
    }>(
      `SELECT c.id, c.slug, c.name, c.icon_updated_at, COALESCE(cm.role, 'member') AS role,
              (SELECT COUNT(*) FROM event_member em JOIN event e ON e.id = em.event_id
                WHERE e.community_id = c.id AND em.user_id = ?
                  AND em.status = 'confirmed' AND e.status = 'published') AS my_event_count
       FROM community c
       LEFT JOIN community_member cm ON cm.community_id = c.id AND cm.user_id = ?
       WHERE c.id IN (
         SELECT community_id FROM community_member WHERE user_id = ?
         UNION
         SELECT e.community_id FROM event_member em JOIN event e ON e.id = em.event_id
           WHERE em.user_id = ? AND em.status = 'confirmed' AND e.community_id IS NOT NULL
       )
       ORDER BY (COALESCE(cm.role,'') = 'owner') DESC,
                (COALESCE(cm.role,'') = 'admin') DESC, c.created_at DESC`,
      userId,
      userId,
      userId,
      userId,
    );
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      iconUrl: communityImageUrl(r.id, "icon", r.icon_updated_at),
      role: r.role as CommunityRole,
      myEventCount: r.my_event_count,
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

  /** 明示メンバー ∪ 所属イベントの確定参加者。参加のみの人は role='member' */
  async listMembers(communityId: string): Promise<CommunityMember[]> {
    const rows = await many<{
      user_id: string;
      username: string;
      global_name: string | null;
      avatar_url: string | null;
      role: string;
    }>(
      `SELECT u.id AS user_id, u.username, u.global_name, u.avatar_url,
              COALESCE(cm.role, 'member') AS role
       FROM (
         SELECT user_id FROM community_member WHERE community_id = ?
         UNION
         SELECT em.user_id FROM event_member em JOIN event e ON e.id = em.event_id
           WHERE e.community_id = ? AND em.status = 'confirmed'
       ) ids
       JOIN user u ON u.id = ids.user_id AND u.deleted_at IS NULL
       LEFT JOIN community_member cm
         ON cm.community_id = ? AND cm.user_id = ids.user_id
       ORDER BY (COALESCE(cm.role,'') = 'owner') DESC,
                (COALESCE(cm.role,'') = 'admin') DESC,
                u.username ASC`,
      communityId,
      communityId,
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
