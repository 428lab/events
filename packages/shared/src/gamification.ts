import { z } from "zod";

/** ゲーミフィケーション (#14)。
 * XP・レベル・バッジはすべて既存データからの導出値（専用テーブルなし・遡及適用）。
 * インフレ防止のため「有効イベント」だけを対象に数える:
 *   公開済み(status='published') かつ 終了済み(ends_at>0 かつ ends_at<now)
 *   かつ 確定メンバー(status='confirmed')が4人以上。 */

/** XPの重み（運営側の貢献を厚めに評価する） */
export const XP_WEIGHTS = {
  /** 主催（有効イベントのオーナー） */
  hosted: 100,
  /** スタッフ（オーナー以外の確定スタッフ） */
  staffed: 50,
  /** 登壇（タイムテーブル担当にリンク。同一イベント複数コマは1） */
  spoken: 40,
  /** 参加（確定参加者で出席扱いのもの） */
  attended: 10,
  /** 被いいね（host/staff/participant 対象で自分がもらった数） */
  likeReceived: 5,
  /** 出会った（イベント会場でのQR読み合い。1イベント10件まで） (#189) */
  meet: 5,
} as const;


/** 有効イベント基準で数えたユーザーごとの実績（XP・バッジ算出の入力） */
export interface GamificationStats {
  /** 主催した有効イベント数 */
  hosted: number;
  /** スタッフとして参加した有効イベント数（主催分は含まない） */
  staffed: number;
  /** 登壇した有効イベント数 */
  spoken: number;
  /** 出席した有効イベント数（参加者ロールのみ） */
  attendedQualifying: number;
  /** 有効イベントでもらったいいね数 */
  likesReceivedQualifying: number;
  /** 有効イベントでの「出会った」数（イベントごとに上限適用済み） (#189) */
  meets: number;
}

/** 実績からXP合計を計算する */
export function xpFromStats(stats: GamificationStats): number {
  return (
    stats.hosted * XP_WEIGHTS.hosted +
    stats.staffed * XP_WEIGHTS.staffed +
    stats.spoken * XP_WEIGHTS.spoken +
    stats.attendedQualifying * XP_WEIGHTS.attended +
    stats.likesReceivedQualifying * XP_WEIGHTS.likeReceived +
    stats.meets * XP_WEIGHTS.meet
  );
}

/** レベル n に到達するのに必要な累計XP。
 * Lv1=0, Lv2=100, Lv3=300, Lv4=600, Lv5=1000, Lv10=4500 … と二次関数的に増える */
export function xpForLevel(n: number): number {
  return 50 * n * (n - 1);
}

/** レベル計算の結果（進捗バー表示に必要な値一式） */
export interface LevelInfo {
  /** 現在のレベル（1始まり） */
  level: number;
  /** 現在の累計XP */
  currentXp: number;
  /** 現在のレベルに到達した時点の累計XP */
  currentLevelXp: number;
  /** 次のレベルに必要な累計XP */
  nextLevelXp: number;
}

/** 累計XPからレベルと進捗を求める（上限なし） */
export function levelFromXp(xp: number): LevelInfo {
  const safe = Math.max(0, Math.floor(xp));
  // 50n(n-1) <= xp を満たす最大の n を閉形式で求め、浮動小数の誤差を補正
  let level = Math.max(1, Math.floor((1 + Math.sqrt(1 + safe / 12.5)) / 2));
  while (xpForLevel(level + 1) <= safe) level++;
  while (level > 1 && xpForLevel(level) > safe) level--;
  return {
    level,
    currentXp: safe,
    currentLevelXp: xpForLevel(level),
    nextLevelXp: xpForLevel(level + 1),
  };
}

/** バッジの見た目カテゴリ（Web側で単色アイコンにマップする） */
export type BadgeIcon = "host" | "staff" | "speak" | "attend" | "liked" | "meet";

/** バッジ定義。earned は実績カウントに対する純粋関数（遡及的に判定できる） */
export interface BadgeDef {
  key: string;
  name: string;
  /** ライセンスカード等で使う英語表示名（すべて大文字・絵文字なし） (#178) */
  nameEn: string;
  description: string;
  /** アイコン種別（Web側でアイコンコンポーネントに解決） */
  icon: BadgeIcon;
  /** 段階（1=入門, 2=常連, 3=鉄人）。表示の濃淡に使う */
  tier: 1 | 2 | 3;
  earned: (stats: GamificationStats) => boolean;
}

/** 全バッジ定義。しきい値はすべて有効イベント基準の実績カウント */
export const BADGE_DEFS: readonly BadgeDef[] = [
  {
    key: "first-host",
    name: "初主催",
    nameEn: "FIRST HOST",
    description: "イベントを1回主催した",
    icon: "host",
    tier: 1,
    earned: (s) => s.hosted >= 1,
  },
  {
    key: "host-5",
    name: "主催の常連",
    nameEn: "SEASONED HOST",
    description: "イベントを5回主催した",
    icon: "host",
    tier: 2,
    earned: (s) => s.hosted >= 5,
  },
  {
    key: "host-20",
    name: "主催の鉄人",
    nameEn: "IRON HOST",
    description: "イベントを20回主催した",
    icon: "host",
    tier: 3,
    earned: (s) => s.hosted >= 20,
  },
  {
    key: "first-staff",
    name: "スタッフデビュー",
    nameEn: "STAFF DEBUT",
    description: "スタッフとしてイベントを1回支えた",
    icon: "staff",
    tier: 1,
    earned: (s) => s.staffed >= 1,
  },
  {
    key: "staff-10",
    name: "縁の下の力持ち",
    nameEn: "BACKBONE STAFF",
    description: "スタッフとしてイベントを10回支えた",
    icon: "staff",
    tier: 2,
    earned: (s) => s.staffed >= 10,
  },
  {
    key: "first-speak",
    name: "初登壇",
    nameEn: "FIRST TALK",
    description: "イベントで1回登壇した",
    icon: "speak",
    tier: 1,
    earned: (s) => s.spoken >= 1,
  },
  {
    key: "speak-5",
    name: "登壇の常連",
    nameEn: "SEASONED SPEAKER",
    description: "イベントで5回登壇した",
    icon: "speak",
    tier: 2,
    earned: (s) => s.spoken >= 5,
  },
  {
    key: "speak-20",
    name: "登壇の鉄人",
    nameEn: "IRON SPEAKER",
    description: "イベントで20回登壇した",
    icon: "speak",
    tier: 3,
    earned: (s) => s.spoken >= 20,
  },
  {
    key: "attend-10",
    name: "常連参加者",
    nameEn: "REGULAR",
    description: "イベントに10回参加した",
    icon: "attend",
    tier: 2,
    earned: (s) => s.attendedQualifying >= 10,
  },
  {
    key: "attend-50",
    name: "イベントの主",
    nameEn: "EVENT VETERAN",
    description: "イベントに50回参加した",
    icon: "attend",
    tier: 3,
    earned: (s) => s.attendedQualifying >= 50,
  },
  {
    key: "liked-10",
    name: "人気者",
    nameEn: "CROWD FAVORITE",
    description: "いいねを10回もらった",
    icon: "liked",
    tier: 2,
    earned: (s) => s.likesReceivedQualifying >= 10,
  },
  {
    key: "liked-50",
    name: "みんなの推し",
    nameEn: "BELOVED",
    description: "いいねを50回もらった",
    icon: "liked",
    tier: 3,
    earned: (s) => s.likesReceivedQualifying >= 50,
  },
  {
    key: "first-meet",
    name: "初めまして",
    nameEn: "FIRST CONTACT",
    description: "イベント会場で出会いを1回記録した",
    icon: "meet",
    tier: 1,
    earned: (s) => s.meets >= 1,
  },
  {
    key: "meet-30",
    name: "縁結び",
    nameEn: "SUPER CONNECTOR",
    description: "イベント会場で出会いを30回記録した",
    icon: "meet",
    tier: 3,
    earned: (s) => s.meets >= 30,
  },
] as const;

/** 獲得済みバッジ（APIレスポンス用） */
export const earnedBadgeSchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  /** アイコン種別（host/staff/speak/attend/liked/meet） */
  icon: z.enum(["host", "staff", "speak", "attend", "liked", "meet"]),
  /** 段階（1=入門, 2=常連, 3=鉄人） */
  tier: z.number(),
});
export type EarnedBadge = z.infer<typeof earnedBadgeSchema>;

/** 公開プロフィールのゲーミフィケーション情報 (#14) */
export const gamificationSchema = z.object({
  /** 累計XP */
  xp: z.number(),
  /** 現在のレベル（1始まり） */
  level: z.number(),
  /** 現在のレベルに到達した時点の累計XP（進捗バー用） */
  currentLevelXp: z.number(),
  /** 次のレベルに必要な累計XP（進捗バー用） */
  nextLevelXp: z.number(),
  /** 獲得済みバッジのみ */
  badges: z.array(earnedBadgeSchema),
});
export type Gamification = z.infer<typeof gamificationSchema>;

/** 実績カウントからAPIレスポンス用のゲーミフィケーション情報を組み立てる */
export function gamificationFromStats(stats: GamificationStats): Gamification {
  const xp = xpFromStats(stats);
  const lv = levelFromXp(xp);
  return {
    xp,
    level: lv.level,
    currentLevelXp: lv.currentLevelXp,
    nextLevelXp: lv.nextLevelXp,
    badges: BADGE_DEFS.filter((b) => b.earned(stats)).map(
      ({ key, name, description, icon, tier }) => ({
        key,
        name,
        description,
        icon,
        tier,
      }),
    ),
  };
}
