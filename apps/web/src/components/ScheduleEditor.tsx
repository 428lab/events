import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Divider,
  Menu,
  MenuItem,
  Stack,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import PlaylistAddIcon from "@mui/icons-material/PlaylistAdd";
import type { EventTrack, ScheduleItem } from "@eventer/shared";
import {
  SCHEDULE_TEMPLATES,
  computeScheduleTimes,
  findTrackOverlaps,
} from "@eventer/shared";
import { useEventMembers, useMe } from "../api/hooks.js";
import {
  useHoldScheduleEditing,
  useSaveEventSchedule,
} from "../api/eventScheduleHooks.js";
import { ApiError } from "../api/client.js";
import { formatTime } from "../lib/format.js";
import type { MemberOption } from "./ScheduleItemRow.js";
import {
  ScheduleConflictAlert,
  ScheduleEditingAlert,
} from "./ScheduleEditNotice.js";
import { ScheduleItemRow } from "./ScheduleItemRow.js";
import { ScheduleTrackManager } from "./ScheduleTrackManager.js";
import type { Row, TrackRow } from "./scheduleEditorModel.js";
import {
  countRowsOnTrack,
  newRow,
  newTrackRow,
  removeTrackFromRows,
  rowFromItem,
  setUnassigned,
  toSaveInput,
  toTimeItems,
  trackRowFromTrack,
} from "./scheduleEditorModel.js";

/** タイムテーブルの編集（staff 用）。行の追加/削除・ドラッグ/ボタンでの並び替え・
 * テンプレートからの作成に対応。時刻プレビューは表示と同じロジックで自動計算する。
 *
 * トラック (#338) は「未割り当て（ネタ出し）」と「配置済み」の2セクションで扱う。
 * トラックの割り当ては**チップとスイッチのタップだけで完結**する。
 *
 * 同時編集 (#340) は2段構え。開いている間は「自分が編集中」と言い続けて
 * 他の人に見せ（助言）、保存では読み込んだ時点の版を送り返して食い違いを弾く
 * （こちらが実際の防衛）。 */
export function ScheduleEditor({
  eventId,
  eventStartsAt,
  items,
  tracks: initialTracks,
  version,
  onReload,
  onClose,
}: {
  eventId: string;
  eventStartsAt: number | null;
  items: ScheduleItem[];
  tracks: EventTrack[];
  /** items/tracks を読んだ時点のタイムテーブルの版 (#340) */
  version: number;
  /** 最新を読み込み直す（この画面は作り直され、手元の編集は失われる） */
  onReload: () => void;
  onClose: () => void;
}) {
  const { data: members } = useEventMembers(eventId, true);
  const { data: me } = useMe();
  const save = useSaveEventSchedule(eventId);
  // 開いている間だけ「自分が編集中」と宣言し続ける。返るのは反映後の状態なので、
  // 先に他の人が編集していればその人が入っている（奪わない #340）
  const { data: editing } = useHoldScheduleEditing(eventId);
  const otherEditor =
    editing?.editor && editing.editor.userId !== me?.id
      ? editing.editor
      : null;
  // 版の食い違いだけは別の案内にする（通信失敗などと同じ扱いにすると、
  // 「もう一度保存」を押させてしまい、押しても直らない）
  const conflicted =
    save.error instanceof ApiError && save.error.status === 409;
  const [tracks, setTracks] = useState<TrackRow[]>(() =>
    initialTracks.map(trackRowFromTrack),
  );
  // 行の割り当て先は tracks と同じキーで持つ（トラックを作り直すとキーがずれる）
  const [rows, setRows] = useState<Row[]>(() =>
    items.map((it) => rowFromItem(it, tracks)),
  );
  const [templateAnchor, setTemplateAnchor] = useState<null | HTMLElement>(null);
  // ドラッグ並び替え：ハンドルを押した行だけ draggable にする（入力操作と干渉させない）
  const [dragKey, setDragKey] = useState<string | null>(null);

  const memberOptions: MemberOption[] = (members ?? []).map((m) => ({
    id: m.user.id,
    label: m.user.globalName ?? m.user.username,
    avatarUrl: m.user.avatarUrl,
  }));

  // 時刻はトラックごとの連鎖。未割り当ては時刻を持たない (#338)
  const times = computeScheduleTimes(
    toTimeItems(rows),
    eventStartsAt,
    tracks.map((t) => t.key),
  );
  // 同一トラック内の重なりは保存を止めず、警告だけ出す (#338)。
  // トラックはまだ ID を持たないものがあるので、編集中のキーを ID として渡す
  const overlaps = findTrackOverlaps(
    rows.map((r, i) => ({ ...r, trackIds: r.trackKeys, start: times[i] ?? null })),
    times,
    tracks.map((t, i) => ({ id: t.key, name: t.name, sortOrder: i })),
  );

  const replaceRow = (key: string, next: Row) =>
    setRows((rs) => rs.map((r) => (r.key === key ? next : r)));

  /** 同じセクション（未割り当て/配置済み）の中で1つ隣と入れ替える。
   * 保存の並び順は rows の配列順なので、全体の配列上で位置を交換する */
  const move = (key: string, delta: number) =>
    setRows((rs) => {
      const from = rs.findIndex((r) => r.key === key);
      if (from < 0) return rs;
      const sameSection = (r: Row) =>
        (r.placement === "unassigned") === (rs[from]!.placement === "unassigned");
      let to = from + delta;
      while (to >= 0 && to < rs.length && !sameSection(rs[to]!)) to += delta;
      if (to < 0 || to >= rs.length) return rs;
      const next = [...rs];
      [next[from], next[to]] = [next[to]!, next[from]!];
      return next;
    });

  /** ドラッグ中の行を、いま重なっている行の位置へ差し込む（同じセクション内のみ） */
  const onDragEnterRow = (key: string) => {
    if (dragKey === null || dragKey === key) return;
    setRows((rs) => {
      const from = rs.findIndex((r) => r.key === dragKey);
      const to = rs.findIndex((r) => r.key === key);
      if (from < 0 || to < 0) return rs;
      if ((rs[from]!.placement === "unassigned") !== (rs[to]!.placement === "unassigned")) {
        return rs;
      }
      const next = [...rs];
      const [row] = next.splice(from, 1);
      next.splice(to, 0, row!);
      return next;
    });
  };

  // ハンドル外でマウスを離した場合もドラッグ状態を解除する
  useEffect(() => {
    if (dragKey === null) return;
    const clear = () => setDragKey(null);
    document.addEventListener("mouseup", clear);
    document.addEventListener("touchend", clear);
    return () => {
      document.removeEventListener("mouseup", clear);
      document.removeEventListener("touchend", clear);
    };
  }, [dragKey]);

  const applyTemplate = (templateKey: string) => {
    setTemplateAnchor(null);
    const template = SCHEDULE_TEMPLATES.find((t) => t.key === templateKey);
    if (!template) return;
    if (
      rows.length > 0 &&
      !window.confirm("現在の内容をテンプレートで置き換えますか？")
    ) {
      return;
    }
    setRows(template.items.map((it) => newRow(it)));
  };

  const removeTrack = (key: string) => {
    const used = countRowsOnTrack(rows, key);
    if (
      used > 0 &&
      !window.confirm(
        `このトラックにだけ載っている${used}件のセッションは未割り当てに戻ります。削除しますか？`,
      )
    ) {
      return;
    }
    setRows((rs) => removeTrackFromRows(rs, key));
    setTracks((ts) => ts.filter((t) => t.key !== key));
  };

  const moveTrack = (key: string, delta: number) =>
    setTracks((ts) => {
      const from = ts.findIndex((t) => t.key === key);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= ts.length) return ts;
      const next = [...ts];
      [next[from], next[to]] = [next[to]!, next[from]!];
      return next;
    });

  const canSave =
    rows.every(
      (r) =>
        r.title.trim().length > 0 &&
        (r.materialUrl.trim() === "" ||
          /^https?:\/\//.test(r.materialUrl.trim())),
    ) && tracks.every((t) => t.name.trim().length > 0);

  const submit = () =>
    save.mutate(toSaveInput(rows, tracks, version), { onSuccess: onClose });

  /** 最新を読み込み直す。手元の編集は失われるので、押す前に必ず確かめる */
  const reload = () => {
    if (
      !window.confirm(
        "最新のタイムテーブルを読み込み直します。この画面の編集内容は失われます。よろしいですか？",
      )
    ) {
      return;
    }
    onReload();
  };

  const renderRow = (row: Row) => {
    const i = rows.indexOf(row);
    const section = rows.filter(
      (r) => (r.placement === "unassigned") === (row.placement === "unassigned"),
    );
    const at = section.indexOf(row);
    return (
      <ScheduleItemRow
        key={row.key}
        row={row}
        time={times[i] ?? null}
        memberOptions={memberOptions}
        tracks={tracks}
        dragging={dragKey === row.key}
        onDragHandleDown={() => setDragKey(row.key)}
        onDragStart={(e) => e.dataTransfer.setData("text/plain", row.key)}
        onDragEnter={() => onDragEnterRow(row.key)}
        onDragEnd={() => setDragKey(null)}
        onChange={(next) => replaceRow(row.key, next)}
        onMove={(delta) => move(row.key, delta)}
        onDelete={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
        canMoveUp={at > 0}
        canMoveDown={at < section.length - 1}
      />
    );
  };

  const unassignedRows = rows.filter((r) => r.placement === "unassigned");
  const placedRows = rows.filter((r) => r.placement !== "unassigned");

  return (
    <Stack spacing={1.5}>
      {otherEditor && <ScheduleEditingAlert editor={otherEditor} />}

      <ScheduleTrackManager
        tracks={tracks}
        onAdd={() =>
          setTracks((ts) => [...ts, newTrackRow(`トラック${ts.length + 1}`)])
        }
        onRename={(key, name) =>
          setTracks((ts) => ts.map((t) => (t.key === key ? { ...t, name } : t)))
        }
        onMove={moveTrack}
        onRemove={removeTrack}
      />

      <Divider />

      <Box>
        <Typography variant="subtitle2">未割り当て（ネタ出し）</Typography>
        <Typography variant="caption" color="text.secondary">
          時刻はまだ決まりません。参加者には表示されません。「配置する」で下の配置済みへ移ります。
        </Typography>
      </Box>
      <Stack spacing={1.5}>
        {unassignedRows.map(renderRow)}
        {unassignedRows.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            ネタ出し中のセッションはありません。
          </Typography>
        )}
      </Stack>
      <Box>
        <Button
          size="small"
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={() =>
            setRows((rs) => [...rs, setUnassigned(newRow())])
          }
        >
          ネタを追加
        </Button>
      </Box>

      <Divider />

      <Typography variant="subtitle2">配置済み</Typography>
      {overlaps.length > 0 && (
        <Alert severity="warning">
          <Typography variant="body2" fontWeight={600}>
            同じトラック内で時刻が重なっています。
          </Typography>
          <Typography variant="body2">
            このままでも保存できますが、タイムテーブルの枠が重なって読みにくくなります。
          </Typography>
          <Box component="ul" sx={{ pl: 2.5, m: 0.5 }}>
            {overlaps.slice(0, 5).map((o, i) => (
              <li key={i}>
                <Typography variant="caption">
                  {o.trackName}: 「{o.a.title || "(無題)"}」(
                  {o.a.start === null ? "--:--" : formatTime(o.a.start)}〜) と「
                  {o.b.title || "(無題)"}」(
                  {o.b.start === null ? "--:--" : formatTime(o.b.start)}〜)
                  が重なっています
                </Typography>
              </li>
            ))}
            {overlaps.length > 5 && (
              <li>
                <Typography variant="caption">
                  ほか{overlaps.length - 5}件
                </Typography>
              </li>
            )}
          </Box>
        </Alert>
      )}
      <Stack spacing={1.5}>{placedRows.map(renderRow)}</Stack>

      {conflicted ? (
        <ScheduleConflictAlert onReload={reload} />
      ) : (
        save.isError && (
          <Alert severity="error">タイムテーブルの保存に失敗しました。</Alert>
        )
      )}

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Button
          size="small"
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={() => setRows((rs) => [...rs, newRow()])}
        >
          行を追加
        </Button>
        <Button
          size="small"
          variant="outlined"
          startIcon={<PlaylistAddIcon />}
          onClick={(e) => setTemplateAnchor(e.currentTarget)}
        >
          テンプレから作成
        </Button>
        <Menu
          anchorEl={templateAnchor}
          open={Boolean(templateAnchor)}
          onClose={() => setTemplateAnchor(null)}
        >
          {SCHEDULE_TEMPLATES.map((t) => (
            <MenuItem key={t.key} onClick={() => applyTemplate(t.key)}>
              {t.name}
            </MenuItem>
          ))}
        </Menu>
        <Box sx={{ flex: 1 }} />
        <Button size="small" onClick={onClose} disabled={save.isPending}>
          キャンセル
        </Button>
        <Button
          size="small"
          variant="contained"
          onClick={submit}
          // 版が食い違ったあとは、同じ内容を送っても必ずまた弾かれる。
          // 押せるままにすると同じ失敗を繰り返させるので、読み込み直しへ誘導する
          disabled={!canSave || save.isPending || conflicted}
        >
          保存
        </Button>
      </Stack>
    </Stack>
  );
}
