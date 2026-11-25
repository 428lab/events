import { computeScheduleTimes, publicTracks } from "@eventer/shared";
import type { EventTrack, ScheduleItem } from "@eventer/shared";

/** 時間を高さに直すときの1分あたりの高さ(px)。30分で48px */
export const TIMETABLE_PX_PER_MIN = 1.6;
/** 1つの枠の最低の高さ(px)。時刻と題名が1行で入る高さ。
 * 5分・10分のコマが続いても、ここまでは必ず広げる（時間の目盛りのほうを伸ばす） */
export const TIMETABLE_MIN_BLOCK_PX = 30;
/** 何も置かれていない時間の帯の高さの上限(px)。長い空き時間で表が間延びしないように縮める */
const GAP_CAP_PX = 32;
/** 目盛りの間隔（分）。この倍数に丸めた範囲を描く */
const TICK_MIN = 30;
/** 所要時間0分のコマを描くときの長さ（分）。0分では枠が作れない */
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
  /** 全トラック共通（開会・休憩など。全列をまたぐ） */
  common: boolean;
  /** 裏方（準備・設営・片付けなど。参加者には届かない） (#383)。
   * サーバーが staff にしか返さないので、ここに来ている＝見てよい人が見ている。
   * **画面側では絞らない**（同じ判断が2か所になる）。半透明＋鍵の印で描き分ける */
  staffOnly: boolean;
  /** 所属するトラックの 0 始まりの番号。common のときは全トラック */
  trackIndexes: number[];
}

/** 格子に置ける枠。ひとつの項目が飛び地に割り当てられていたり、
 * 全トラック共通のコマに途中で挟まれていたりすると複数になる */
export interface TimetableBlock {
  /** React の key。同じ項目が割れても衝突しない */
  key: string;
  entry: TimetableEntry;
  /** そのコマの開始時刻（割れた後ろの枠でもコマ全体の開始。時刻の表示に使う） */
  startsAt: number;
  /** 0 始まりの列番号（トラック列。時刻列は含まない） */
  colStart: number;
  colSpan: number;
  /** 1 始まりの行番号（ヘッダー行は含まない）。rowEnd は含まない終端 */
  rowStart: number;
  rowEnd: number;
  /** 枠の高さ(px)。1行に畳むかどうかを描画側が決める */
  heightPx: number;
  /** 同じ列で時刻が重なるコマを横に並べるときの位置（0 始まり）と、並ぶ数 (#345)。
   * 重ねて描くと片方が隠れて読めない */
  lane: number;
  laneCount: number;
  /** 全トラック共通のコマに途中で挟まれて、後ろに続く枠（「続き」と添える） */
  continued: boolean;
  /** 全トラック共通か。無彩色の帯で描く */
  common: boolean;
  /** 裏方か (#383)。参加者には届かない。半透明＋鍵の印で描き分ける */
  staffOnly: boolean;
  /** 色に使うトラックの番号。飛び地で枠が割れても **同じコマは同じ色** に
   * なるよう、列ではなくそのコマの先頭のトラックを指す */
  colorIndex: number;
  /** 枠へ添えるトラック名。読み上げのために単独のトラックでも必ず入れる */
  trackNames: string[];
  /** 隣り合っていないトラックに割り当てられていて、枠が割れている */
  split: boolean;
}

export interface TimetableTick {
  ms: number;
  /** 1 始まりの行番号 */
  rowStart: number;
  rowEnd: number;
  /** ちょうどの時（太い線＋濃い文字にする） */
  hour: boolean;
}

export interface TimetableLayout {
  tracks: EventTrack[];
  /** 未割り当てを除いた全コマ（元の並び順のまま） */
  entries: TimetableEntry[];
  /** 格子に置ける枠（開始時刻が決まったものだけ） */
  blocks: TimetableBlock[];
  /** 開始時刻が決まらず格子に置けなかったコマ（日程調整中など） */
  undated: TimetableEntry[];
  /** 時刻はあるが、描く範囲から離れすぎていて格子に置けなかったコマ。
   * ほぼ打ち間違いなので、気付けるように「未定」とは分けて持つ（上の WINDOW_MS） */
  outOfRange: Array<TimetableEntry & { startsAt: number }>;
  /** 未割り当て（ネタ出し中）。サーバーが staff にしか返さない (#338) */
  unassigned: ScheduleItem[];
  /** 格子の行数（ヘッダー行を除く） */
  rows: number;
  /** 行ごとの高さ(px)。時間に比例させつつ、短いコマが読めるよう伸ばし、空き時間は縮める */
  rowHeights: number[];
  ticks: TimetableTick[];
}

/** その時刻を含む目盛りの頭に丸める（端末の時刻で。UTC 換算だと :30 がずれる国がある） */
function floorToTick(ms: number): number {
  const d = new Date(ms);
  d.setSeconds(0, 0);
  d.setMinutes(Math.floor(d.getMinutes() / TICK_MIN) * TICK_MIN);
  return d.getTime();
}

/** 連続した数の並びを、途切れたところで区切る。[0,1,3] → [[0,1],[3]] */
function runs(sorted: number[]): number[][] {
  const out: number[][] = [];
  for (const n of sorted) {
    const last = out[out.length - 1];
    if (last && last[last.length - 1] === n - 1) last.push(n);
    else out.push([n]);
  }
  return out;
}

/** タイムテーブル画面の下敷きを作る (#338)。
 *
 * 時刻はトラックごとの連鎖（`computeScheduleTimes`）に任せ、ここは
 * 「どの列の何行目から何行目までか」だけを決める。描画側に計算を置くと
 * 広い画面とスマホで結果がずれるため、両方でこの結果を使う。
 *
 * またぎは **隣り合った列だけ** をひとつの枠にする。A と C のように離れた
 * 組み合わせは grid の1枠にできないので、枠を分けて両方に描く（消さない）。 */
export function buildTimetableLayout(
  items: ScheduleItem[],
  tracks: EventTrack[],
  eventStartsAt: number | null,
): TimetableLayout {
  // 格子の列にはスタッフ用の列も並べるが、**時刻を連鎖させる列とは別物**として扱う
  // (#383。理由は @eventer/shared の publicTracks に書いてある)
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
  // 最も多くのコマが収まる WINDOW_MS ぶんだけを格子に置き、外れたものは
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
    return {
      tracks,
      entries,
      blocks: [],
      undated,
      outOfRange,
      unassigned,
      rows: 0,
      rowHeights: [],
      ticks: [],
    };
  }

  const pieces = placePieces(dated, tracks);
  const startMs = floorToTick(Math.min(...pieces.map((p) => p.from)));
  const lastEnd = Math.max(...pieces.map((p) => p.to));
  // 末尾は目盛りの手前で切らない。ちょうどで終わるときはそこまで
  const endTick = floorToTick(lastEnd);
  const endMs = endTick === lastEnd ? lastEnd : endTick + TICK_MIN * MS_PER_MIN;

  // 行の境目＝目盛りとコマの始まり・終わり。時間を一定の幅で刻まず、
  // 何かが変わる時刻だけで区切る（5分のコマが続いても行が潰れない）
  const tickTimes: number[] = [];
  for (let ms = startMs; ms < endMs; ms += TICK_MIN * MS_PER_MIN) tickTimes.push(ms);
  const boundaries = [
    ...new Set([...tickTimes, endMs, ...pieces.flatMap((p) => [p.from, p.to])]),
  ].sort((a, b) => a - b);
  const indexOf = new Map(boundaries.map((ms, i) => [ms, i]));
  const rows = boundaries.length - 1;

  const rowHeights: number[] = [];
  for (let i = 0; i < rows; i++) {
    const from = boundaries[i]!;
    const to = boundaries[i + 1]!;
    const px = ((to - from) / MS_PER_MIN) * TIMETABLE_PX_PER_MIN;
    const covered = pieces.some((p) => p.from < to && from < p.to);
    rowHeights.push(covered ? px : Math.min(px, GAP_CAP_PX));
  }
  // 短いコマから順に、最低の高さに足りない分を最後の行に足す。足すのは行なので、
  // 同じ時間を通る他のコマ・目盛りも一緒に伸びる（重ならない）
  const spanOf = (p: Piece) => [indexOf.get(p.from)!, indexOf.get(p.to)!] as const;
  const byLength = [...pieces].sort((a, b) => {
    const [a0, a1] = spanOf(a);
    const [b0, b1] = spanOf(b);
    return a1 - a0 - (b1 - b0) || a.from - b.from;
  });
  for (const p of byLength) {
    const [r0, r1] = spanOf(p);
    let sum = 0;
    for (let r = r0; r < r1; r++) sum += rowHeights[r]!;
    if (sum < TIMETABLE_MIN_BLOCK_PX) rowHeights[r1 - 1]! += TIMETABLE_MIN_BLOCK_PX - sum;
  }

  const blocks: TimetableBlock[] = pieces.map((p) => {
    const [r0, r1] = spanOf(p);
    let heightPx = 0;
    for (let r = r0; r < r1; r++) heightPx += rowHeights[r]!;
    const { entry } = p;
    return {
      key: p.key,
      entry,
      startsAt: entry.startsAt!,
      colStart: p.colStart,
      colSpan: p.colSpan,
      rowStart: r0 + 1,
      rowEnd: r1 + 1,
      heightPx,
      lane: p.lane,
      laneCount: p.laneCount,
      continued: p.continued,
      common: entry.common,
      staffOnly: entry.staffOnly,
      // 割れた枠どうしで色が変わらないよう、列ではなく先頭のトラックで決める
      colorIndex: entry.common ? 0 : entry.trackIndexes[0]!,
      trackNames: entry.common ? [] : entry.trackIndexes.map((n) => tracks[n]!.name),
      split: !entry.common && runs(entry.trackIndexes).length > 1,
    };
  });

  const ticks: TimetableTick[] = tickTimes.map((ms, i) => ({
    ms,
    rowStart: indexOf.get(ms)! + 1,
    rowEnd: indexOf.get(tickTimes[i + 1] ?? endMs)! + 1,
    hour: new Date(ms).getMinutes() === 0,
  }));

  return {
    tracks,
    entries,
    blocks,
    undated,
    outOfRange,
    unassigned,
    rows,
    rowHeights,
    ticks,
  };
}

/** 格子に置く前の枠（時刻はミリ秒のまま） */
interface Piece {
  key: string;
  entry: TimetableEntry & { startsAt: number };
  from: number;
  to: number;
  colStart: number;
  colSpan: number;
  continued: boolean;
  lane: number;
  laneCount: number;
}

/** 枠を作り、重なりを解く。
 *
 * 1. **全トラック共通（公開）は全列をまたぐ帯**。同じ時刻に続いている他のコマは、
 *    帯の前後で枠を割る（後ろの枠は「続き」）。帯の上に重ねると、どちらも読めない。
 * 2. それでも同じ列で時刻が重なるコマ（同じトラックの重複・裏方と公開など）は、
 *    **横に並べる** (#345)。またぎの枠が重なるときは、列ごとに割ってから並べる。 */
function placePieces(
  dated: Array<TimetableEntry & { startsAt: number }>,
  tracks: EventTrack[],
): Piece[] {
  const all = tracks.length;
  const span = (e: TimetableEntry & { startsAt: number }) =>
    Math.max(ZERO_DURATION_MIN, Math.min(e.item.durationMin, MAX_DURATION_MIN)) * MS_PER_MIN;

  // 帯（公開の全トラック共通）。裏方の共通は参加者の予定を区切らないので帯にしない
  const bands: Piece[] = [];
  let others: Piece[] = [];
  for (const entry of dated) {
    const from = entry.startsAt;
    const to = from + span(entry);
    if (entry.common && !entry.staffOnly) {
      bands.push({ key: entry.item.id, entry, from, to, colStart: 0, colSpan: all, continued: false, lane: 0, laneCount: 1 });
      continue;
    }
    for (const group of runs(entry.trackIndexes)) {
      others.push({
        key: `${entry.item.id}:${group[0]}`,
        entry, from, to, colStart: group[0]!, colSpan: group.length,
        continued: false, lane: 0, laneCount: 1,
      });
    }
  }

  // 1. 帯の時間を抜いて割る
  others = others.flatMap((p) => {
    let parts = [{ from: p.from, to: p.to }];
    for (const b of bands) {
      parts = parts.flatMap((q) =>
        b.to <= q.from || q.to <= b.from
          ? [q]
          : [
              ...(q.from < b.from ? [{ from: q.from, to: b.from }] : []),
              ...(b.to < q.to ? [{ from: b.to, to: q.to }] : []),
            ],
      );
    }
    // 「続き」は2つ目からだけ。帯がコマの頭に重なって最初の枠が後ろにずれても、
    // 見える最初の枠には題名をそのまま出す
    return parts.map((q, i) => ({
      ...p,
      key: i === 0 ? p.key : `${p.key}:${i}`,
      from: q.from,
      to: q.to,
      continued: i > 0,
    }));
  });

  // 2. 重なるまたぎの枠は列ごとに割る（またいだまま横に並べると、隣の列に食い込む）
  const overlaps = (a: Piece, b: Piece) =>
    a !== b && a.from < b.to && b.from < a.to &&
    a.colStart < b.colStart + b.colSpan && b.colStart < a.colStart + a.colSpan;
  others = others.flatMap((p) =>
    p.colSpan > 1 && others.some((q) => overlaps(p, q))
      ? Array.from({ length: p.colSpan }, (_, i) => ({
          ...p,
          key: `${p.key}@${p.colStart + i}`,
          colStart: p.colStart + i,
          colSpan: 1,
        }))
      : [p],
  );

  // 横に並べる。帯どうし・同じ列どうしで、始まりの早い順に空いている位置へ
  const groups = new Map<string, Piece[]>();
  for (const p of [...bands, ...others]) {
    const g = p.colSpan === all && bands.includes(p) ? "band" : `${p.colStart}:${p.colSpan}`;
    groups.set(g, [...(groups.get(g) ?? []), p]);
  }
  for (const group of groups.values()) assignLanes(group);
  return [...bands, ...others];
}

/** 時刻の重なる枠に位置を割り当てる。重なりの塊ごとに、並ぶ数をそろえる */
function assignLanes(pieces: Piece[]): void {
  const sorted = [...pieces].sort((a, b) => a.from - b.from || b.to - a.to);
  let cluster: Piece[] = [];
  let clusterEnd = -Infinity;
  const laneEnds: number[] = [];
  const close = () => {
    const count = Math.max(1, ...cluster.map((p) => p.lane + 1));
    for (const p of cluster) p.laneCount = count;
    cluster = [];
    laneEnds.length = 0;
  };
  for (const p of sorted) {
    if (p.from >= clusterEnd) close();
    let lane = laneEnds.findIndex((end) => end <= p.from);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = p.to;
    p.lane = lane;
    cluster.push(p);
    clusterEnd = Math.max(clusterEnd, p.to);
  }
  close();
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
