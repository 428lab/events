/** コミュニティ別KPI (#262)。全体KPI (#257) のコミュニティ版 ＋ コミュニティ固有の4指標。
 *
 * 数え方は全体KPI (kpi.ts) と完全に揃える。参加としてカウントするのは
 * 「運営スタッフ (role='staff') 以外の event_member 行」で、審査員・観覧者は含む。
 * イベント作成時に作成者の staff 行が自動で作られるため、staff を除かないと
 * イベントを1件作るたびに参加が +1 されてしまう。
 *
 * 「率」は分母が0のとき null（画面は「—」）。さらにコミュニティKPIの画面に出る率は
 * すべて、母数が COMMUNITY_KPI_MIN_SAMPLE 未満のときも null にする（3人中1人で33%の
 * ように極端に振れて誤読されるため）。件数と平均はゲートを掛けずそのまま出す。
 * 「率だけ隠す」という画面の注記と実装を一致させるため、率を1つでも素通しにしない。 */

import type { KpiNorthStar, KpiParticipants } from "./kpi.js";
import type { KpiPreviousValues } from "./kpiTrend.js";

/** コミュニティの日次推移1日分。活動が無かった日も 0 で埋めて連続で返す。
 * DAU/MAU はコミュニティ単位では計測していない（user_active_day はサービス全体） */
export interface CommunityKpiDailyPoint {
  /** JST の 'YYYY-MM-DD' */
  day: string;
  /** その日に終了したこのコミュニティの公開イベント数 */
  heldEvents: number;
  /** その日に終了したイベントの参加者の合計 */
  participations: number;
}

/** 率を表示する最小母数。これ未満は率を出さず「母数が少ないため非表示」。
 * 母数は指標によって「人数」だったり「イベント件数」だったりする（不発率・主催シェアは件数）。
 * 単位が違っても同じ定数を使うのは、どちらも1つ増減しただけで率が大きく動くため。
 * 参加者の重複度では「重なっている人数」がこれ未満の行そのものを出さない（個人の特定を防ぐ）。 */
export const COMMUNITY_KPI_MIN_SAMPLE = 5;

/** 主催者（供給側）のコミュニティ版。バス係数（コア主催者への依存度）を含む */
export interface CommunityKpiOrganizers {
  /** 期間内に終了したこのコミュニティの公開イベント（日程確定済み・開催日設定済み） */
  heldEvents: number;
  /** うち「不発」（主催・スタッフを除いた参加者が3人以下）。全体KPIと同じしきい値 */
  dudEvents: number;
  /** 出席チェックを有効にしたのに記録が0件のイベント（不発か判定できない） */
  attendanceUnrecordedEvents: number;
  /** 不発率の分母 = heldEvents - attendanceUnrecordedEvents */
  dudBaseEvents: number;
  /** dudEvents / dudBaseEvents。判定できた開催数が少ないときは null
   * （1件開催して1件が3人以下なら100%になり、立ち上げ期ほど誤読しやすい） */
  dudRate: number | null;
  /** 期間内にこのコミュニティのイベントを開催した実人数（退会申請中を除く） */
  hosts: number;
  /** heldEvents のうち主催者が在籍しているものの数（hosts と分母が揃う） */
  heldEventsWithActiveHost: number;
  /** うち2回以上開催した人数 */
  repeatHosts: number;
  /** repeatHosts / hosts。開催した人数が少ないときは null */
  repeatHostRate: number | null;
  /** heldEventsWithActiveHost / hosts */
  avgEventsPerHost: number | null;
  /** いちばん多く開催した1人の開催数 */
  topHostEvents: number;
  /** topHostEvents / heldEventsWithActiveHost。開催数が少ないときは null。
   * ここだけ COMMUNITY_KPI_MIN_SAMPLE を「人数」ではなく「イベント件数」に掛けている
   * （分母がイベント件数のため。不発率も同じ） */
  topHostShare: number | null;
}

/** 新規流入 vs 常連。「初参加」は期間開始日より前に終了したこのコミュニティの
 * 公開イベントに確定参加した記録が無い人 */
export interface CommunityKpiNewcomers {
  /** 期間内に開催されたこのコミュニティのイベントに参加した実人数 */
  participants: number;
  /** うちこのコミュニティのイベントに初参加だった人数。
   * 全期間（days=null）では「期間より前」が存在しないため全員がここに入る */
  newcomers: number;
  /** 以前にも参加していた人数。全期間では必ず 0 */
  regulars: number;
  /** newcomers / participants。母数が少ないときは null。
   * 全期間では必ず 100% になるトートロジーなので null（画面も新規流入の数字を出さない） */
  newcomerRate: number | null;
}

/** 休眠会員率。分母は community_member（フォロー登録した人）の在籍者 */
export interface CommunityKpiDormant {
  /** community_member に登録がある在籍ユーザー数 */
  members: number;
  /** うち期間内に開催されたこのコミュニティのイベントに参加した人数 */
  activeMembers: number;
  /** members - activeMembers */
  dormantMembers: number;
  /** dormantMembers / members。母数が少ないときは null */
  dormantRate: number | null;
}

/** 参加者の重複度の1件（他のコミュニティ1つ分） */
export interface CommunityKpiOverlapItem {
  communityId: string;
  slug: string;
  name: string;
  /** 期間内の参加者のうち、そのコミュニティの公開イベントにも確定参加している人数 */
  users: number;
  /** users / 期間内の参加者数。母数が少ないときは null */
  rate: number | null;
}

/** GET /api/communities/:id/kpi のレスポンス */
export interface CommunityKpiPayload {
  /** 集計期間（日数）。null は全期間 */
  days: number | null;
  /** 集計開始日（JST 'YYYY-MM-DD'）。全期間は '0000' */
  sinceDay: string;
  /** 前の同じ長さの期間 [previousSinceDay, sinceDay) の値 (#266)。全期間は null。
   * 率は今期間と同じ母数ゲート（COMMUNITY_KPI_MIN_SAMPLE）を通しているので、
   * 前期間の母数が少なければ null になり、増減も出ない */
  previous: KpiPreviousValues | null;
  /** 前期間の開始日（JST 'YYYY-MM-DD'）。全期間は null */
  previousSinceDay: string | null;
  /** 開催と参加の日次推移（日付昇順） */
  daily: CommunityKpiDailyPoint[];
  community: { id: string; slug: string; name: string };
  /** 率を出すのに必要な最小母数（COMMUNITY_KPI_MIN_SAMPLE） */
  minSample: number;
  northStar: KpiNorthStar;
  participants: KpiParticipants;
  organizers: CommunityKpiOrganizers;
  newcomers: CommunityKpiNewcomers;
  dormant: CommunityKpiDormant;
  /** 参加者が重なっている他コミュニティ（多い順・最大5件）。
   * コミュニティは公開範囲の設定を持たず、一覧・メンバー一覧とも誰でも見られる
   * 公開情報なので、そのまま名前を出してよい。ただし重なっている人数が
   * COMMUNITY_KPI_MIN_SAMPLE 未満の行は、メンバー一覧との突き合わせで個人が
   * 特定できてしまうため返さない */
  overlap: CommunityKpiOverlapItem[];
}
