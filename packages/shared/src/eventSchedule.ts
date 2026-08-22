import { z } from "zod";

/** タイムテーブルの担当者（イベントメンバーから解決したユーザー情報） */
export const scheduleSpeakerSchema = z.object({
  id: z.string(),
  username: z.string(),
  globalName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});
export type ScheduleSpeaker = z.infer<typeof scheduleSpeakerSchema>;

/** セッションの配置状態 (#338)。
 * - `unassigned` 未割り当て（ネタ出し中）。時刻を持たず、参加者には見せない
 * - `all` 全トラック共通（開会・基調講演・休憩など）。全列をまたぐ
 * - `tracks` 特定のトラック（1つ以上）
 *
 * `unassigned` と `all` はどちらも対応表が空になるため、この値でしか区別できない。
 * `tracks` なのにトラックが空、という状態は作らない（`unassigned` に落とす） */
export const schedulePlacementSchema = z.enum(["unassigned", "all", "tracks"]);
export type SchedulePlacement = z.infer<typeof schedulePlacementSchema>;

/** 誰に見せるか (#383)。`placement`（**どの列に置くか**）とは直交する別の軸で、
 * **混ぜない**。準備・設営・片付けのような裏方の段取りを `'staff'` にすると、
 * 表のセッションと同じ時間軸に並べたまま参加者から隠せる。
 *
 * 絞り込みは必ず **`'public'` かどうか（許可リスト）** で書くこと。
 * `!== 'staff'`（拒否リスト）で書くと、将来値が増えたときに参加者へ漏れる。
 * `placement` の `!= 'unassigned'` が実際にその形で、値を増やす案を採れなかった理由。 */
export const scheduleVisibilitySchema = z.enum(["public", "staff"]);
export type ScheduleVisibility = z.infer<typeof scheduleVisibilitySchema>;

/** タイムテーブルを**誰に見せるための取得か** (#383)。
 *
 * リポジトリの取得系はこれを**必須引数**で受ける。既定値を持たせない。
 * 新しい呼び出し元が現れたとき、付け忘れが**コンパイルエラー**になる側に倒す
 * （黙って参加者へ裏方を配る側に倒さない）。 */
export type ScheduleAudience = "staff" | "public";

/** イベント内のトラック（並行して走る枠）。名前（ラベル）でしかなく会場の部屋とは無関係 */
export const eventTrackSchema = z.object({
  id: z.string(),
  name: z.string(),
  sortOrder: z.number(),
  /** 誰に見せる列か (#383)。`'staff'` は表には無いスタッフ用の列
   * （控え室の留守番のように、どのセッションにも紐づかない持ち場を置く先）。
   * `audience: "public"` で取った一覧には**そもそも入らない** */
  visibility: scheduleVisibilitySchema,
});
export type EventTrack = z.infer<typeof eventTrackSchema>;

/** タイムテーブルの1項目（サーバーが返す形。担当者はユーザー情報に解決済み） */
export const scheduleItemSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  title: z.string(),
  description: z.string(),
  /** 所要時間（分） */
  durationMin: z.number(),
  /** 明示的な開始時刻（epoch ms）。null なら前の項目の終わりから自動計算 */
  startsAt: z.number().nullable(),
  /** リンクされた担当者（イベントメンバー）。フリーテキストのみなら null。
   * 退会申請中 (#250) は表示名を伏せるためここも null になる */
  speaker: scheduleSpeakerSchema.nullable(),
  /** 生の担当者ユーザーID（表示用ではなく編集・権限判定用）。
   * speaker が null でもリンク自体は残っているのでこちらには値が入る (#250)。
   * 編集画面がこの値を持ち回らないと、猶予期間中の保存でリンクが消えて
   * 復帰しても登壇者が戻らなくなる。IDのみで表示名・ハンドルは含まない */
  speakerUserId: z.string().nullable(),
  /** フリーテキストの担当者名（リンクなし） */
  speakerName: z.string(),
  /** 登壇資料URL（Speaker Deck・Googleスライド・events labのデッキ等）。空文字=なし */
  materialUrl: z.string(),
  /** 資料URLのOG画像（サーバーが取得してキャッシュ）。空文字=なし (#149) */
  materialOgImage: z.string(),
  sortOrder: z.number(),
  /** 配置状態 (#338)。トラックを使っていないイベントは全項目 `all` */
  placement: schedulePlacementSchema,
  /** 誰に見せるか (#383)。`audience: "public"` で取った結果は**必ず全部 `'public'`**。
   * 値そのものは返してよい（「見えている項目が表か裏か」は staff の画面が要る） */
  visibility: scheduleVisibilitySchema,
  /** 割り当てられたトラックの ID。`placement` が `tracks` のときだけ非空。
   * `audience: "public"` で取った結果にスタッフ用トラックの ID は入らない (#383) */
  trackIds: z.array(z.string()),
});
export type ScheduleItem = z.infer<typeof scheduleItemSchema>;

/** 登壇資料URLの入力（http/https のみ許可。空文字=なし/クリア） */
const materialUrlInput = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === "" || /^https?:\/\//.test(v), "URLはhttp/httpsのみ")
  .default("");

/** タイムテーブルの保存入力（1項目）。並び順は配列順で決まる */
export const saveScheduleItemInput = z.object({
  /** 既存項目の ID。null / 未指定なら新規追加。
   * 送られた ID が既存項目と一致する間は保存をまたいで ID が変わらない (#340)。
   * サーバーは自分のイベントの既存 ID のみ採用し、それ以外は新規として
   * 採番し直すので、この値をそのまま主キーにはしない */
  id: z.string().max(64).nullable().default(null),
  title: z.string().trim().min(1).max(100),
  description: z.string().max(1000).default(""),
  durationMin: z.number().int().min(0).max(1440),
  startsAt: z.number().int().min(0).nullable().default(null),
  speakerUserId: z.string().nullable().default(null),
  speakerName: z.string().max(100).default(""),
  /** 登壇資料URL。http/https のみ許可（空文字=なし） */
  materialUrl: materialUrlInput,
  /** 配置状態 (#338)。既定は `all`（＝いまと同じ見え方）。
   * `tracks` なのに `trackIndexes` が空ならサーバーが `unassigned` に落とす */
  placement: schedulePlacementSchema.default("all"),
  /** 誰に見せるか (#383)。
   *
   * **既定値を持たせない。省略は「いまの値を保つ」** で、`'public'` ではない。
   * `.default("public")` にすると、**`visibility` を知らない古いクライアント**
   * （このキーを送らないビルド）からの保存が1回通っただけで、そのイベントの裏方が
   * 全件公開になる。zod が `'public'` を埋め、差分保存がそのまま書くため。
   * 参加者のイベント詳細・資料ギャラリー・投影の格子・**リマインダーのメール**に
   * 「会場設営」「撤収」が並び、差分保存なので元に戻せない。
   *
   * 「古いクライアントか」を `tracks` の有無で見分けてはいけない。
   * **`tracks` は送るが `visibility` は送らない**ビルドが実在する（#338〜#383 の間）。
   * 見分けるなら**この値の有無そのもの**で見る。 */
  visibility: scheduleVisibilitySchema.optional(),
  /** 割り当て先を **同じ保存に入っている tracks 配列の添字** で指す。
   * 新規追加したトラックはまだ ID が無い（サーバーが採番する）ので、
   * クライアントが ID をでっち上げずに済むようにここは添字で受ける。
   * 範囲外・重複は無視する */
  trackIndexes: z.array(z.number().int().min(0).max(99)).max(50).default([]),
});
export type SaveScheduleItemInput = z.infer<typeof saveScheduleItemInput>;

/** トラックの保存入力（1件）。並び順は配列順で決まる */
export const saveScheduleTrackInput = z.object({
  /** 既存トラックの ID。null / 未指定なら新規追加。
   * 項目と同じく、サーバーは自分のイベントの既存 ID のみ採用する */
  id: z.string().max(64).nullable().default(null),
  name: z.string().trim().min(1).max(50),
  /** 誰に見せる列か (#383)。
   * 項目と同じく**省略は「いまの値を保つ」**（既定値を持たせない）。
   * `'public'` を既定にすると、この値を送らない古いクライアントの保存で
   * 運営用の列が表の列に戻り、列名が参加者に出る */
  visibility: scheduleVisibilitySchema.optional(),
});
export type SaveScheduleTrackInput = z.infer<typeof saveScheduleTrackInput>;

/* ===== 同時編集の対策 (#340) ===== */

/** 編集中ステータスを取りに行く間隔（ミリ秒）。
 * 既存の前例（採点2秒・Q&A5秒・チャット5秒・配信15秒）のうち5秒に合わせる。
 * 編集を始める前に「誰かが編集中」と気づけるだけの速さが要る一方、
 * 取りに行くのはタイムテーブルを編集できる人だけなので、
 * 参加者全員が回している Q&A・チャットより総量は小さい。
 *
 * 編集中の人はこの間隔で「まだ編集中」と言い続ける（＝これが心拍でもある）。 */
export const SCHEDULE_EDIT_POLL_MS = 5_000;

/** 最後の反応からこれだけ経つと編集中が自動的に解除される（ミリ秒）。
 * 心拍 (5秒) の24回ぶん。ブラウザは背面のタブのタイマーを1分に1回まで
 * 間引くことがあるため、**1分より十分に長く**取る必要がある。
 * 一方で長すぎると「閉じ忘れて帰った人」を待たされるので2分に置く。 */
export const SCHEDULE_EDIT_EXPIRE_MS = 120_000;

/** いまタイムテーブルを編集している人 (#340)。
 * 厳密な排他ではなく、**声かけのための表示**。保存できるかどうかは版で決まる */
export const scheduleEditingUserSchema = z.object({
  userId: z.string(),
  /** 表示名。退会申請中などで解決できないときは空文字
   * （画面は名前を出さず「ほかの運営メンバー」と出す） */
  name: z.string(),
  avatarUrl: z.string().nullable(),
  /** 編集を始めた時刻（epoch ms） */
  startedAt: z.number(),
  /** この時刻を過ぎると自動的に解除される（epoch ms） */
  expiresAt: z.number(),
});
export type ScheduleEditingUser = z.infer<typeof scheduleEditingUserSchema>;

/** 編集中ステータスの取得結果 (#340)。版も一緒に返す
 * （編集中の人が「自分の知っている版が古くなった」と気づけるようにするため） */
export const scheduleEditingStateSchema = z.object({
  /** 誰も編集していなければ null */
  editor: scheduleEditingUserSchema.nullable(),
  /** タイムテーブルの現在の版 */
  version: z.number(),
});
export type ScheduleEditingState = z.infer<typeof scheduleEditingStateSchema>;

/** 登壇者本人による資料URLの更新入力 (#148) */
export const updateScheduleMaterialInput = z.object({
  materialUrl: materialUrlInput,
});
export type UpdateScheduleMaterialInput = z.infer<
  typeof updateScheduleMaterialInput
>;

/** タイムテーブルの保存入力（全項目を送り、サーバーが差分で反映する #340）。
 * 送られなかった既存項目は削除、ID 一致は更新、ID 無しは追加。
 * 並び順は配列順（送った全項目に 0 から振り直す） */
export const saveScheduleInput = z.object({
  /** 読み込んだ時点のタイムテーブルの版 (#340)。
   * サーバーの版と食い違えば保存を止める（誰かが先に保存している）。
   *
   * **必須にしてある**。`tracks` の未指定は「触らない」という安全な既定に
   * 倒せるが、版の未指定に安全な既定は無く、省略を許すと衝突検知をすり抜けた
   * 上書きが黙って通ってしまう。送り忘れは 400 で気づけるほうがよい */
  version: z.number().int().min(0),
  items: z.array(saveScheduleItemInput).max(100),
  /** トラックの定義（配列順が並び順）。項目と同じ差分の規則で反映する。
   *
   * **未指定はトラックを知らないクライアントからの保存**とみなし、
   * トラックの定義・割り当て・配置状態を一切触らない。空配列は
   * 「トラックを全部消す」なので、意味がまったく違う */
  tracks: z.array(saveScheduleTrackInput).max(20).optional(),
});
export type SaveScheduleInput = z.infer<typeof saveScheduleInput>;

/** **時刻の連鎖に使ってよい列**（＝参加者にも見える列）だけに絞る (#383)。
 *
 * `computeScheduleTimes` の第3引数にスタッフ用トラックを混ぜると、
 * 全トラック共通 (`all`) が見る `Math.max(...)` にスタッフ用トラックのカーソルが入り、
 * **staff の画面でだけ**その時刻が後ろへずれる。参加者に配る時刻と食い違い、
 * 会場の進行と参加者の手元がずれる。
 *
 * **この絞り込みを各画面で書き写さないこと。** 呼ぶ場所はサーバー・投影の格子・
 * イベント詳細・編集画面のプレビューと散らばっていて、新しい画面が素直に
 * 「全部のトラック」を渡すと、そこだけ静かにずれる。契約はこの1か所が持つ。
 *
 * 必ず**許可リスト**（`=== "public"`）で判定する。省略は `'public'` 扱い。 */
export function publicTracks<T extends { visibility?: ScheduleVisibility }>(
  tracks: T[],
): T[] {
  return tracks.filter((t) => (t.visibility ?? "public") === "public");
}

/** computeScheduleTimes が見る項目。placement を省いた呼び出しは
 * 全項目 `all`（＝トラックを使っていないイベント）として扱う */
export interface ScheduleTimeItem {
  durationMin: number;
  startsAt: number | null;
  placement?: SchedulePlacement;
  /** 省略は `'public'`（＝参加者にも見せる）扱い (#383) */
  visibility?: ScheduleVisibility;
  trackIds?: string[];
}

/** 各項目の開始時刻（epoch ms）を計算する。
 * 先頭はイベント開始時刻から。明示的な startsAt があればそこから後続が連鎖する。
 * 基準が無い（開催日時未定かつ明示指定なし）間は null。
 *
 * 連鎖は **トラックごと** (#338)。並行して走る枠は互いに時刻を押し出さない。
 * - 未割り当て … 時刻を持たない (null)。どのトラックのカーソルも進めないので、
 *   ネタ出し中のセッションが後続を全部ずらすことがなくなる
 * - 全トラック共通 … 全トラックのカーソルの中でいちばん後ろから始まり、
 *   **全トラックのカーソルを進める**（開会・休憩が全列をまたぐため）
 * - 特定のトラック … そのトラックのカーソルだけを見て、そのトラックだけ進める
 * - 裏方 (visibility='staff' #383) … カーソルを**読むが進めない**。下記の不変条件
 *
 * trackIds を渡さない（＝トラック未設定の）イベントは列が1本しか無いのと同じで、
 * これまでどおりの直列の連鎖になる。
 *
 * > **不可視の項目を配列から除いても、残る項目の時刻が1ミリ秒も変わらないこと** (#383)
 *
 * これが成り立たないと、参加者の画面（裏方が抜けている）と staff の画面で
 * 同じセッションの開始時刻がずれる。ずれた時刻はリマインダーのメールにも載る。
 *
 * **`trackIds` にはスタッフ用トラックを混ぜないこと**。混ぜると、
 * 全トラック共通 (`all`) が見る `Math.max(...)` にスタッフ用トラックのカーソルが
 * 入り、staff の画面でだけ `all` の時刻が後ろへずれる。 */
export function computeScheduleTimes(
  items: ScheduleTimeItem[],
  eventStartsAt: number | null,
  trackIds: string[] = [],
): Array<number | null> {
  const base: number | null =
    eventStartsAt && eventStartsAt > 0 ? eventStartsAt : null;
  // トラックが無いイベントは "" の1本だけを使う（＝従来の直列の連鎖）
  const columns = trackIds.length > 0 ? trackIds : [""];
  const cursors = new Map<string, number | null>(
    columns.map((id) => [id, base]),
  );

  /** その項目が占める列。未知のトラック ID もそのまま列として扱う */
  const columnsOf = (it: ScheduleTimeItem): string[] => {
    if ((it.placement ?? "all") === "all") return columns;
    const ids = (it.trackIds ?? []).filter((id) => id !== "");
    return ids.length > 0 ? ids : columns;
  };

  const out: Array<number | null> = [];
  for (const it of items) {
    if (it.placement === "unassigned") {
      out.push(null);
      continue;
    }
    const cols = columnsOf(it);
    // null は「基準が無い（未知）」なので制約として数えない。
    // 1つでも分かっている列があればそれに合わせる
    const known = cols
      .map((id) => cursors.get(id) ?? base)
      .filter((v): v is number => v !== null);
    const start = it.startsAt ?? (known.length > 0 ? Math.max(...known) : null);
    out.push(start);
    // 参加者に返らない項目 (#383) はカーソルを進めない。進めると、抜けた側と
    // 抜けていない側で同じセッションの時刻がずれる。**読むが進めない**（上の不変条件）。
    //
    // **許可リストで書く**（`!== "public"`）。`=== "staff"` と書くと、将来
    // 値が増えたときに新しい値がカーソルを進めてしまい、参加者に配る時刻が壊れる。
    // 省略は `'public'` 扱い（トラックを使っていない既存の呼び出し元がそのまま動く）。
    //
    // 代償として裏方どうしは自動で連鎖しない（続けて置くと同じ時刻から始まる）。
    // 連鎖の規則が2種類あるとどちらが効いているか読めなくなるので、v1 では足さない
    if ((it.visibility ?? "public") !== "public") continue;
    const next = start === null ? null : start + it.durationMin * 60_000;
    for (const id of cols) cursors.set(id, next);
  }
  return out;
}

/** 同じトラック内で時刻が重なっている組み合わせ (#338)。
 * 重なりは弾かない（保存は止めない）が、タイムテーブルの枠が潰れて読みにくく
 * なるので編集画面で警告するために使う。
 * 未割り当ては時刻を持たないので対象外。全トラック共通は全列を占める。
 *
 * **表と裏 (#383) はまたいで比べない**（表どうし・裏どうしだけ）。裏方は
 * カーソルを進めない（3.3）ので、表のセッションと時間が重なるのが**普通の使い方**
 * （セッション中の控え室の留守番、裏で走る設営）。またいで警告すると、
 * 正しく入力しているのに常時警告が出て、本当の重なりが埋もれる。
 *
 * `trackName` が `null` なら「どのトラックでもなく全トラック共通どうしの重なり」。
 * ここで日本語を返すと訳せなくなるので、**呼ぶ側が辞書から文言を入れる** (#363)。
 * 利用者が付けたトラック名はそのまま返す（訳す対象ではない）。 */
export function findTrackOverlaps<T extends ScheduleTimeItem>(
  items: T[],
  times: Array<number | null>,
  tracks: EventTrack[],
): Array<{ trackName: string | null; a: T; b: T }> {
  const out: Array<{ trackName: string | null; a: T; b: T }> = [];
  // 同じ組み合わせは1行だけにする。全トラック共通どうしはどの列でも重なるので、
  // そのままだとトラックの本数ぶん同じ警告が並ぶ
  const seen = new Set<string>();
  for (const track of tracks) {
    const placed: Array<{ it: T; start: number; at: number }> = [];
    items.forEach((it, i) => {
      const start = times[i];
      if (start === null || start === undefined) return;
      if (it.placement === "unassigned") return;
      if (it.placement !== "all" && !(it.trackIds ?? []).includes(track.id)) {
        return;
      }
      placed.push({ it, start, at: i });
    });
    placed.sort((x, y) => x.start - y.start);
    // 総当たり。長い枠が2つ先の枠と重なる場合があるので隣どうしだけでは足りない
    for (let i = 0; i < placed.length; i++) {
      const a = placed[i]!;
      const end = a.start + a.it.durationMin * 60_000;
      for (let j = i + 1; j < placed.length; j++) {
        const b = placed[j]!;
        // 端が接するだけ（前の終わり＝次の始まり）は重なりではない
        if (b.start >= end) break;
        // 表と裏はまたいで比べない (#383。上の説明)
        if ((a.it.visibility ?? "public") !== (b.it.visibility ?? "public")) {
          continue;
        }
        const pair = `${a.at}-${b.at}`;
        if (seen.has(pair)) continue;
        seen.add(pair);
        out.push({
          trackName:
            a.it.placement === "all" && b.it.placement === "all"
              ? null
              : track.name,
          a: a.it,
          b: b.it,
        });
      }
    }
  }
  return out;
}

/** 編集時のデフォルト所要時間（分） */
export const SCHEDULE_DEFAULT_DURATION_MIN = 20;

export interface ScheduleTemplateItem {
  title: string;
  durationMin: number;
  description: string;
}

export interface ScheduleTemplate {
  key: string;
  name: string;
  items: ScheduleTemplateItem[];
}

/**
 * タイムテーブルのテンプレート（編集画面のたたき台）。
 *
 * **`name` は辞書 (`schedule.templateName_<key>`) が訳す**が、`items` の中身
 * （コマの題名・説明）は日本語のまま。訳し忘れではない (#363):
 * テンプレを選ぶと**その文言がそのまま主催者のタイムテーブルとして保存される**ので、
 * ここを見ている人の言語で訳すと、保存されたあとに「作った人と参加者で
 * 見える文言が違う」ことになる。保存されるデータの言語をどう扱うかは **#364**
 * で別途決める。決まるまでは中身に手を入れないこと。
 */
export const SCHEDULE_TEMPLATES: ScheduleTemplate[] = [
  {
    key: "lt",
    name: "LT会",
    items: [
      { title: "開場・受付", durationMin: 15, description: "" },
      { title: "オープニング", durationMin: 5, description: "趣旨説明・諸注意" },
      { title: "LT 1", durationMin: 10, description: "発表5分＋入れ替え" },
      { title: "LT 2", durationMin: 10, description: "発表5分＋入れ替え" },
      { title: "LT 3", durationMin: 10, description: "発表5分＋入れ替え" },
      { title: "休憩", durationMin: 10, description: "" },
      { title: "LT 4", durationMin: 10, description: "発表5分＋入れ替え" },
      { title: "LT 5", durationMin: 10, description: "発表5分＋入れ替え" },
      { title: "クロージング", durationMin: 5, description: "" },
    ],
  },
  {
    key: "study",
    name: "勉強会",
    items: [
      { title: "開場・受付", durationMin: 15, description: "" },
      { title: "オープニング", durationMin: 5, description: "趣旨説明・諸注意" },
      { title: "セッション 1", durationMin: 40, description: "" },
      { title: "休憩", durationMin: 10, description: "" },
      { title: "セッション 2", durationMin: 40, description: "" },
      { title: "質疑応答・ディスカッション", durationMin: 15, description: "" },
      { title: "クロージング", durationMin: 5, description: "" },
    ],
  },
  {
    key: "hackathon",
    name: "ハッカソン",
    items: [
      { title: "開場・受付", durationMin: 15, description: "" },
      { title: "オープニング", durationMin: 15, description: "趣旨説明・ルール説明" },
      { title: "アイデア出し・チームビルディング", durationMin: 30, description: "" },
      { title: "開発タイム", durationMin: 240, description: "" },
      { title: "成果発表", durationMin: 30, description: "" },
      { title: "審査・表彰", durationMin: 20, description: "" },
      { title: "クロージング", durationMin: 10, description: "" },
    ],
  },
  {
    key: "study-party",
    name: "懇親会つき勉強会",
    items: [
      { title: "開場・受付", durationMin: 15, description: "" },
      { title: "オープニング", durationMin: 5, description: "趣旨説明・諸注意" },
      { title: "セッション 1", durationMin: 40, description: "" },
      { title: "休憩", durationMin: 10, description: "" },
      { title: "セッション 2", durationMin: 40, description: "" },
      { title: "クロージング", durationMin: 5, description: "" },
      { title: "懇親会", durationMin: 60, description: "" },
      { title: "撤収", durationMin: 15, description: "" },
    ],
  },
];
