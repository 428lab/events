import {
  TRENDING_CANDIDATE_LIMIT,
  TRENDING_COMMUNITY_WEIGHTS,
  TRENDING_MIN_RISING_RATIO,
  TRENDING_MIN_RISING_SCORE,
  TRENDING_RATIO_SMOOTHING,
  TRENDING_USER_WEIGHTS,
  buildTrendingLists,
  trendingCommunityScore,
  trendingUserScore,
  type TrendingCommunityItem,
  type TrendingPayload,
  type TrendingUserItem,
} from "@eventer/shared";
import { many } from "../client.js";
import { communityImageUrl } from "./communities.js";

/** 退会申請中 (#250) を除く条件（任意のユーザーID列に対して）。kpi.ts と同じ */
const USER_ACTIVE = (col: string) =>
  `EXISTS (SELECT 1 FROM user u WHERE u.id = ${col} AND u.deleted_at IS NULL)`;

/** 「参加した人」の行の条件。kpi.ts の JOINED と同じ定義にすること。
 * 除くのは運営側の staff 行だけで、審査員 (judge)・観覧者 (observer) は
 * 実際にイベントに来る人なので参加者として数える。
 * KPI と定義がずれると同じ画面で数字が食い違って混乱する */
const JOINED = (t: string) => `${t}.role <> 'staff'`;

/** 開催済み（公開・日程確定済み・開催日設定済み）イベントの条件。バインド不要。
 * kpi.ts の HELD と同じ条件だが、**期間の切り出しはここに入れない**。
 * 集計期間は period() の CASE ＋ 集計側の `WHERE p > 0` が決めていて、
 * ここにも上下限を書くと同じ境界を2箇所にバインドすることになる。
 * 「まだ終わっていない」(ends_at >= now) は p = 0 になって落ちる */
const HELD = (t: string) =>
  `(${t}.status = 'published' AND ${t}.scheduling = 0 AND ${t}.ends_at > 0)`;

/** ユーザーの行動種別。TRENDING_USER_WEIGHTS のキーと1対1で対応させる */
const USER_KINDS = [
  "hosted",
  "staffed",
  "joined",
  "likeReceived",
  "meet",
  "eggPosted",
  "eggReaction",
  "followerGained",
] as const;
type UserKind = (typeof USER_KINDS)[number];

/** コミュニティの指標種別。TRENDING_COMMUNITY_WEIGHTS のキーと1対1 */
const COMMUNITY_KINDS = [
  "heldEvent",
  "participation",
  "newMember",
  "likeReceived",
] as const;
type CommunityKind = (typeof COMMUNITY_KINDS)[number];

interface Branch {
  sql: string;
  binds: unknown[];
}

/** D1 (workerd) の SQLite は1つの複合SELECTに並べられる項の数が非常に少ない
 * （超えると "too many terms in compound SELECT"）。項数がここを超えたら
 * サブクエリで包んで入れ子にする。バインドの順序は元のまま保たれる */
const MAX_COMPOUND_TERMS = 4;

function unionAll(sqls: string[]): string {
  if (sqls.length <= MAX_COMPOUND_TERMS) return sqls.join("\n UNION ALL\n");
  const groups: string[] = [];
  for (let i = 0; i < sqls.length; i += MAX_COMPOUND_TERMS) {
    const chunk = sqls.slice(i, i + MAX_COMPOUND_TERMS);
    groups.push(`SELECT uid, p, k FROM (\n${chunk.join("\n UNION ALL\n")}\n)`);
  }
  return unionAll(groups);
}

/** 集計結果の行（cur_* / prev_* が種別ごとに生える）。
 * 種別名は上の定数から生成するので、キーは string で受ける */
type AggRow = Record<string, number | string | null>;

const N = (v: number | string | null | undefined): number =>
  typeof v === "number" ? v : Number(v ?? 0) || 0;

/** SUM(CASE ...) の列を種別ごとに生成する。p=1 が今期間・p=2 が前期間 */
function sumColumns(kinds: readonly string[]): string {
  return kinds
    .flatMap((k) => [
      `COALESCE(SUM(CASE WHEN p = 1 AND k = '${k}' THEN 1 ELSE 0 END), 0) AS cur_${k}`,
      `COALESCE(SUM(CASE WHEN p = 2 AND k = '${k}' THEN 1 ELSE 0 END), 0) AS prev_${k}`,
    ])
    .join(",\n         ");
}

/** スコアの SQL 式。重みは共有定数からそのまま埋め込む（外部入力ではない）。
 * 並べ替えと足切りのためだけに使い、返す値は TS 側で同じ重みから計算し直す */
function scoreSql(
  kinds: readonly string[],
  weights: Record<string, number>,
  prefix: "cur_" | "prev_",
): string {
  return kinds.map((k) => `${prefix}${k} * ${weights[k]}`).join(" + ");
}

/** 集計期間の境界 (epoch ms)。今期間 [since, until) / 前期間 [previousSince, since) */
export interface TrendingPeriod {
  since: number;
  until: number;
  previousSince: number;
}

/** SQL から持ち帰った候補（リストに切る前の全件）。
 * overview はここからリストを組み立てる。切り出しているのは、
 * リスト長 (TRENDING_LIST_SIZE) に左右されない検証をテストから書けるようにするため */
export interface TrendingCandidates {
  period: TrendingPeriod;
  users: TrendingUserItem[];
  communities: TrendingCommunityItem[];
}

export const trendingRepo = {
  /** 候補の取得（今期間スコア > 0 のものを期間内スコア降順で TRENDING_CANDIDATE_LIMIT 件）。
   * Workers のサブリクエスト上限を意識して **クエリは2本**（ユーザー・コミュニティ）。
   * 今期間と前期間は WHERE で分けず、CASE で期間フラグを立てて同時に集計する。
   *
   * @param days 集計日数（1以上）。前期間は同じ長さの直前の期間 */
  async candidates(days: number, now: number): Promise<TrendingCandidates> {
    // 期間の境界は **epoch ms のまま**扱う。JST の日境界で切ると今期間だけ
    // 「days ＋ 当日の経過ぶん（最大+1日）」になり、前期間よりつねに長くなる。
    // 比を出す指標でそれをやると倍率が系統的に上振れる（30日指定・深夜で最大+3.3%）。
    // KPI (#258) は日次推移と揃える必要があるので日境界のままでよいが、
    // こちらは長さの対称性を優先する。
    const span = days * 86400000;
    const since = now - span;
    const prevSince = now - 2 * span;

    /** 期間フラグ。1=今期間 [since, now) / 2=前期間 [prevSince, since) / 0=対象外。
     * バインド順: since, now, prevSince, since */
    const period = (col: string) =>
      `CASE WHEN ${col} >= ? AND ${col} < ? THEN 1
            WHEN ${col} >= ? AND ${col} < ? THEN 2 ELSE 0 END`;

    /** UNION ALL の1枝。(key, 期間フラグ, 種別) を1行1件で吐く */
    const branch = (o: {
      key: string;
      at: string;
      kind: string;
      from: string;
      where: string;
      binds?: unknown[];
    }): Branch => ({
      sql: `SELECT ${o.key} AS uid, ${period(o.at)} AS p, '${o.kind}' AS k
              FROM ${o.from} WHERE ${o.where}`,
      binds: [since, now, prevSince, since, ...(o.binds ?? [])],
    });

    /** 前期間の開始で足切りする枝。上限は period() の CASE ＋ `WHERE p > 0` に任せる
     * （下限だけ WHERE に書くのは、UNION ALL する前に行数を落とすため） */
    const sinceBranch = (o: {
      key: string;
      at: string;
      kind: string;
      from: string;
      where: string;
    }): Branch =>
      branch({ ...o, where: `${o.where} AND ${o.at} >= ?`, binds: [prevSince] });

    /** 開催済みイベント条件つきの枝（時刻は ends_at 基準） */
    const heldBranch = (o: {
      key: string;
      kind: string;
      from: string;
      where: string;
      alias?: string;
    }): Branch => {
      const t = o.alias ?? "e";
      return sinceBranch({
        key: o.key,
        at: `${t}.ends_at`,
        kind: o.kind,
        from: o.from,
        where: `${o.where} AND ${HELD(t)}`,
      });
    };

    // ---------- (1) ユーザー ----------
    const userBranches: Branch[] = [
      // 主催: 開催完了した公開イベントのオーナー
      heldBranch({
        key: "e.created_by",
        kind: "hosted",
        from: "event e",
        where: "1 = 1",
      }),
      // スタッフ参加: オーナー以外の確定スタッフ行
      heldBranch({
        key: "m.user_id",
        kind: "staffed",
        from: "event_member m JOIN event e ON e.id = m.event_id",
        where:
          "m.role = 'staff' AND m.status = 'confirmed' AND m.user_id <> e.created_by",
      }),
      // 参加: KPI の JOINED と同じ行の条件。出席チェック実施イベントは出席者のみ
      heldBranch({
        key: "m.user_id",
        kind: "joined",
        from: "event_member m JOIN event e ON e.id = m.event_id",
        where: `m.status = 'confirmed' AND ${JOINED("m")}
                AND (e.attendance_check = 0 OR m.attended = 1)`,
      }),
      // もらったいいね: eventLikesRepo.receivedCountForUser と同じ定義
      sinceBranch({
        key: "l.target_key",
        at: "l.created_at",
        kind: "likeReceived",
        from: `event_like l JOIN event e ON e.id = l.event_id
               JOIN user lu ON lu.id = l.user_id AND lu.deleted_at IS NULL`,
        where: "l.kind IN ('host', 'staff', 'participant') AND e.status = 'published'",
      }),
      // 出会い: 1件の記録は両者にとっての「出会い」なので2行に展開する
      sinceBranch({
        key: "mt.user_low",
        at: "mt.created_at",
        kind: "meet",
        from: "event_meet mt",
        where: "1 = 1",
      }),
      sinceBranch({
        key: "mt.user_high",
        at: "mt.created_at",
        kind: "meet",
        from: "event_meet mt",
        where: "1 = 1",
      }),
      // たまごの投稿
      sinceBranch({
        key: "r.created_by",
        at: "r.created_at",
        kind: "eggPosted",
        from: "event_request r",
        where: "1 = 1",
      }),
      // たまごへの賛同（押した側）
      sinceBranch({
        key: "x.user_id",
        at: "x.created_at",
        kind: "eggReaction",
        from: "event_request_reaction x",
        where: "1 = 1",
      }),
      // フォロワー増加: followsRepo.followerCount と同じく退会申請中のフォロワーは数えない
      sinceBranch({
        key: "f.followee_id",
        at: "f.created_at",
        kind: "followerGained",
        from: `user_follow f
               JOIN user fu ON fu.id = f.follower_id AND fu.deleted_at IS NULL`,
        where: "1 = 1",
      }),
    ];

    const userCur = scoreSql(USER_KINDS, TRENDING_USER_WEIGHTS, "cur_");
    const userRows = await many<AggRow>(
      `WITH acts AS (
         ${unionAll(userBranches.map((b) => b.sql))}
       ),
       agg AS (
         -- p > 0 が集計期間の上限（now 以降 = まだ終わっていない・未来の記録）を切る。
         -- 下限は各枝の WHERE で先に落としてある
         SELECT uid,
         ${sumColumns(USER_KINDS)}
         FROM acts WHERE p > 0 GROUP BY uid
       )
       SELECT a.*, u.username AS handle,
              COALESCE(u.global_name, u.username) AS name,
              u.avatar_url AS avatar_url
         FROM agg a
         JOIN user u ON u.id = a.uid AND u.deleted_at IS NULL
        WHERE (${userCur}) > 0
        -- 同点で順位が入れ替わらないよう uid でタイブレークする
        ORDER BY (${userCur}) DESC, a.uid
        LIMIT ${TRENDING_CANDIDATE_LIMIT}`,
      ...userBranches.flatMap((b) => b.binds),
    );

    // ---------- (2) コミュニティ ----------
    const communityBranches: Branch[] = [
      // 開催完了したイベント数
      heldBranch({
        key: "e.community_id",
        kind: "heldEvent",
        from: "event e",
        where: "e.community_id IS NOT NULL",
      }),
      // 延べ参加者数（KPI の heldParticipants と同じ数え方）
      heldBranch({
        key: "e.community_id",
        kind: "participation",
        from: "event_member m JOIN event e ON e.id = m.event_id",
        where: `e.community_id IS NOT NULL AND m.status = 'confirmed' AND ${JOINED("m")}
                AND (e.attendance_check = 0 OR m.attended = 1)
                AND ${USER_ACTIVE("m.user_id")}`,
      }),
      // 新規メンバー数（退会申請中は数えない。メンバー一覧の表示と揃える）
      sinceBranch({
        key: "cm.community_id",
        at: "cm.created_at",
        kind: "newMember",
        from: "community_member cm",
        where: USER_ACTIVE("cm.user_id"),
      }),
      // もらったいいね: eventLikesRepo.receivedCountForCommunity と同じ定義
      sinceBranch({
        key: "l.target_key",
        at: "l.created_at",
        kind: "likeReceived",
        from: `event_like l JOIN event e ON e.id = l.event_id
               JOIN user lu ON lu.id = l.user_id AND lu.deleted_at IS NULL`,
        where: "l.kind = 'community' AND e.status = 'published'",
      }),
    ];

    const commCur = scoreSql(
      COMMUNITY_KINDS,
      TRENDING_COMMUNITY_WEIGHTS,
      "cur_",
    );
    const communityRows = await many<AggRow>(
      `WITH acts AS (
         ${unionAll(communityBranches.map((b) => b.sql))}
       ),
       agg AS (
         -- p > 0 はユーザー側と同じく集計期間の上限を切る
         SELECT uid,
         ${sumColumns(COMMUNITY_KINDS)}
         FROM acts WHERE p > 0 GROUP BY uid
       )
       SELECT a.*, c.slug AS slug, c.name AS name,
              c.icon_updated_at AS icon_updated_at
         FROM agg a
         JOIN community c ON c.id = a.uid
        WHERE (${commCur}) > 0
        ORDER BY (${commCur}) DESC, a.uid
        LIMIT ${TRENDING_CANDIDATE_LIMIT}`,
      ...communityBranches.flatMap((b) => b.binds),
    );

    return {
      period: { since, until: now, previousSince: prevSince },
      users: userRows.map(toUserItem),
      communities: communityRows.map(toCommunityItem),
    };
  },

  /** 注目（トレンド）(#259 PR1)。候補から2つのリストを組み立てて返す */
  async overview(days: number, now: number): Promise<TrendingPayload> {
    // this ではなく trendingRepo 経由で呼ぶ（分割代入で取り出しても壊れないように）
    const { period, users, communities } = await trendingRepo.candidates(
      days,
      now,
    );
    return {
      days,
      since: period.since,
      until: period.until,
      previousSince: period.previousSince,
      minRisingScore: {
        user: TRENDING_MIN_RISING_SCORE.user,
        community: TRENDING_MIN_RISING_SCORE.community,
      },
      ratioSmoothing: {
        user: TRENDING_RATIO_SMOOTHING.user,
        community: TRENDING_RATIO_SMOOTHING.community,
      },
      minRisingRatio: TRENDING_MIN_RISING_RATIO,
      // 画面の注記が古いバンドルの定数とずれないよう、重みもペイロードに載せる
      weights: {
        user: { ...TRENDING_USER_WEIGHTS },
        community: { ...TRENDING_COMMUNITY_WEIGHTS },
      },
      users: buildTrendingLists(users, {
        minScore: TRENDING_MIN_RISING_SCORE.user,
        smoothing: TRENDING_RATIO_SMOOTHING.user,
      }),
      communities: buildTrendingLists(communities, {
        minScore: TRENDING_MIN_RISING_SCORE.community,
        smoothing: TRENDING_RATIO_SMOOTHING.community,
      }),
    };
  },
};

/** cur_* / prev_* の列から内訳を取り出す */
function pick<K extends string>(
  row: AggRow,
  kinds: readonly K[],
  prefix: "cur_" | "prev_",
): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const k of kinds) out[k] = N(row[`${prefix}${k}`]);
  return out;
}

function toUserItem(row: AggRow): TrendingUserItem {
  const cur = pick<UserKind>(row, USER_KINDS, "cur_");
  const prev = pick<UserKind>(row, USER_KINDS, "prev_");
  const breakdown = {
    hosted: cur.hosted,
    staffed: cur.staffed,
    joined: cur.joined,
    likesReceived: cur.likeReceived,
    meets: cur.meet,
    eggsPosted: cur.eggPosted,
    eggReactions: cur.eggReaction,
    followersGained: cur.followerGained,
  };
  const previousScore = trendingUserScore({
    hosted: prev.hosted,
    staffed: prev.staffed,
    joined: prev.joined,
    likesReceived: prev.likeReceived,
    meets: prev.meet,
    eggsPosted: prev.eggPosted,
    eggReactions: prev.eggReaction,
    followersGained: prev.followerGained,
  });
  return {
    id: String(row.uid),
    handle: String(row.handle ?? ""),
    name: String(row.name ?? ""),
    avatarUrl: (row.avatar_url as string | null) ?? null,
    breakdown,
    score: trendingUserScore(breakdown),
    previousScore,
    // ratio は buildTrendingLists がリストごとに付け直す
    ratio: null,
    isNew: previousScore <= 0,
  };
}

function toCommunityItem(row: AggRow): TrendingCommunityItem {
  const cur = pick<CommunityKind>(row, COMMUNITY_KINDS, "cur_");
  const prev = pick<CommunityKind>(row, COMMUNITY_KINDS, "prev_");
  const breakdown = {
    heldEvents: cur.heldEvent,
    participations: cur.participation,
    newMembers: cur.newMember,
    likesReceived: cur.likeReceived,
  };
  const id = String(row.uid);
  const previousScore = trendingCommunityScore({
    heldEvents: prev.heldEvent,
    participations: prev.participation,
    newMembers: prev.newMember,
    likesReceived: prev.likeReceived,
  });
  return {
    id,
    slug: String(row.slug ?? ""),
    name: String(row.name ?? ""),
    iconUrl: communityImageUrl(
      id,
      "icon",
      (row.icon_updated_at as number | null) ?? null,
    ),
    breakdown,
    score: trendingCommunityScore(breakdown),
    previousScore,
    ratio: null,
    isNew: previousScore <= 0,
  };
}
