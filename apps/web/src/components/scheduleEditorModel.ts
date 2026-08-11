import type {
  EventTrack,
  SaveScheduleInput,
  SaveScheduleItemInput,
  ScheduleItem,
  ScheduleTimeItem,
} from "@eventer/shared";
import { SCHEDULE_DEFAULT_DURATION_MIN } from "@eventer/shared";

/** 編集中の1行（key は React の並び替え用）。
 * 割り当て先は**トラックの ID ではなく編集中のキー**で持つ (#338)。
 * 追加したばかりのトラックはまだ ID が無く（保存時にサーバーが採番する）、
 * ID で持つとその1本だけ割り当てられないため */
export interface Row extends Omit<SaveScheduleItemInput, "trackIndexes"> {
  key: string;
  trackKeys: string[];
}

/** 編集中のトラック1本。id が null なら未保存（新規追加） */
export interface TrackRow {
  key: string;
  id: string | null;
  name: string;
}

export function newRow(partial?: Partial<Omit<Row, "key">>): Row {
  return {
    key: crypto.randomUUID(),
    // 既存項目から作る場合だけ id が入る。null は新規追加 (#340)
    id: null,
    title: "",
    description: "",
    durationMin: SCHEDULE_DEFAULT_DURATION_MIN,
    startsAt: null,
    speakerUserId: null,
    speakerName: "",
    materialUrl: "",
    // 既定は全トラック共通。トラックを使っていないイベントでは唯一の配置状態
    placement: "all",
    trackKeys: [],
    ...partial,
  };
}

/** サーバーから来た項目を編集用の行にする。トラック ID は編集中のキーに読み替える */
export function rowFromItem(item: ScheduleItem, tracks: TrackRow[]): Row {
  const keyById = new Map(
    tracks.filter((t) => t.id).map((t) => [t.id!, t.key]),
  );
  return newRow({
    // 既存項目の ID を持ち回って保存時に送り返す。これが無いと保存のたびに
    // 作り直しになり、資料URLの自己編集 (#148) と
    // トラックの割り当て (#338) が別のコマに当たる (#340)
    id: item.id,
    title: item.title,
    description: item.description,
    durationMin: item.durationMin,
    startsAt: item.startsAt,
    // 表示用の speaker ではなく生の speakerUserId を持つ (#250)。
    // 退会申請中の登壇者は speaker が null になるため、そちらを見ると
    // 保存のたびにリンクが外れ、復帰しても登壇者が戻らなくなる
    speakerUserId: item.speakerUserId,
    speakerName: item.speakerName,
    materialUrl: item.materialUrl,
    placement: item.placement,
    trackKeys: item.trackIds
      .map((id) => keyById.get(id))
      .filter((k): k is string => k !== undefined),
  });
}

export function trackRowFromTrack(track: EventTrack): TrackRow {
  return { key: crypto.randomUUID(), id: track.id, name: track.name };
}

export function newTrackRow(name: string): TrackRow {
  return { key: crypto.randomUUID(), id: null, name };
}

/** 割り当て先を決め直す。**トラックが空になったら未割り当てに戻す**。
 * これはサーバー側の規則と同じで、トラックを消して載る先が無くなった場合も
 * チップを全部外した場合も、扱いはこの1つだけ (#338) */
function withTrackKeys(row: Row, trackKeys: string[]): Row {
  return trackKeys.length > 0
    ? { ...row, placement: "tracks", trackKeys }
    : { ...row, placement: "unassigned", trackKeys: [] };
}

/** トラックのチップを付け外しする（タップ操作の実体）。
 * 全トラック共通の行でチップを押したら、その1本だけの割り当てに切り替える */
export function toggleTrack(row: Row, trackKey: string): Row {
  if (row.placement !== "tracks") return withTrackKeys(row, [trackKey]);
  return withTrackKeys(
    row,
    row.trackKeys.includes(trackKey)
      ? row.trackKeys.filter((k) => k !== trackKey)
      : [...row.trackKeys, trackKey],
  );
}

/** 全トラック共通にする。個別の割り当ては消える（全部に出るため） */
export function setCommon(row: Row): Row {
  return { ...row, placement: "all", trackKeys: [] };
}

/** 未割り当て（ネタ出し）に戻す */
export function setUnassigned(row: Row): Row {
  return { ...row, placement: "unassigned", trackKeys: [] };
}

/** トラックを1本消したときの行の付け替え。
 * そのトラックにしか載っていなかった行は未割り当てに戻る */
export function removeTrackFromRows(rows: Row[], trackKey: string): Row[] {
  return rows.map((r) =>
    r.placement === "tracks" && r.trackKeys.includes(trackKey)
      ? withTrackKeys(
          r,
          r.trackKeys.filter((k) => k !== trackKey),
        )
      : r,
  );
}

/** そのトラックに割り当てられている行の数（削除前の確認に使う） */
export function countRowsOnTrack(rows: Row[], trackKey: string): number {
  return rows.filter(
    (r) => r.placement === "tracks" && r.trackKeys.includes(trackKey),
  ).length;
}

/** 時刻計算・重なり判定に渡す形。トラックは編集中のキーで通す */
export function toTimeItems(rows: Row[]): ScheduleTimeItem[] {
  return rows.map((r) => ({
    durationMin: r.durationMin,
    startsAt: r.startsAt,
    placement: r.placement,
    trackIds: r.trackKeys,
  }));
}

/** 保存の入力に変換する。トラックは配列の添字で参照する（新規は ID が無いため）。
 * version は**読み込んだ時点の版**をそのまま返す (#340)。この間に他の人が
 * 保存していればサーバー側で食い違いになり、上書きが止まる */
export function toSaveInput(
  rows: Row[],
  tracks: TrackRow[],
  version: number,
): SaveScheduleInput {
  const indexByKey = new Map(tracks.map((t, i) => [t.key, i]));
  return {
    version,
    tracks: tracks.map((t) => ({ id: t.id, name: t.name.trim() })),
    items: rows.map((r) => ({
      id: r.id,
      title: r.title.trim(),
      description: r.description,
      durationMin: r.durationMin,
      startsAt: r.startsAt,
      speakerUserId: r.speakerUserId,
      speakerName: r.speakerName,
      materialUrl: r.materialUrl.trim(),
      placement: r.placement,
      trackIndexes: r.trackKeys
        .map((k) => indexByKey.get(k))
        .filter((i): i is number => i !== undefined),
    })),
  };
}
