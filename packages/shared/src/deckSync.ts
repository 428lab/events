import { z } from "zod";
import { deckElementSchema, deckPosSchema } from "./decks.js";
import type { Deck } from "./decks.js";
import type { EventSignalSource } from "./eventSignal.js";

/** タブどうしが差分を送り合う Nostr のエフェメラルイベントの kind（docs/team-deck-live-sync.md §6.2）。
 * サーバーの合図（20078）とは別 */
export const DECK_SYNC_KIND = 21078;

/** 編集用の `GET /api/decks/:id` が、チームのスライドの**いまのメンバー**にだけ返す同期の設定
 * （§4.1）。機能オフ・サービス鍵なし・チームのスライドでないときは `null`。
 * 公開の閲覧・運営の一覧には載せない */
export interface DeckSyncConfig {
  kind: typeof DECK_SYNC_KIND;
  relays: string[];
  /** 不透明な hex。世代ごとに変わる（§4.3）。絞り込みの目印で、権限ではない */
  topic: string;
  /** 今の世代の鍵。`secret` は 32 バイト乱数の hex（NIP-44 v2 の conversation key） */
  key: { version: number; secret: string };
  /** 差分に載せる「誰が」（表示用。権限には使わない §8） */
  me: { userId: string; name: string };
  /** 世代の切り替えを知らせる `deck-sync` の合図（§4.4）。サービス鍵が無ければ null */
  signal: EventSignalSource | null;
}

/** 編集用の `GET /api/decks/:id` の応答。チームのスライドのいまのメンバーには `sync` が付く */
export type DeckForEdit = Deck & { sync?: DeckSyncConfig | null };

/**
 * チームのスライドの同時編集で、タブどうしが送り合う差分（op）の形
 * （docs/team-deck-live-sync.md §5.3・§8）。当て方は apps/web/src/lib/deckSync.ts。
 *
 * ここにあるのは **形の検証だけ**。手元の状態を見ないので、届いた順に関係なく同じ判定になる
 * （状態で判断すると収束が壊れる）。数の上限（ページ 300・要素 200）は届いた op では見ない。
 */

/** ハイブリッド論理時計。比べる順は (t, c, clientId) */
export const deckHlcSchema = z.object({
  t: z.number().int().min(0),
  c: z.number().int().min(0).max(1_000_000_000),
  clientId: z.string().min(1).max(32),
}).strict();
export type DeckHlc = z.infer<typeof deckHlcSchema>;

const idSchema = z.string().min(1).max(64);
const backgroundSchema = z.string().max(50);
const shape = deckElementSchema.shape;

/** 要素の欄の書き換え。id と種類は変えられない。`null` は「その欄を外す」（グループを外す等） */
export const deckElementFieldsSchema = z.object({
  x: shape.x.optional(),
  y: shape.y.optional(),
  w: shape.w.optional(),
  h: shape.h.optional(),
  rotation: z.number().optional(),
  groupId: shape.groupId.unwrap().nullable().optional(),
  text: shape.text.unwrap().nullable().optional(),
  fontSize: shape.fontSize.unwrap().nullable().optional(),
  fontFamily: shape.fontFamily.unwrap().nullable().optional(),
  color: shape.color.unwrap().nullable().optional(),
  bold: shape.bold.unwrap().nullable().optional(),
  italic: shape.italic.unwrap().nullable().optional(),
  align: shape.align.unwrap().nullable().optional(),
  src: shape.src.unwrap().nullable().optional(),
  pos: deckPosSchema.optional(),
}).strict();
export type DeckElementFields = z.infer<typeof deckElementFieldsSchema>;

/** 外せる欄（`null` を受ける欄）。`el.add` で持っていなければ「外れている」 */
export const DECK_CLEARABLE_FIELDS = [
  "groupId", "text", "fontSize", "fontFamily", "color", "bold", "italic", "align", "src",
] as const;
/** 要素の欄すべて（id と type を除く）。印はこの単位で持つ */
export const DECK_ELEMENT_FIELDS = ["x", "y", "w", "h", "rotation", "pos", ...DECK_CLEARABLE_FIELDS] as const;
export type DeckElementField = (typeof DECK_ELEMENT_FIELDS)[number];

/** 送り合う要素は、並びの位置キーを必ず持つ */
const syncedElementSchema = deckElementSchema.extend({ id: idSchema, pos: deckPosSchema }).strict();

export const deckOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("slide.add"), hlc: deckHlcSchema, slideId: idSchema, pos: deckPosSchema, background: backgroundSchema }).strict(),
  z.object({ op: z.literal("slide.remove"), hlc: deckHlcSchema, slideId: idSchema }).strict(),
  z.object({ op: z.literal("slide.set"), hlc: deckHlcSchema, slideId: idSchema, fields: z.object({ background: backgroundSchema.optional(), pos: deckPosSchema.optional() }).strict() }).strict(),
  z.object({ op: z.literal("el.add"), hlc: deckHlcSchema, slideId: idSchema, element: syncedElementSchema }).strict(),
  z.object({ op: z.literal("el.remove"), hlc: deckHlcSchema, slideId: idSchema, elementId: idSchema }).strict(),
  z.object({ op: z.literal("el.set"), hlc: deckHlcSchema, slideId: idSchema, elementId: idSchema, fields: deckElementFieldsSchema }).strict(),
  z.object({ op: z.literal("title.set"), hlc: deckHlcSchema, title: z.string().trim().max(120) }).strict(),
]);
export type DeckOp = z.infer<typeof deckOpSchema>;
