/** 運営ダッシュボードのKPI (#257 PR1)。
 * 既存データから算出できる指標のみ。未計測の指標（サイト全体のPV・DAU/MAU・
 * ファネルの到達数・検索需要・メール到達）は PR2 以降で追加する。
 *
 * 「率」は分母が0のとき null を返す（画面は「—」表示）。ゼロ除算しない。 */

import type { KpiPreviousValues } from "./kpiTrend.js";

/** 参加回数の分布の1区間 */
export interface KpiDistributionBucket {
  /** '1回' '2回' '3回' '4〜5回' '6〜10回' '11回以上' */
  label: string;
  /** その区間に該当する人数 */
  users: number;
}

/** ログイン方法（連携プロバイダ）の内訳。期間ではなく現時点のスナップショット */
export interface KpiProviderCount {
  provider: string;
  users: number;
}

/** 日次推移の1日分。活動が無かった日も 0 で埋めて連続した日付で返す
 * （抜けたまま並べると横軸が詰まって、休みの日が無かったように見える） */
export interface KpiDailyPoint {
  /** JST の 'YYYY-MM-DD' */
  day: string;
  /** 新規登録者数（退会申請中を除く） */
  signups: number;
  /** 確定した参加登録数（公開イベントのみ・主催/スタッフの行を除く）。
   * KpiParticipants.registrations は取消も含む全ステータスなので一致しない */
  joins: number;
  /** その日に終了した公開イベント数（KpiNorthStar.heldEvents の日次内訳） */
  heldEvents: number;
  /** その日に終了したイベントの参加者の合計（KpiNorthStar.participations の日次内訳） */
  participations: number;
  /** その日アクセスしたユーザー数 (DAU)。計測開始 (#257) より前の日は null。
   * 0 で返すと「誰も来なかった日」と区別できない */
  dau: number | null;
  /** その日を含む直近30日にアクセスしたユーザー数 (MAU のローリング)。
   * 計測開始より前の日は null。**計測開始から30日間は窓が埋まりきらないため
   * 実態より低く出る**（画面にその旨を出すこと） */
  mau: number | null;
}

/** 北極星指標: 実際に人が集まった参加体験の数 */
export interface KpiNorthStar {
  /** 開催済みイベントで実際に集まった人数の合計。**主催・スタッフを含む**。
   * 出席チェック実施イベントは出席者数（＋主催・スタッフ）、未実施は確定登録者数。
   * イベントページの参加者数 (participantCount) は確定メンバー数なので、
   * 出席チェック実施イベントでは一致しない (#297) */
  participations: number;
  /** participations のうち主催・スタッフ (role='staff') の行を除いたもの。
   * 審査員・観覧者は実際にイベントに来る人なので参加者として数える。
   * 不発イベントのしきい値判定もこちらを使う */
  heldParticipants: number;
  /** 期間内に終了した公開イベント（日程確定済み・開催日設定済み）の数 */
  heldEvents: number;
  /** participations / heldEvents */
  avgParticipantsPerEvent: number | null;
}

/** 参加者ファネル（需要側）。
 * 登録系はすべて role<>'staff' かつ公開イベントの行のみを数える。
 * イベント作成時に作成者の staff 行が作られるため、絞らないとイベントを1件作る
 * たびに参加登録が+1され、キャンセル率・転換率が実態とずれる。
 * 審査員 (judge)・観覧者 (observer) は実際にイベントに来る人なので参加者として数える。
 * ロールは後から変更できるため、参加者を staff に変えると過去の数字も遡って変わる。 */
export interface KpiParticipants {
  /** 期間内に作成された参加登録（取消済みを含む全ステータス） */
  registrations: number;
  /** うち現在も確定状態のもの */
  confirmedRegistrations: number;
  /** イベント詳細の閲覧ユニークビジター（訪問者Cookieの重複排除） */
  uniqueViewers: number;
  /** イベント詳細の総表示回数 (PV) */
  totalViews: number;
  /** registrations / uniqueViewers。分母は期間全体・全イベント横断のユニーク訪問者で、
   * 一覧やお知らせなどイベント詳細を経由しない登録も分子に入るため 100% を超えうる概算 */
  viewToJoinRate: number | null;
  /** 出席率の分母: 期間内に終了した「出席チェック実施」イベントの確定参加者 */
  attendanceExpected: number;
  /** うち出席チェック済み */
  attended: number;
  /** attended / attendanceExpected */
  attendanceRate: number | null;
  /** 1 - attendanceRate（登録したのに来なかった割合） */
  noShowRate: number | null;
  /** 期間内に作成された登録のうち取消されたもの（日程調整中の取消は除く）。
   * 再参加時は行を再利用して canceled_at を戻すため、構造的に過小に出る */
  canceled: number;
  /** canceled / registrations */
  cancelRate: number | null;
  /** うち開始24時間前以降の取消 */
  canceledLate: number;
  /** うち24時間前より前の取消 */
  canceledEarly: number;
  /** canceledLate / canceled */
  lateCancelRate: number | null;
  /** 期間内に開催されたイベントに参加した実人数 */
  uniqueParticipants: number;
  /** うち2回以上参加した人数 */
  repeatParticipants: number;
  /** repeatParticipants / uniqueParticipants */
  repeatRate: number | null;
  /** 参加回数の分布（uniqueParticipants の内訳） */
  countDistribution: KpiDistributionBucket[];
}

/** 主催者ファネル（供給側） */
export interface KpiOrganizers {
  /** 期間内に作成されたイベント（全ステータス） */
  createdEvents: number;
  /** うち下書きのまま */
  draftEvents: number;
  /** うち公開済み */
  publishedEvents: number;
  /** 期間内に作成された公開イベントのうち、いま日程調整中のもの */
  schedulingEvents: number;
  /** 期間内に作成され、日程調整（候補日）を使ったイベント */
  schedulingUsedEvents: number;
  /** うち日程が確定したもの */
  schedulingConfirmedEvents: number;
  /** schedulingConfirmedEvents / schedulingUsedEvents */
  schedulingConfirmRate: number | null;
  /** 期間内に終了した公開イベント（＝開催完了） */
  heldEvents: number;
  /** うち「不発」イベント（主催・スタッフを除いた参加者が3人以下）。
   * 主催・スタッフを含めるとチーム規模でしきい値がぶれ、時系列比較ができない。
   * attendanceUnrecordedEvents は判定できないので含めない */
  dudEvents: number;
  /** heldEvents のうち「出席チェックを有効にしたが出席記録が0件」のイベント。
   * 参加者数が構造的に0になり不発かどうか判定できないため、不発率の分子・分母から外す */
  attendanceUnrecordedEvents: number;
  /** 不発率の分母 = heldEvents - attendanceUnrecordedEvents */
  dudBaseEvents: number;
  /** dudEvents / dudBaseEvents */
  dudRate: number | null;
  /** 期間内にイベントを開催した主催者の実人数（退会申請中を除く） */
  hosts: number;
  /** heldEvents のうち主催者が在籍している（退会申請中でない）ものだけの数。
   * avgEventsPerHost / repeatHostRate の分子はこちらで、hosts と分母が揃う */
  heldEventsWithActiveHost: number;
  /** うち2回以上開催した人数 */
  repeatHosts: number;
  /** repeatHosts / hosts */
  repeatHostRate: number | null;
  /** heldEventsWithActiveHost / hosts */
  avgEventsPerHost: number | null;
}

/** 定着（リテンション）。DAU/MAU・コホート残存は未計測のため PR2 以降 */
export interface KpiRetention {
  /** 期間内の新規登録者数（退会申請中を除く） */
  signups: number;
  /** うち公開イベントに参加者（審査員・観覧者を含む）として登録したことがある人数。
   * 主催時に自動で作られる staff 行は数えない */
  activatedParticipant: number;
  /** うち公開イベントを主催したことがある人数 */
  activatedHost: number;
  /** activatedParticipant / signups */
  activationParticipantRate: number | null;
  /** activatedHost / signups */
  activationHostRate: number | null;
  /** 現在の在籍ユーザー数（期間によらない） */
  activeUsers: number;
  /** 新規登録・参加登録の日次推移（日付昇順） */
  daily: KpiDailyPoint[];
}

/** 健全性・運営負荷 */
export interface KpiHealth {
  /** 期間内の退会申請数（監査ログ account_delete_requested） */
  deleteRequested: number;
  /** 期間内の完全削除数（account_delete_completed ＋ 旧 account_delete） */
  deleteCompleted: number;
  /** 期間内の猶予期間中の復帰数（account_restore） */
  restored: number;
  /** 現在の退会申請中ユーザー数（猶予期間中。期間によらない） */
  pendingDeletion: number;
  /** ログイン方法の内訳（在籍ユーザーの現在の連携。期間によらない） */
  providers: KpiProviderCount[];
  /** 機能利用率の分母: 期間内に作成された公開イベント */
  featureEvents: number;
  /** チャットが実際に使われたイベント（チャンネル作成済み） */
  chatUsedEvents: number;
  chatUsedRate: number | null;
  /** 事前/事後アンケートの設問があるイベント */
  surveyUsedEvents: number;
  surveyUsedRate: number | null;
  /** 出席チェック（チェックイン）を有効にしたイベント */
  checkinUsedEvents: number;
  checkinUsedRate: number | null;
}

/** マッチング（会場・たまご） */
export interface KpiMatching {
  /** 期間内の会場オファー数 */
  venueOffers: number;
  venueOffersAccepted: number;
  venueOffersDeclined: number;
  venueOffersPending: number;
  /** venueOffersAccepted / venueOffers */
  venueOfferAcceptRate: number | null;
  /** 期間内に作成された「会場募集中」イベント */
  venueWantedEvents: number;
  /** うち会場が決まった（承諾済みオファーがある）もの */
  venueWantedFilled: number;
  /** venueWantedFilled / venueWantedEvents */
  venueWantedFillRate: number | null;
  /** 期間内に投稿されたたまご（イベントリクエスト）。
   * 公開たまご一覧の表示と揃えるため、投稿者・賛同者の退会申請中は除いていない */
  eggs: number;
  /** そのたまごへの「参加したい」賛同数 */
  eggAttendReactions: number;
  /** そのたまごへの「開催してもいい」賛同数 */
  eggHostReactions: number;
  /** うちイベント化されたたまごの数 */
  eggsConverted: number;
  /** eggsConverted / eggs */
  eggConversionRate: number | null;
  /** (eggAttendReactions + eggHostReactions) / eggs */
  avgReactionsPerEgg: number | null;
}

/** GET /api/admin/kpi のレスポンス */
export interface KpiPayload {
  /** 集計期間（日数）。null は全期間 */
  days: number | null;
  /** 集計開始日（JST 'YYYY-MM-DD'）。全期間は '0000' */
  sinceDay: string;
  /** 前の同じ長さの期間 [previousSinceDay, sinceDay) の値 (#266)。
   * 全期間（days=null）は比べる過去が無いので null。
   *
   * 今期間は [sinceDay, 今日] で当日ぶんが途中まで、前期間はちょうど days 日ぶん
   * なので、今期間がわずかに長い（増加が少しだけ大きめに出る）。日次推移と
   * 期間の切り方を揃えるためこの非対称は許容している。 */
  previous: KpiPreviousValues | null;
  /** 前期間の開始日（JST 'YYYY-MM-DD'）。全期間は null */
  previousSinceDay: string | null;
  /** DAU/MAU の計測を開始した日（user_active_day の最初の日。#257）。
   * まだ1件も無いときは null。**この日から30日間の MAU は窓が埋まりきらない** */
  activeMeasuredFrom: string | null;
  northStar: KpiNorthStar;
  participants: KpiParticipants;
  organizers: KpiOrganizers;
  retention: KpiRetention;
  health: KpiHealth;
  matching: KpiMatching;
}
