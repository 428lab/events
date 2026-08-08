import { z } from "zod";
import { EVENT_ROLES } from "./constants.js";
import { gamificationSchema } from "./gamification.js";

/** 名札の一括印刷 (#304)。
 *
 * 主催者が当日の名札をまとめて刷るための一覧。中身はプロフィールカード
 * （#178）と同じなので、カード描画に必要な項目だけを参加確定メンバー分
 * まとめて返す。公開プロフィール API を人数分呼ぶと100人規模で破綻するため、
 * カードに出る値だけに絞った軽量ペイロードにしてある。 */

/** カードに刷る所属コミュニティ（参加イベント数の多い順・上位のみ） */
export const nameCardCommunitySchema = z.object({
  id: z.string(),
  name: z.string(),
  iconUrl: z.string().nullable(),
});
export type NameCardCommunity = z.infer<typeof nameCardCommunitySchema>;

/** カードに刷る参加実績。公開プロフィールの participation のうちカードが使う分だけ */
export const nameCardParticipationSchema = z.object({
  /** 出席した過去イベント数 */
  attended: z.number(),
  /** 無断欠席数（参加率の分母に使う） */
  noShow: z.number(),
  /** 主催した終了済みイベント数 */
  hosted: z.number(),
  /** 登壇した終了済みイベント数 */
  spoken: z.number(),
});
export type NameCardParticipation = z.infer<typeof nameCardParticipationSchema>;

/** 名札1枚分（＝参加確定メンバー1人分） */
export const eventNameCardSchema = z.object({
  /** カードのNO.欄と選択状態のキー */
  id: z.string(),
  /** イベント内の役割（一覧で「誰を外すか」を選ぶときの手がかり） */
  role: z.enum(EVENT_ROLES),
  /** プロフィールURLに使うハンドル（QRの飛び先） */
  handle: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  /** 登録日（カードの ISSUED 欄） */
  createdAt: z.number(),
  participation: nameCardParticipationSchema,
  gamification: gamificationSchema,
  communities: z.array(nameCardCommunitySchema),
});
export type EventNameCard = z.infer<typeof eventNameCardSchema>;

export const eventNameCardsPayloadSchema = z.object({
  cards: z.array(eventNameCardSchema),
});
export type EventNameCardsPayload = z.infer<typeof eventNameCardsPayloadSchema>;

/** 名刺サイズ（mm）。市販の名刺用紙・名札ケースに合わせた 91×55 */
export const NAME_CARD_W_MM = 91;
export const NAME_CARD_H_MM = 55;
/** A4（mm） */
export const SHEET_W_MM = 210;
export const SHEET_H_MM = 297;
/** A4に10面（2列×5行）。等間隔に敷き詰めると左右14mm・上下11mmの余白になる */
export const SHEET_COLS = 2;
export const SHEET_ROWS = 5;
export const CARDS_PER_SHEET = SHEET_COLS * SHEET_ROWS;
export const SHEET_MARGIN_X_MM = (SHEET_W_MM - SHEET_COLS * NAME_CARD_W_MM) / 2;
export const SHEET_MARGIN_Y_MM = (SHEET_H_MM - SHEET_ROWS * NAME_CARD_H_MM) / 2;
