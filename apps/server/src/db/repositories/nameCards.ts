import { gamificationFromStats } from "@eventer/shared";
import type {
  EventNameCard,
  EventRole,
  GamificationStats,
  NameCardCommunity,
  NameCardParticipation,
} from "@eventer/shared";
import { many } from "../client.js";
import { communityImageUrl } from "./communities.js";

/** 名札の一括印刷 (#304) 用の読み取り。
 *
 * カードに刷る値（レベル・XP・バッジ・参加実績・所属コミュニティ）は
 * 公開プロフィール API と同じ導出値だが、あちらは1人あたり10本近いクエリを
 * 撃つので100人分をそのまま呼ぶと現実的でない。ここでは同じ集計を
 * user_id で GROUP BY した一括版として持つ。対象は「このイベントの参加確定
 * メンバー」に決まっているので、IDの配列を渡す代わりにその条件そのものを
 * CTE (ids) にして各集計から参照する。おかげでクエリ本数もバインド数も
 * 人数に依存しない。
 *
 * 集計の定義（有効イベントの条件・出席の数え方）は gamification.ts /
 * eventMembers.ts の単体版と一字一句そろえてある。 */

/** カードに載せる所属コミュニティの最大数（LicenseCardSvg の帯が5個まで） */
const MAX_COMMUNITIES = 5;

/** 対象ユーザー＝このイベントの参加確定メンバー（退会申請中 #250 は除く）。
 * 各集計クエリの先頭に置く共通CTE。バインドは eventId ひとつ */
const IDS_CTE = `ids AS (
   SELECT m.user_id AS id FROM event_member m
     JOIN user u ON u.id = m.user_id AND u.deleted_at IS NULL
    WHERE m.event_id = ? AND m.status = 'confirmed'
 )`;

/** 有効イベント（公開・終了済み・確定4人以上）。gamification.ts の qual と同一定義 */
const QUAL_CTE = `qual AS (
   SELECT e.id, e.created_by, e.attendance_check
     FROM event e
    WHERE e.status = 'published' AND e.ends_at > 0 AND e.ends_at < ?
      AND (SELECT COUNT(*) FROM event_member m
            JOIN user mu ON mu.id = m.user_id AND mu.deleted_at IS NULL
            WHERE m.event_id = e.id AND m.status = 'confirmed') >= 4
 )`;

/** (uid, k, v) 形式の集計行 */
interface MetricRow {
  uid: string;
  k: string;
  v: number;
}

/** uid → メトリクス名 → 値 に畳む */
function tally(rows: MetricRow[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const m = out.get(r.uid) ?? new Map<string, number>();
    m.set(r.k, r.v ?? 0);
    out.set(r.uid, m);
  }
  return out;
}

/** 有効イベント基準の実績（gamificationRepo.statsForUser の一括版）。
 * D1 (workerd) の SQLite は1つの複合SELECTに並べられる項の数が非常に少ない
 * （超えると "too many terms in compound SELECT"。trending.ts と同じ制約）ので、
 * UNION ALL は3項までに抑えて2本に分ける */
async function gamificationMetrics(
  eventId: string,
  now: number,
): Promise<MetricRow[]> {
  const head = many<MetricRow>(
    `WITH ${IDS_CTE}, ${QUAL_CTE}
     SELECT m.user_id AS uid, 'hosted' AS k, COUNT(*) AS v
       FROM event_member m JOIN qual q ON q.id = m.event_id
       JOIN ids ON ids.id = m.user_id
      WHERE m.role = 'staff' AND m.status = 'confirmed' AND q.created_by = m.user_id
      GROUP BY m.user_id
     UNION ALL
     SELECT m.user_id, 'staffed', COUNT(*)
       FROM event_member m JOIN qual q ON q.id = m.event_id
       JOIN ids ON ids.id = m.user_id
      WHERE m.role = 'staff' AND m.status = 'confirmed' AND q.created_by <> m.user_id
      GROUP BY m.user_id
     UNION ALL
     SELECT si.speaker_user_id, 'spoken', COUNT(DISTINCT q.id)
       FROM event_schedule_item si JOIN qual q ON q.id = si.event_id
       JOIN ids ON ids.id = si.speaker_user_id
      GROUP BY si.speaker_user_id`,
    eventId,
    now,
  );
  const tail = many<MetricRow>(
    `WITH ${IDS_CTE}, ${QUAL_CTE}
     SELECT m.user_id AS uid, 'attended' AS k, COUNT(*) AS v
       FROM event_member m JOIN qual q ON q.id = m.event_id
       JOIN ids ON ids.id = m.user_id
      WHERE m.role = 'participant' AND m.status = 'confirmed'
        AND (q.attendance_check = 0 OR m.attended = 1)
      GROUP BY m.user_id
     UNION ALL
     SELECT l.target_key, 'likes', COUNT(*)
       FROM event_like l JOIN qual q ON q.id = l.event_id
       JOIN user lu ON lu.id = l.user_id AND lu.deleted_at IS NULL
       JOIN ids ON ids.id = l.target_key
      WHERE l.kind IN ('host', 'staff', 'participant')
      GROUP BY l.target_key
     UNION ALL
     SELECT uid, 'meets', SUM(cnt) FROM (
        SELECT ids.id AS uid, em.event_id AS eid, COUNT(*) AS cnt
          FROM event_meet em JOIN qual q ON q.id = em.event_id
          JOIN ids ON ids.id = em.user_low OR ids.id = em.user_high
          JOIN user ou ON ou.id = CASE WHEN em.user_low = ids.id
                                         THEN em.user_high ELSE em.user_low END
                       AND ou.deleted_at IS NULL
         GROUP BY ids.id, em.event_id)
      GROUP BY uid`,
    eventId,
    now,
  );
  const [a, b] = await Promise.all([head, tail]);
  return [...a, ...b];
}

/** カードに出る参加実績（eventMembersRepo.participationStats の一括版）。
 * カードは出席・無断欠席・主催・登壇しか使わないのでキャンセル内訳は数えない */
async function participationMetrics(
  eventId: string,
  now: number,
): Promise<MetricRow[]> {
  const attendance = many<MetricRow>(
    `WITH ${IDS_CTE}
     SELECT m.user_id AS uid, 'attended' AS k, COUNT(*) AS v
       FROM event_member m JOIN event e ON e.id = m.event_id
       JOIN ids ON ids.id = m.user_id
      WHERE m.role = 'participant' AND m.status = 'confirmed'
        AND e.status = 'published' AND e.ends_at > 0 AND e.ends_at < ?
        AND (e.attendance_check = 0 OR m.attended = 1)
      GROUP BY m.user_id
     UNION ALL
     SELECT m.user_id, 'noShow', COUNT(*)
       FROM event_member m JOIN event e ON e.id = m.event_id
       JOIN ids ON ids.id = m.user_id
      WHERE m.role = 'participant' AND m.status = 'confirmed'
        AND e.status = 'published' AND e.ends_at > 0 AND e.ends_at < ?
        AND e.attendance_check = 1 AND m.attended = 0
      GROUP BY m.user_id`,
    eventId,
    now,
    now,
  );
  const roles = many<MetricRow>(
    `WITH ${IDS_CTE}
     SELECT m.user_id AS uid, 'hosted' AS k, COUNT(*) AS v
       FROM event_member m JOIN event e ON e.id = m.event_id
       JOIN ids ON ids.id = m.user_id
      WHERE m.role = 'staff' AND m.status = 'confirmed'
        AND e.created_by = m.user_id AND e.status = 'published'
        AND e.ends_at > 0 AND e.ends_at < ?
      GROUP BY m.user_id
     UNION ALL
     SELECT si.speaker_user_id, 'spoken', COUNT(DISTINCT e.id)
       FROM event_schedule_item si JOIN event e ON e.id = si.event_id
       JOIN ids ON ids.id = si.speaker_user_id
      WHERE e.status = 'published' AND e.ends_at > 0 AND e.ends_at < ?
      GROUP BY si.speaker_user_id`,
    eventId,
    now,
    now,
  );
  const [a, b] = await Promise.all([attendance, roles]);
  return [...a, ...b];
}

interface CommunityRow {
  uid: string;
  cid: string;
  name: string;
  icon_updated_at: number | null;
}

/** 所属コミュニティの上位（communitiesRepo.listForUser ＋ カード側の
 * 「参加イベント数の多い順に5件」を1本にまとめたもの）。
 * 同数の並びは listForUser と同じく owner → admin → 新しい順にそろえる */
async function communitiesFor(
  eventId: string,
): Promise<Map<string, NameCardCommunity[]>> {
  const rows = await many<CommunityRow>(
    `WITH ${IDS_CTE},
     mine AS (
       SELECT cm.user_id AS uid, cm.community_id AS cid
         FROM community_member cm JOIN ids ON ids.id = cm.user_id
       UNION
       SELECT em.user_id, e.community_id
         FROM event_member em JOIN event e ON e.id = em.event_id
         JOIN ids ON ids.id = em.user_id
        WHERE em.status = 'confirmed' AND e.community_id IS NOT NULL
     ),
     counted AS (
       SELECT mine.uid AS uid, c.id AS cid, c.name AS name,
              c.icon_updated_at AS icon_updated_at, c.created_at AS created_at,
              COALESCE(cm.role, '') AS role,
              (SELECT COUNT(*) FROM event_member em2
                 JOIN event e2 ON e2.id = em2.event_id
                WHERE e2.community_id = c.id AND em2.user_id = mine.uid
                  AND em2.status = 'confirmed' AND e2.status = 'published') AS cnt
         FROM mine JOIN community c ON c.id = mine.cid
         LEFT JOIN community_member cm
                ON cm.community_id = c.id AND cm.user_id = mine.uid
     ),
     ranked AS (
       SELECT uid, cid, name, icon_updated_at,
              ROW_NUMBER() OVER (
                PARTITION BY uid
                ORDER BY cnt DESC, (role = 'owner') DESC, (role = 'admin') DESC,
                         created_at DESC
              ) AS rn
         FROM counted
     )
     SELECT uid, cid, name, icon_updated_at FROM ranked WHERE rn <= ${MAX_COMMUNITIES}
      ORDER BY uid, rn`,
    eventId,
  );
  const out = new Map<string, NameCardCommunity[]>();
  for (const r of rows) {
    const list = out.get(r.uid) ?? [];
    list.push({
      id: r.cid,
      name: r.name,
      iconUrl: communityImageUrl(r.cid, "icon", r.icon_updated_at),
    });
    out.set(r.uid, list);
  }
  return out;
}

interface MemberRow {
  user_id: string;
  role: string;
  username: string;
  global_name: string | null;
  avatar_url: string | null;
  created_at: number;
}

const ZERO_STATS: GamificationStats = {
  hosted: 0,
  staffed: 0,
  spoken: 0,
  attendedQualifying: 0,
  likesReceivedQualifying: 0,
  meets: 0,
};

const ZERO_PARTICIPATION: NameCardParticipation = {
  attended: 0,
  noShow: 0,
  hosted: 0,
  spoken: 0,
};

export const nameCardsRepo = {
  /** イベントの参加確定メンバー全員分の名札データ。参加登録順。
   * ロールは絞らない（スタッフ・審査員・観覧者にも名札は要る） */
  async listForEvent(eventId: string, now: number): Promise<EventNameCard[]> {
    const [members, gm, pm, communities] = await Promise.all([
      many<MemberRow>(
        `SELECT m.user_id AS user_id, m.role AS role, u.username AS username,
                u.global_name AS global_name, u.avatar_url AS avatar_url,
                u.created_at AS created_at
           FROM event_member m
           JOIN user u ON u.id = m.user_id
          WHERE m.event_id = ? AND m.status = 'confirmed'
            AND u.deleted_at IS NULL
          ORDER BY m.created_at ASC`,
        eventId,
      ),
      gamificationMetrics(eventId, now),
      participationMetrics(eventId, now),
      communitiesFor(eventId),
    ]);

    const stats = tally(gm);
    const participation = tally(pm);

    return members.map((m) => {
      const g = stats.get(m.user_id);
      const p = participation.get(m.user_id);
      return {
        id: m.user_id,
        role: m.role as EventRole,
        handle: m.username,
        name: m.global_name ?? m.username,
        avatarUrl: m.avatar_url,
        createdAt: m.created_at,
        participation: p
          ? {
              attended: p.get("attended") ?? 0,
              noShow: p.get("noShow") ?? 0,
              hosted: p.get("hosted") ?? 0,
              spoken: p.get("spoken") ?? 0,
            }
          : ZERO_PARTICIPATION,
        gamification: gamificationFromStats(
          g
            ? {
                hosted: g.get("hosted") ?? 0,
                staffed: g.get("staffed") ?? 0,
                spoken: g.get("spoken") ?? 0,
                attendedQualifying: g.get("attended") ?? 0,
                likesReceivedQualifying: g.get("likes") ?? 0,
                meets: g.get("meets") ?? 0,
              }
            : ZERO_STATS,
        ),
        communities: communities.get(m.user_id) ?? [],
      };
    });
  },
};
