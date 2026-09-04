import { getBucket } from "../runtime.js";
import { eventPhotosRepo } from "../db/repositories/eventPhotos.js";
import { eventMeetPrizesRepo } from "../db/repositories/eventMeetPrizes.js";

/**
 * D1 の行と R2 の実体の後始末を1本の契約にまとめる (#424)。
 *
 * ■ 契約（削除する経路はすべてこの順で書く）
 *   1. **D1 からキーを集める**（行が消えた後はキーを辿れない＝孤児になる）
 *   2. D1 の行を消す
 *   3. R2 の実体を `deleteObjects` でベストエフォートに消す
 *
 * ■ なぜこの失敗方向か
 * どちらを先にしても失敗はしうるので、「どちらに壊れるか」を選ぶ話になる。
 *   - R2 が先に成功して D1 が失敗 → **参照はあるのに実体が無い**。
 *     一覧に出るのに開けない写真が残り、モデレーションの証跡 (#278) も
 *     消えている。行から辿って復元する方法が無い＝回復不能。
 *   - D1 が先に成功して R2 が失敗 → **実体だけが残る（孤児）**。
 *     誰からも参照されないので配信はされず、prefix を舐める掃除で後から拾える。
 * 回復可能な方（孤児）に倒す。`purgeDeleted.ts` が退会 (#244) で既に採っている
 * 順序で、イベント削除・単体削除もこれに揃えた。
 *
 * ■ なぜ deferBackground に逃がさないか
 * 収集は D1 削除より前でなければならない＝どのみちインラインになる。残る R2 側は
 * まとめて1回の multi-delete（R2 は1回 1000 キー、イベント写真は
 * EVENT_PHOTO_LIMIT=50 本＝最大 100 キー＋景品＋表紙1枚）なので、
 * サブリクエスト予算 50 に対して余裕がある。インラインなら失敗が
 * テストとレスポンスから見える。
 */

/** R2 のキー。**イベントが持つ prefix はこの4つだけ**（bgm / deck-images /
 * live-set-images / avatars / profile-cards / venue-* はユーザーか会場の持ち物）。
 * 組み立てをここに集約しているので、掃除する側が形を書き写さずに済む */
export const eventImageR2Key = (eventId: string) => `event-images/${eventId}`;
export const photoR2Key = (eventId: string, photoId: string) =>
  `event-photos/${eventId}/${photoId}`;
export const videoR2Key = (eventId: string, videoId: string) =>
  `event-videos/${eventId}/${videoId}`;
/** ポスター（サムネイル画像）は本体の兄弟キーに置く (#408) */
export const videoPosterR2Key = (eventId: string, videoId: string) =>
  `${videoR2Key(eventId, videoId)}-poster`;

/** 1件の投稿が持つ R2 オブジェクトのキー。動画 (#408) は本体＋ポスターの2つ。
 * ポスターなしで投稿された動画でも存在しないキーの削除は無害なので分岐しない
 * （分岐を増やすと「ポスターだけ残る」取りこぼしが生まれる）。
 * **写真・動画のキーを組み立てる経路は必ずここを通すこと** */
export function photoObjectKeys(p: {
  eventId: string;
  id: string;
  kind: "photo" | "video";
}): string[] {
  return p.kind === "video"
    ? [videoR2Key(p.eventId, p.id), videoPosterR2Key(p.eventId, p.id)]
    : [photoR2Key(p.eventId, p.id)];
}

/** イベントが持つ R2 オブジェクトのキーを D1 から列挙する (#424)。
 * **event 行を消す前に呼ぶこと**（子テーブルは FK CASCADE で一緒に消えるため、
 * 後から呼んでもキーは1つも返らない）。
 *
 * 列挙元を `bucket.list` ではなく D1 にしているのは、何がこのイベントの持ち物かを
 * 知っているのは D1 だから。景品画像 (#434) のキーは乱数を含み D1 にしか無い。
 * 既にある孤児（この修正より前に消したイベントの残骸）はここでは拾わない
 * ＝ prefix を舐める掃除は別件。
 *
 * 表紙画像は行の有無を見ずに積む。存在しないキーの削除は無害で、
 * `event_image` を引く1サブリクエストを節約できる（退会時の `avatarKey` と同じ手） */
export async function collectEventObjects(eventId: string): Promise<string[]> {
  const keys = [eventImageR2Key(eventId)];
  for (const p of await eventPhotosRepo.listIdsByEvent(eventId)) {
    keys.push(...photoObjectKeys(p));
  }
  keys.push(...(await eventMeetPrizesRepo.listImageKeysByEvent(eventId)));
  return keys;
}

/** R2 の削除（ベストエフォート）。失敗しても throw しない＝呼び出し側の
 * 削除そのものは成立させる。残骸はログの label で追える。
 * 空配列ならサブリクエストを使わずに戻る。R2 の multi-delete は1回 1000 キーまで */
export async function deleteObjects(
  keys: string[],
  label: string,
): Promise<void> {
  if (keys.length === 0) return;
  try {
    const bucket = getBucket();
    for (let i = 0; i < keys.length; i += 1000) {
      await bucket.delete(keys.slice(i, i + 1000));
    }
  } catch (e) {
    console.error(`${label} R2 cleanup failed (${keys.length} keys)`, e);
  }
}
