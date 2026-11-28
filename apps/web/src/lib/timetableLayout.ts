import { computeScheduleTimes, publicTracks } from "@eventer/shared";
import type { EventTrack, ScheduleItem } from "@eventer/shared";

/** 長いコマを右の並行の列に置く条件: そのコマの最中に、別のコマが
 * **この数以上の時刻に**始まる。並行して長く続く企画（フリーマーケット・交流スペースなど）を、
 * 本筋と同じ幅の右の列に横書きのカードで置く（nostrasia.com の広い画面と同じ考え方。
 * オーナー 2026-11-27「縦書きはスマホ向けだよ」）。1つだけ重なる程度なら、横に並べるほうが題名を読みやすい */
export const TIMETABLE_SIDE_MIN_INNER_STARTS = 2;
/** 所要時間0分のコマを描くときの長さ（分）。0分では重なりを判定できない */
const ZERO_DURATION_MIN = 1;

const MS_PER_MIN = 60_000;

/** 格子に描く時間の幅（ミリ秒）。
 *
 * 開始時刻は staff が手で入れられる任意の epoch なので、年を打ち間違えた
 * **1件で行数が数百万になり、参加者を含む閲覧者全員の画面が固まる**。そこで
 * 描く範囲を区切り、外れたコマは格子に置かず一覧へ落とす（消さずに残す）。
 *
 * 残す側は「最も多くのコマが収まる7日間」。最も早いコマを基準にすると、
 * 過去側に1件打ち間違えただけで正しいコマが全部範囲外になってしまう。
 *
 * 7日にしているのは、**合宿型の3日間や、朝から深夜までの複数日**を丸ごと
 * 収めるため。ここが狭いと、多数派に入らなかった日のコマが打ち間違い扱いで
 * 格子から消える (#346)。打ち間違いは年や日の単位でずれるので7日でも弾ける。
 *
 * これは **残す側の端から端まで** の幅（下の走査は幅がこれを超えない範囲だけを
 * 切り出す）。基準のコマから前後に7日ずつ、ではない。したがって行数の上限は
 * 7日＋1コマの上限24時間＝8日ぶんの2304行、目盛りは384個で頭打ちになる。 */
const WINDOW_MS = 7 * 24 * 60 * MS_PER_MIN;

/** 1コマの最長（分）。保存時に24時間までに絞っているので、これを超える値が
 * 来るのは壊れたデータ。行数の上限を描く範囲だけで決めきるためここでも抑える */
const MAX_DURATION_MIN = 24 * 60;

/** 1コマ（未割り当てを除く）。格子にもスマホの一覧にも同じものを使う */
export interface TimetableEntry {
  item: ScheduleItem;
  /** 計算後の開始時刻（epoch ms）。基準が無くて決まらないときは null */
  startsAt: number | null;
  /** 全トラック共通（開会・休憩など。広い画面では場所の札が「全体」、スマホではどのタブにも出る） */
  common: boolean;
  /** 裏方（準備・設営・片付けなど。参加者には届かない） (#383)。
   * サーバーが staff にしか返さないので、ここに来ている＝見てよい人が見ている。
   * **画面側では絞らない**（同じ判断が2か所になる）。半透明＋鍵の印で描き分ける */
  staffOnly: boolean;
  /** 所属するトラックの 0 始まりの番号。common のときは全トラック */
  trackIndexes: number[];
}

/** 広い画面のタイムライン (#338 → オーナー 2026-11-27) に置く1枚のカード。
 * 1つのコマは必ず1枚（トラックをまたいでも割らない。どこでやるかは場所の札で示す） */
export interface TimetableCard {
  key: string;
  entry: TimetableEntry & { startsAt: number };
  startsAt: number;
  /** 終わりの時刻（epoch ms）。所要時間0分のコマは開始と同じ */
  endsAt: number;
  /** 右の並行の列に置く長いコマか（TIMETABLE_SIDE_MIN_INNER_STARTS） */
  side: boolean;
  /** 1 始まりの行番号。行＝コマの始まる時刻（時間の長さには比例させない）。rowEnd は含まない終端 */
  rowStart: number;
  rowEnd: number;
  /** 本筋のカード: 時刻の重なる組の中での位置と、並ぶ数 (#345)。
   *  並行の列のカード: 並行の列の番号（0 が右端。早く始まった長い企画ほど右）。laneCount は並行の列の数 */
  lane: number;
  laneCount: number;
  /** 本筋のカードが、空いている並行の列に何本ぶん広がるか（本筋のすぐ右から連続して空いている本数） */
  extendSide: number;
  /** 全トラック共通。場所の札は「全体」で、色はテーマの主色（灰色にしない） */
  common: boolean;
  /** 裏方 (#383)。参加者には届かない。破線＋鍵の印で描き分ける */
  staffOnly: boolean;
  /** 場所の札に出すトラックの番号（tracks の並び）。全トラック共通は空 */
  trackIndexes: number[];
}

export interface TimetableLayout {
  /** イベントの全トラック（スマホのタブはこちらを使う） */
  tracks: EventTrack[];
  /** 未割り当てを除いた全コマ（元の並び順のまま） */
  entries: TimetableEntry[];
  /** タイムラインに置くカード（開始時刻が決まったものだけ） */
  cards: TimetableCard[];
  /** 行の時刻（epoch ms、昇順・重複なし）。行＝どれかのコマが始まる時刻 */
  rows: number[];
  /** 右の並行の列の数（本筋の列と同じ幅） */
  sideLanes: number;
  /** 開始時刻が決まらずタイムラインに置けなかったコマ（日程調整中など） */
  undated: TimetableEntry[];
  /** 時刻はあるが、描く範囲から離れすぎていて置けなかったコマ。
   * ほぼ打ち間違いなので、気付けるように「未定」とは分けて持つ（上の WINDOW_MS） */
  outOfRange: Array<TimetableEntry & { startsAt: number }>;
  /** 未割り当て（ネタ出し中）。サーバーが staff にしか返さない (#338) */
  unassigned: ScheduleItem[];
  /** カードの最初の開始と最後の終わり（「いま」の印を出す範囲）。カードが無ければ null */
  span: { from: number; to: number } | null;
}

/** タイムテーブル画面の下敷きを作る (#338)。
 *
 * 時刻はトラックごとの連鎖（`computeScheduleTimes`）に任せ、ここは
 * 「どの行からどの行まで・本筋か細い列か・何番目に並ぶか」だけを決める。
 * 描画側に計算を置くと広い画面とスマホで結果がずれるため、両方でこの結果を使う。
 *
 * 見た目は nostrasia.com のタイムテーブルに寄せた縦のタイムライン（オーナー 2026-11-27
 * 「詰まりすぎてて見づらい」「このページのタイムテーブルを参考に」）。
 * - 行は **コマの始まる時刻** だけ。時間の長さに比例させないので、5分の登壇が続いても潰れない
 * - 本筋（短いコマ・全トラック共通）は横幅いっぱいのカード。時刻の重なるものは横に並べる (#345)
 * - 並行して長く続く企画は、右の並行の列（本筋と同じ幅）に横書きのカードで置く。
 *   本筋のカードは、その時間に空いている並行の列のぶんまで広がる
 * - トラックは列ではなく、色と場所の札で示す（空のトラックが場所を取らない） */
export function buildTimetableLayout(
  items: ScheduleItem[],
  tracks: EventTrack[],
  eventStartsAt: number | null,
): TimetableLayout {
  // 時刻を連鎖させる列は表のトラックだけ (#383。理由は @eventer/shared の publicTracks)
  const times = computeScheduleTimes(
    items,
    eventStartsAt,
    publicTracks(tracks).map((t) => t.id),
  );
  const indexOfTrack = new Map(tracks.map((t, i) => [t.id, i]));
  const allIndexes = tracks.map((_, i) => i);

  const unassigned: ScheduleItem[] = [];
  const entries: TimetableEntry[] = [];
  items.forEach((item, i) => {
    if (item.placement === "unassigned") {
      unassigned.push(item);
      return;
    }
    // トラックが1本も無いイベントは全部が「全トラック共通」と同じ見え方になる。
    // 割り当て先が全部消えている（＝トラックを消された）ものも共通に落とす。
    // 時刻の計算 (computeScheduleTimes) が同じ扱いをするので、そろえる
    const mine =
      item.placement === "tracks"
        ? item.trackIds
            .map((id) => indexOfTrack.get(id))
            .filter((n): n is number => n !== undefined)
            .sort((a, b) => a - b)
        : [];
    const common = mine.length === 0;
    entries.push({
      item,
      startsAt: times[i] ?? null,
      common,
      staffOnly: item.visibility === "staff",
      trackIndexes: common ? allIndexes : mine,
    });
  });

  const timed = entries.filter(
    (e): e is TimetableEntry & { startsAt: number } => e.startsAt !== null,
  );
  // 最も多くのコマが収まる WINDOW_MS ぶんだけを置き、外れたものは
  // outOfRange へ落とす（消さずに一覧で見せる。上の WINDOW_MS 参照）
  const sorted = [...timed].sort((a, b) => a.startsAt - b.startsAt);
  let from = 0;
  let count = 0;
  let lo = 0;
  for (let hi = 0; hi < sorted.length; hi++) {
    while (sorted[hi]!.startsAt - sorted[lo]!.startsAt > WINDOW_MS) lo++;
    if (hi - lo + 1 > count) {
      from = lo;
      count = hi - lo + 1;
    }
  }
  const dated = sorted.slice(from, from + count);
  const kept = new Set<TimetableEntry>(dated);
  const undated = entries.filter((e) => e.startsAt === null);
  const outOfRange = entries.filter(
    (e): e is TimetableEntry & { startsAt: number } =>
      e.startsAt !== null && !kept.has(e),
  );

  if (dated.length === 0 || tracks.length === 0) {
    return { tracks, entries, cards: [], rows: [], sideLanes: 0, undated, outOfRange, unassigned, span: null };
  }

  const rows = [...new Set(dated.map((e) => e.startsAt))].sort((a, b) => a - b);
  const rowOf = new Map(rows.map((ms, i) => [ms, i]));
  const lengthMs = (e: TimetableEntry) =>
    Math.max(ZERO_DURATION_MIN, Math.min(e.item.durationMin, MAX_DURATION_MIN)) * MS_PER_MIN;

  const cards: TimetableCard[] = dated.map((entry) => {
    const start = entry.startsAt;
    const end = start + lengthMs(entry);
    const r0 = rowOf.get(start)!;
    // 終わりより前に始まる最後の行まで（少なくとも自分の行）
    let r1 = r0 + 1;
    while (r1 < rows.length && rows[r1]! < end) r1++;
    const innerStarts = r1 - r0 - 1;
    return {
      key: entry.item.id,
      entry,
      startsAt: start,
      endsAt: start + Math.max(0, Math.min(entry.item.durationMin, MAX_DURATION_MIN)) * MS_PER_MIN,
      side: innerStarts >= TIMETABLE_SIDE_MIN_INNER_STARTS,
      rowStart: r0 + 1,
      rowEnd: r1 + 1,
      lane: 0,
      laneCount: 1,
      extendSide: 0,
      common: entry.common,
      staffOnly: entry.staffOnly,
      trackIndexes: entry.common ? [] : entry.trackIndexes,
    };
  });

  // 並行の列: 行の重なりで位置を決める（全体で通しの番号。並ぶ数＝並行の列の数）
  const side = cards.filter((c) => c.side);
  assignLanes(side);
  const sideLanes = Math.max(0, ...side.map((c) => c.lane + 1));
  for (const c of side) c.laneCount = sideLanes;

  // 本筋: 行の重なる組ごとに横に並べ、組の行の範囲で空いている並行の列へ広げる。
  // 本筋のすぐ右の列は番号の大きい側（0 が右端）なので、sideLanes-1 から順に見る
  const main = cards.filter((c) => !c.side);
  for (const cluster of assignLanes(main)) {
    const r0 = Math.min(...cluster.map((c) => c.rowStart));
    const r1 = Math.max(...cluster.map((c) => c.rowEnd));
    let extend = 0;
    while (
      extend < sideLanes &&
      !side.some((s) => s.lane === sideLanes - 1 - extend && s.rowStart < r1 && r0 < s.rowEnd)
    ) {
      extend++;
    }
    for (const c of cluster) c.extendSide = extend;
  }

  return {
    tracks,
    entries,
    cards,
    rows,
    sideLanes,
    undated,
    outOfRange,
    unassigned,
    span: {
      from: rows[0]!,
      to: Math.max(...cards.map((c) => c.startsAt + lengthMs(c.entry))),
    },
  };
}

/** 行の重なるカードに位置（lane）を割り当て、重なりの塊ごとに並ぶ数をそろえる。
 * 塊（重なりでつながったカードの組）を返す */
function assignLanes(cards: TimetableCard[]): TimetableCard[][] {
  const sorted = [...cards].sort(
    (a, b) => a.rowStart - b.rowStart || b.rowEnd - a.rowEnd || a.entry.item.sortOrder - b.entry.item.sortOrder,
  );
  const clusters: TimetableCard[][] = [];
  let cluster: TimetableCard[] = [];
  let clusterEnd = -Infinity;
  const laneEnds: number[] = [];
  const close = () => {
    if (cluster.length === 0) return;
    const count = Math.max(...cluster.map((c) => c.lane + 1));
    for (const c of cluster) c.laneCount = count;
    clusters.push(cluster);
    cluster = [];
    laneEnds.length = 0;
  };
  for (const c of sorted) {
    if (c.rowStart >= clusterEnd) close();
    let lane = laneEnds.findIndex((end) => end <= c.rowStart);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = c.rowEnd;
    c.lane = lane;
    cluster.push(c);
    clusterEnd = Math.max(clusterEnd, c.rowEnd);
  }
  close();
  return clusters;
}

/** その時刻の位置づけ。過去・開催中・これから（タイムラインの薄くする・強調する） */
export function timeState(card: { startsAt: number; endsAt: number }, now: number): "past" | "live" | "future" {
  if (now >= Math.max(card.endsAt, card.startsAt + 60_000)) return "past";
  if (now >= card.startsAt) return "live";
  return "future";
}

/** 「いま」の印を置く行（1 始まり）。その行の上に引く。
 * 最後の行より後（まだ最後のコマが続いている）なら rows.length + 1（＝末尾の下）。
 * カードの最初の開始〜最後の終わりの外なら null（出さない） */
export function nowRow(layout: TimetableLayout, now: number): number | null {
  const { span, rows } = layout;
  if (!span || now < span.from || now > span.to) return null;
  const next = rows.findIndex((ms) => ms > now);
  return next === -1 ? rows.length + 1 : next + 1;
}

/** そのトラックのタブに出すコマ (#338)。
 * **全トラック共通はどのタブにも出す**（開会・休憩はどの列の人にも関係する）。
 * 並びは元の順（＝時刻順の連鎖）のまま。 */
export function entriesForTrack(
  layout: TimetableLayout,
  trackIndex: number,
): TimetableEntry[] {
  return layout.entries.filter(
    (e) => e.common || e.trackIndexes.includes(trackIndex),
  );
}
