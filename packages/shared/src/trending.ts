/** 注目（トレンド） (#259 PR1)。運営管理者のダッシュボード専用。
 * **公開ランキングではない**（既存方針: ランキングは非公開・偏差値のみオプトイン #175）。
 *
 * 新規テーブルは作らず、既存データからの集計だけで出す。
 * スコアの重みはサービスの規模や方針で変わるため、すべてこのファイルの定数に集約する。
 *
 * 重みの考え方は既存のゲーミフィケーション (gamification.ts の XP_WEIGHTS) と揃える。
 * 「場を作る側（主催・スタッフ）を厚く、ワンタップで済む行動は薄く」という同じ思想で、
 * 共通する行動は XP_WEIGHTS と同じ値にしてある。片方だけ動かすと運営の感覚と
 * ユーザーに見えているXPがずれるので、変更するときは両方を見比べること。 */

/** 期間指定が無いときの既定日数。
 * 「急上昇」は前の同じ長さの期間との比なので、全期間（比較対象なし）は選べない */
export const TRENDING_DEFAULT_DAYS = 30;

/** 各リスト（活動量上位・急上昇）の最大件数 */
export const TRENDING_LIST_SIZE = 10;

/** SQL から持ち帰る候補の最大件数（期間内スコアの降順）。
 * 順位付けは JS 側でやるが、母集団が増えたときに全件を持ってこないための上限。
 *
 * **副作用**: 「急上昇」もこの候補の中からしか選べない。今期間スコアがこの上限より
 * 下位に沈んだものは、前期間比がどれだけ大きくても急上昇に出てこない。
 * （例: 同スコアの人が上限いっぱい並んでいると、その下にいる伸びは拾えない）
 * クエリ本数を増やさない方針なので、まずはこの上限を余裕を持って大きく取っている。
 * 母集団がここを超えるようになったら「急上昇だけ別条件で取る」等の見直しが要る */
export const TRENDING_CANDIDATE_LIMIT = 500;

/** ユーザーのスコア重み。値が大きいほど「注目」に上がりやすい */
export const TRENDING_USER_WEIGHTS = {
  /** 主催（開催完了したイベントのオーナー）。XP_WEIGHTS.hosted と同値 */
  hosted: 100,
  /** スタッフとして参加（オーナー以外の確定スタッフ）。XP_WEIGHTS.staffed と同値 */
  staffed: 50,
  /** 参加（確定・出席チェック実施イベントは出席者のみ）。XP_WEIGHTS.attended と同値 */
  joined: 10,
  /** 主催・スタッフ・参加者としてもらったいいね。XP_WEIGHTS.likeReceived と同値 */
  likeReceived: 5,
  /** 出会い（イベント会場でのQR読み合い）。XP_WEIGHTS.meet と同値 */
  meet: 5,
  /** たまご（イベントリクエスト）の投稿。XPには無い項目。
   * 「まだイベントになっていない動き出し」を拾うため、参加と同程度に置く */
  eggPosted: 10,
  /** たまごへの賛同（参加したい／開催してもいい）。ワンタップなので投稿より軽く */
  eggReaction: 2,
  /** フォロワーの増加数。自分の行動ではなく他者の反応なので軽め */
  followerGained: 3,
} as const;

/** コミュニティのスコア重み */
export const TRENDING_COMMUNITY_WEIGHTS = {
  /** 開催完了したイベント数 */
  heldEvent: 100,
  /** 延べ参加者数（開催完了イベントの確定参加者。主催・スタッフを除く） */
  participation: 5,
  /** 新規メンバー数 */
  newMember: 10,
  /** コミュニティとしてもらったいいね */
  likeReceived: 5,
} as const;

/** 「急上昇」に載せるための期間内スコアの下限。
 * これを入れないと「前期間1・今期間2」のような極端に小さい母数で倍率が跳ね、
 * リストが誤差だらけになる。ユーザーは主催1回ぶん、コミュニティはイベント1回に
 * 少し参加者が付いたぶん、を目安にしている */
export const TRENDING_MIN_RISING_SCORE = {
  user: 30,
  community: 50,
} as const;

/** 前期間比の平滑化定数 K（ラプラス平滑化）。
 * 比は素の score / previousScore ではなく **(score + K) / (previousScore + K)** で出す。
 *
 * 足切り (TRENDING_MIN_RISING_SCORE) が効くのは今期間スコアだけで、前期間スコアは
 * 賛同1回の2点まで下がりうる（前期間0＝新規も含む）。素の割り算だと
 * 「前期間に賛同1回(2点) → 今期間に3回参加(30点)」が ×15、前期間0なら ∞ になり、
 * 「500点 → 2000点」という本物の伸び (×4) より上に来てしまう。
 * 分母・分子に K を足すと、K に対して小さい母数の比は 1 の側へ押し戻され、
 * K より十分大きい母数では素の比にほぼ一致する。
 *
 * **K の決め方**: 足切りちょうど（今期間 = minScore）の新規が到達できる比は
 * (minScore + K) / (0 + K) = 1 + minScore / K が上限になる。この上限を
 * 1.5〜1.6 あたりに置くと、100→300 (K=50 で ×2.33) のような本物の伸びが
 * ノイズの上限より確実に上に来る。逆に K を足切りと同じ値まで下げると上限が ×2 になり、
 * 100→300 とほとんど差が無くなる。そこから逆算して
 * - user: 足切り 30 → K 50（上限 ×1.60）
 * - community: 足切り 50 → K 100（上限 ×1.50）
 * とする。コミュニティも K を足切りと同値の 50 のままにすると上限が ×2.00 になり、
 * ユーザー側と保証の強さが揃わないので、同じ考え方で引き上げてある
 * （100 は「開催1回ぶん」でもあり、丸めた値としても収まりが良い）。
 * 大きくするほど小さな母数の跳ねは抑えられるが、比の差も潰れる */
export const TRENDING_RATIO_SMOOTHING = {
  user: 50,
  community: 100,
} as const;

/** 「急上昇」に載せるための平滑化比の下限。下がっているものは急上昇ではないので、
 * 1 を下回る（前期間より縮んだ）候補はリストに載せない。
 * 伸びている候補が少ない期間はリストが短くなる（空でもよい） */
export const TRENDING_MIN_RISING_RATIO = 1;

/** ユーザーのスコア内訳（各行動の期間内の件数） */
export interface TrendingUserBreakdown {
  /** 主催（開催完了）した公開イベント数 */
  hosted: number;
  /** スタッフとして参加した開催完了イベント数（自分が主催した分は含まない） */
  staffed: number;
  /** 参加した開催完了イベント数（確定・出席チェック実施なら出席したもののみ）。
   * 数える行の条件は運営ダッシュボードのKPIと同じ（role<>'staff' の確定行） */
  joined: number;
  /** もらったいいね数（公開イベントの host/staff/participant いいね） */
  likesReceived: number;
  /** 出会い（QR読み合い）の件数 */
  meets: number;
  /** 投稿したたまご（イベントリクエスト）の件数 */
  eggsPosted: number;
  /** たまごに押した賛同の件数 */
  eggReactions: number;
  /** 増えたフォロワー数 */
  followersGained: number;
}

/** コミュニティのスコア内訳（各指標の期間内の件数） */
export interface TrendingCommunityBreakdown {
  /** 開催完了したイベント数 */
  heldEvents: number;
  /** 延べ参加者数（開催完了イベントの確定参加者。主催・スタッフを除く） */
  participations: number;
  /** 新規メンバー数 */
  newMembers: number;
  /** コミュニティとしてもらったいいね数 */
  likesReceived: number;
}

/** リストの1項目に共通する部分 */
interface TrendingItemBase {
  /** 期間内スコア（重み付き合計） */
  score: number;
  /** 前の同じ長さの期間のスコア。0 なら「新規」 */
  previousScore: number;
  /** 平滑化した前期間比 (score + K) / (previousScore + K)。**急上昇リストのときだけ入る**
   * （活動量上位リストでは null）。K > 0 なので前期間0でも有限で、ゼロ除算しない。
   * K は TRENDING_RATIO_SMOOTHING（素の倍率ではないので画面の説明もそれに合わせる） */
  ratio: number | null;
  /** 前期間のスコアが0（＝この期間に初めて動いた）。**「新規」バッジ用の情報表示だけ**で、
   * 順位には影響しない（前期間0でも比は定義できるので特別扱いしない） */
  isNew: boolean;
}

/** 注目ユーザー1件 */
export interface TrendingUserItem extends TrendingItemBase {
  id: string;
  /** ハンドル（プロフィールURL /users/:handle に使う） */
  handle: string;
  /** 表示名 */
  name: string;
  avatarUrl: string | null;
  breakdown: TrendingUserBreakdown;
}

/** 注目コミュニティ1件 */
export interface TrendingCommunityItem extends TrendingItemBase {
  id: string;
  /** スラッグ（コミュニティURL /c/:slug に使う） */
  slug: string;
  name: string;
  iconUrl: string | null;
  breakdown: TrendingCommunityBreakdown;
}

/** 「活動量上位」と「急上昇」の2リスト */
export interface TrendingLists<T> {
  /** 期間内スコアの上位 */
  active: T[];
  /** 平滑化した前期間比の上位。新規（前期間0）も同じ式で比を出すので特別枠は無い。
   * 期間内スコアが下限未満のもの・比が 1 未満（＝下落）のものは載せない */
  rising: T[];
}

/** 画面の注記に出すスコアの重み。**ペイロードに載せる**のは、
 * 画面側のバンドル定数を読むと古いバンドルで注記だけが実装とずれるため */
export type TrendingUserWeights = Record<
  keyof typeof TRENDING_USER_WEIGHTS,
  number
>;
export type TrendingCommunityWeights = Record<
  keyof typeof TRENDING_COMMUNITY_WEIGHTS,
  number
>;

/** GET /api/admin/trending のレスポンス */
export interface TrendingPayload {
  /** 集計期間（日数）。全期間は選べない */
  days: number;
  /** 今期間の開始 (epoch ms)。今期間は **[since, until)** */
  since: number;
  /** 集計時刻 (epoch ms)＝今期間の終わり */
  until: number;
  /** 前期間の開始 (epoch ms)。前期間は **[previousSince, since)**。
   * 日境界ではなく epoch で切るので、今期間と前期間の長さは厳密に同じ */
  previousSince: number;
  /** 「急上昇」に載せるための期間内スコアの下限（画面の注記に出す） */
  minRisingScore: { user: number; community: number };
  /** 前期間比の平滑化定数 K（画面の注記に出す） */
  ratioSmoothing: { user: number; community: number };
  /** 「急上昇」に載せるための平滑化比の下限（画面の注記に出す） */
  minRisingRatio: number;
  /** スコアの重み（画面の注記・内訳のツールチップに出す） */
  weights: { user: TrendingUserWeights; community: TrendingCommunityWeights };
  users: TrendingLists<TrendingUserItem>;
  communities: TrendingLists<TrendingCommunityItem>;
}

/** ユーザーの内訳からスコアを計算する */
export function trendingUserScore(b: TrendingUserBreakdown): number {
  const w = TRENDING_USER_WEIGHTS;
  return (
    b.hosted * w.hosted +
    b.staffed * w.staffed +
    b.joined * w.joined +
    b.likesReceived * w.likeReceived +
    b.meets * w.meet +
    b.eggsPosted * w.eggPosted +
    b.eggReactions * w.eggReaction +
    b.followersGained * w.followerGained
  );
}

/** コミュニティの内訳からスコアを計算する */
export function trendingCommunityScore(b: TrendingCommunityBreakdown): number {
  const w = TRENDING_COMMUNITY_WEIGHTS;
  return (
    b.heldEvents * w.heldEvent +
    b.participations * w.participation +
    b.newMembers * w.newMember +
    b.likesReceived * w.likeReceived
  );
}

/** 平滑化した前期間比 (score + K) / (previousScore + K)。
 * **前期間0（新規）でも定義できる**のがこの式の要点で、K > 0 なので分母は 0 にならず、
 * NaN/Infinity を返さない。新規を「比が出せないもの」として別扱いする必要は無い */
export function trendingRatio(
  score: number,
  previousScore: number,
  smoothing: number,
): number {
  return (score + smoothing) / (Math.max(previousScore, 0) + smoothing);
}

/** buildTrendingLists の設定。既定値は同ファイルの定数 */
export interface TrendingListOptions {
  /** 「急上昇」に載せるための期間内スコアの下限 */
  minScore: number;
  /** 前期間比の平滑化定数 K（TRENDING_RATIO_SMOOTHING） */
  smoothing: number;
  /** 各リストの最大件数 */
  size?: number;
  /** 「急上昇」に載せるための平滑化比の下限 */
  minRatio?: number;
}

/** 候補から「活動量上位」と「急上昇」の2リストを作る。
 * - 活動量上位: 期間内スコアの降順
 * - 急上昇: 期間内スコアが minScore 以上、かつ平滑化比が minRatio 以上のものを、
 *   **平滑化比の降順に並べるだけ**。
 *
 * 新規（前期間0）に特別枠は無い。平滑化のおかげで (score + K) / (0 + K) が有限に
 * 定まるので、他の候補とまったく同じ式で比較できる。別枠にして先頭へ固定すると、
 * 足切りちょうどの新規（比 1.6 程度）が「2 → 2000」のような本物の伸び（比 39）より
 * 上に来てしまい、リストの意味が壊れる。「新規」は順位ではなくバッジで示す。
 *
 * 同点・同比のときは入力順（SQL の ORDER BY ... DESC, uid）がそのまま残るよう、
 * 安定ソートに任せる（Array#sort は仕様上安定）。 */
export function buildTrendingLists<T extends TrendingItemBase>(
  candidates: T[],
  opts: TrendingListOptions,
): TrendingLists<T> {
  const {
    minScore,
    smoothing,
    size = TRENDING_LIST_SIZE,
    minRatio = TRENDING_MIN_RISING_RATIO,
  } = opts;

  const active = [...candidates]
    .sort((a, b) => b.score - a.score)
    .slice(0, size)
    .map((it) => ({ ...it, ratio: null }));

  const rising = candidates
    .filter((it) => it.score >= minScore)
    .map((it) => ({
      ...it,
      ratio: trendingRatio(it.score, it.previousScore, smoothing),
    }))
    .filter((it) => it.ratio >= minRatio)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, size);

  return { active, rising };
}
