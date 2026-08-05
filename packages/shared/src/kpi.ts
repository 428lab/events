/** 運営ダッシュボードのKPI (#257 PR1)。
 * 既存データから算出できる指標のみ。未計測の指標（サイト全体のPV・DAU/MAU・
 * ファネルの到達数・検索需要・メール到達）は PR2 以降で追加する。
 *
 * 「率」は分母が0のとき null を返す（画面は「—」表示）。ゼロ除算しない。 */

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

/** 日次推移の1日分 */
export interface KpiDailyPoint {
  /** JST の 'YYYY-MM-DD' */
  day: string;
  /** 新規登録者数（退会申請中を除く） */
  signups: number;
  /** 確定した参加登録数（participant のみ・公開イベントのみ） */
  joins: number;
}

/** 北極星指標: 実際に人が集まった参加体験の数 */
export interface KpiNorthStar {
  /** 開催済みイベントの確定参加者数の合計。イベントページの参加者数
   * (participantCount) と同じ定義で、**主催・スタッフを含む**。
   * 出席チェック実施イベントは出席者数（＋主催・スタッフ）、未実施は確定登録者数 */
  participations: number;
  /** participations のうち participant の行だけを数えたもの（主催・スタッフを除く）。
   * 不発イベントのしきい値判定もこちらを使う */
  heldParticipants: number;
  /** 期間内に終了した公開イベント（日程確定済み・開催日設定済み）の数 */
  heldEvents: number;
  /** participations / heldEvents */
  avgParticipantsPerEvent: number | null;
}

/** 参加者ファネル（需要側）。
 * 登録系はすべて role='participant' かつ公開イベントの行のみを数える。
 * イベント作成時に作成者の staff 行が作られるため、絞らないとイベントを1件作る
 * たびに参加登録が+1され、キャンセル率・転換率が実態とずれる。 */
export interface KpiParticipants {
  /** 期間内に作成された参加登録（取消済みを含む全ステータス） */
  registrations: number;
  /** うち現在も確定状態のもの */
  confirmedRegistrations: number;
  /** イベント詳細の閲覧ユニークビジター（訪問者Cookieの重複排除） */
  uniqueViewers: number;
  /** イベント詳細の総表示回数 (PV) */
  totalViews: number;
  /** registrations / uniqueViewers。閲覧UUは全イベント横断の概算 */
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
   * 主催・スタッフを含めるとチーム規模でしきい値がぶれ、時系列比較ができない */
  dudEvents: number;
  /** dudEvents / heldEvents */
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
  /** うち公開イベントに参加者として登録したことがある人数。
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
  /** 期間内に投稿されたたまご（イベントリクエスト） */
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
  northStar: KpiNorthStar;
  participants: KpiParticipants;
  organizers: KpiOrganizers;
  retention: KpiRetention;
  health: KpiHealth;
  matching: KpiMatching;
}
