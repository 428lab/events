import { computeScheduleTimes } from "@eventer/shared";
import type { EventTrack, ScheduleItem } from "@eventer/shared";

/** 格子の1マスの分数。細かすぎると行数が増えて重く、粗いと短いコマが潰れる */
export const TIMETABLE_SLOT_MIN = 5;
/** 1マスの高さ(px)。所要時間がそのまま枠の高さになる */
export const TIMETABLE_SLOT_PX = 9;
/** 目盛りの間隔（分）。この倍数に丸めた範囲を描く */
const TICK_MIN = 30;
/** 枠の最小マス数。0分・5分のコマでも文字が1行入るだけの高さを残す */
const MIN_SLOTS = 2;

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

/** 格子に置ける枠。ひとつの項目が飛び地に割り当てられていると複数になる */
export interface TimetableBlock {
  /** React の key。同じ項目が割れても衝突しない */
  key: string;
  entry: TimetableEntry;
  startsAt: number;
  /** 0 始まりの列番号（トラック列。時刻列は含まない） */
  colStart: number;
  colSpan: number;
  /** 1 始まりの行番号（ヘッダー行は含まない）。rowEnd は含まない終端 */
  rowStart: number;
  rowEnd: number;
  /** 全トラック共通か。無彩色の帯で描く */
  common: boolean;
  /** 裏方か (#383)。公開の枠と時刻が重なるのが普通の使い方なので、
   * 半透明にして**公開の枠より上**に重ねる（下に置くと埋もれて見えない） */
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
  // 時刻を連鎖させる列は**公開トラックだけ** (#383)。格子の列にはスタッフ用の
  // 列も並べるが、時刻の計算とは別物として扱う。混ぜると、全トラック共通が見る
  // Math.max(...) にスタッフ用トラックのカーソルが入り、**staff の画面でだけ**
  // 全トラック共通の時刻が後ろへずれる（参加者と時刻が食い違う）
  const times = computeScheduleTimes(
    items,
    eventStartsAt,
    // 許可リストで書く（値が増えたときに新しい列が黙って混ざらないように）
    tracks.filter((t) => t.visibility === "public").map((t) => t.id),
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
      ticks: [],
    };
  }

  const slotMs = TIMETABLE_SLOT_MIN * MS_PER_MIN;
  const slotsOf = (min: number) =>
    Math.max(
      MIN_SLOTS,
      Math.ceil(Math.min(min, MAX_DURATION_MIN) / TIMETABLE_SLOT_MIN),
    );
  const startMs = floorToTick(Math.min(...dated.map((e) => e.startsAt)));
  const lastEnd = Math.max(
    ...dated.map((e) => e.startsAt + slotsOf(e.item.durationMin) * slotMs),
  );
  // 末尾は目盛りの手前で切らない。ちょうどで終わるときはそこまで
  const endTick = floorToTick(lastEnd);
  const endMs = endTick === lastEnd ? lastEnd : endTick + TICK_MIN * MS_PER_MIN;
  const rows = Math.max(1, Math.round((endMs - startMs) / slotMs));

  const rowOf = (ms: number) => Math.round((ms - startMs) / slotMs) + 1;

  const blocks: TimetableBlock[] = [];
  for (const entry of dated) {
    const rowStart = rowOf(entry.startsAt);
    const rowEnd = rowStart + slotsOf(entry.item.durationMin);
    if (entry.common) {
      blocks.push({
        key: entry.item.id,
        entry,
        startsAt: entry.startsAt,
        colStart: 0,
        colSpan: tracks.length,
        rowStart,
        rowEnd,
        common: true,
        staffOnly: entry.staffOnly,
        colorIndex: 0,
        trackNames: [],
        split: false,
      });
      continue;
    }
    const groups = runs(entry.trackIndexes);
    for (const group of groups) {
      blocks.push({
        key: `${entry.item.id}:${group[0]}`,
        entry,
        startsAt: entry.startsAt,
        colStart: group[0]!,
        colSpan: group.length,
        // 割れた枠どうしで色が変わらないよう、列ではなく先頭のトラックで決める
        colorIndex: entry.trackIndexes[0]!,
        rowStart,
        rowEnd,
        common: false,
        staffOnly: entry.staffOnly,
        trackNames: entry.trackIndexes.map((n) => tracks[n]!.name),
        split: groups.length > 1,
      });
    }
  }

  const ticks: TimetableTick[] = [];
  for (let ms = startMs; ms < endMs; ms += TICK_MIN * MS_PER_MIN) {
    const rowStart = rowOf(ms);
    ticks.push({
      ms,
      rowStart,
      rowEnd: Math.min(rowStart + TICK_MIN / TIMETABLE_SLOT_MIN, rows + 1),
      hour: new Date(ms).getMinutes() === 0,
    });
  }

  return {
    tracks,
    entries,
    blocks,
    undated,
    outOfRange,
    unassigned,
    rows,
    ticks,
  };
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
