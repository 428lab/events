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
import { useTranslation } from "react-i18next";
import AddIcon from "@mui/icons-material/Add";
import PlaylistAddIcon from "@mui/icons-material/PlaylistAdd";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
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
import { tDynamic } from "../i18n/index.js";
import { formatTime } from "../lib/format.js";
import type { MemberOption } from "./ScheduleItemRow.js";
import {
  ScheduleConflictAlert,
  ScheduleEditingAlert,
  ScheduleSaveFailedAlert,
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
 * 裏方 (#383) は表を分けない。**同じ表の同じ時間軸の並びの中**に、薄い背景と
 * 鍵の印を付けた行として混ざる（表のセッションの隣に準備が並ぶのが要件そのもの）。
 * 既定は折りたたみで、開くと元の位置にそのまま現れる。
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
  /** items/tracks を読んだ時点のタイムテーブルの版 (#340)。
   * 使うのは**開いた時点の値だけ**（items/tracks と同じ1枚の写しとして固める） */
  version: number;
  /** 最新を読み込み直す（この画面は作り直され、手元の編集は失われる） */
  onReload: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
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
  // 版も**行と同じ1枚の写しとして**開いた時点で固める (#340)。
  // 行は開いた時点のものを抱え続けるので、版だけが後から新しくなると
  // 「古い手元の内容 ＋ 新しい版」で保存が通ってしまい、衝突検知が効かない。
  // 開いている最中の取り直しは実際に起きる（同じページの資料ギャラリーで
  // 登壇者が資料URLを更新する・回線が復帰する、など）。
  // 最新に追いつく手段は読み込み直し＝作り直しの1つだけにする
  const [baseVersion] = useState(version);
  const [templateAnchor, setTemplateAnchor] = useState<null | HTMLElement>(null);
  // ドラッグ並び替え：ハンドルを押した行だけ draggable にする（入力操作と干渉させない）
  const [dragKey, setDragKey] = useState<string | null>(null);
  // 裏方の行を出すか (#383)。既定は畳んでおき、参加者向けの表が埋まらないようにする
  const [showStaffRows, setShowStaffRows] = useState(false);

  const memberOptions: MemberOption[] = (members ?? []).map((m) => ({
    id: m.user.id,
    label: m.user.globalName ?? m.user.username,
    avatarUrl: m.user.avatarUrl,
  }));

  // 時刻はトラックごとの連鎖。未割り当ては時刻を持たない (#338)。
  // 連鎖させる列は**表の列だけ** (#383)。運営用の列を混ぜると、全トラック共通の
  // コマが見る Math.max(...) にその列のカーソルが入り、プレビューの時刻だけが
  // 保存後の（＝参加者に見える）時刻とずれる
  const times = computeScheduleTimes(
    toTimeItems(rows),
    eventStartsAt,
    // 許可リストで書く（値が増えたときに新しい列が黙って混ざらないように）
    tracks
      .filter((track) => track.visibility === "public")
      .map((track) => track.key),
  );
  // 同一トラック内の重なりは保存を止めず、警告だけ出す (#338)。
  // トラックはまだ ID を持たないものがあるので、編集中のキーを ID として渡す
  const overlaps = findTrackOverlaps(
    rows.map((r, i) => ({ ...r, trackIds: r.trackKeys, start: times[i] ?? null })),
    times,
    tracks.map((track, i) => ({
      id: track.key,
      name: track.name,
      sortOrder: i,
      visibility: track.visibility,
    })),
  );

  const replaceRow = (key: string, next: Row) =>
    setRows((rs) => rs.map((r) => (r.key === key ? next : r)));

  /** いま画面に出ている行か (#383)。畳んだ裏方の行と入れ替えると、
   * 上下ボタンを押しても何も動かないように見える */
  const isShown = (r: Row) =>
    r.placement === "unassigned" || showStaffRows || r.visibility !== "staff";

  /** 同じセクション（未割り当て/配置済み）の中で1つ隣と入れ替える。
   * 保存の並び順は rows の配列順なので、全体の配列上で位置を交換する */
  const move = (key: string, delta: number) =>
    setRows((rs) => {
      const from = rs.findIndex((r) => r.key === key);
      if (from < 0) return rs;
      const sameSection = (r: Row) =>
        isShown(r) &&
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
    const template = SCHEDULE_TEMPLATES.find((x) => x.key === templateKey);
    if (!template) return;
    if (
      rows.length > 0 &&
      !window.confirm(t("schedule.templateConfirm"))
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
        t(
          used === 1
            ? "schedule.removeTrackConfirmOne"
            : "schedule.removeTrackConfirm",
          { n: used },
        ),
      )
    ) {
      return;
    }
    setRows((rs) => removeTrackFromRows(rs, key));
    setTracks((ts) => ts.filter((track) => track.key !== key));
  };

  const moveTrack = (key: string, delta: number) =>
    setTracks((ts) => {
      const from = ts.findIndex((track) => track.key === key);
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
    ) && tracks.every((track) => track.name.trim().length > 0);

  const submit = () =>
    save.mutate(toSaveInput(rows, tracks, baseVersion), { onSuccess: onClose });

  /** 最新を読み込み直す。手元の編集は失われるので、押す前に必ず確かめる */
  const reload = () => {
    if (!window.confirm(t("schedule.reloadConfirm"))) return;
    onReload();
  };

  const renderRow = (row: Row) => {
    const i = rows.indexOf(row);
    const section = rows.filter(
      (r) =>
        isShown(r) &&
        (r.placement === "unassigned") === (row.placement === "unassigned"),
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
        onChange={(next) => {
          // 畳んだまま「運営だけに見せる」を入れると、切り替えた行が目の前から
          // 消えてしまう。切り替えた本人には見えている必要があるので開く (#383)
          if (next.visibility === "staff" && row.visibility !== "staff") {
            setShowStaffRows(true);
          }
          replaceRow(row.key, next);
        }}
        onMove={(delta) => move(row.key, delta)}
        onDelete={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
        canMoveUp={at > 0}
        canMoveDown={at < section.length - 1}
      />
    );
  };

  const unassignedRows = rows.filter((r) => r.placement === "unassigned");
  const placedRows = rows.filter((r) => r.placement !== "unassigned");
  // 裏方は別の塊に寄せ集めず、**元の並びのまま**畳む／出す (#383)
  const staffRowCount = placedRows.filter(
    (r) => r.visibility === "staff",
  ).length;
  const shownRows = showStaffRows
    ? placedRows
    : placedRows.filter((r) => r.visibility !== "staff");

  return (
    <Stack spacing={1.5}>
      {otherEditor && <ScheduleEditingAlert editor={otherEditor} />}

      <ScheduleTrackManager
        tracks={tracks}
        onAdd={() =>
          setTracks((ts) => [
            ...ts,
            // 付けた人の言語で保存される仮の名前。あとから書き換えられる
            newTrackRow(t("schedule.defaultTrackName", { n: ts.length + 1 })),
          ])
        }
        onRename={(key, name) =>
          setTracks((ts) =>
            ts.map((track) => (track.key === key ? { ...track, name } : track)),
          )
        }
        onMove={moveTrack}
        onRemove={removeTrack}
        onSetStaffOnly={(key, staffOnly) =>
          setTracks((ts) =>
            ts.map((track) =>
              track.key === key
                ? { ...track, visibility: staffOnly ? "staff" : "public" }
                : track,
            ),
          )
        }
      />

      <Divider />

      <Box>
        <Typography variant="subtitle2">
          {t("schedule.unassignedSection")}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {t("schedule.unassignedSectionHint")}
        </Typography>
      </Box>
      <Stack spacing={1.5}>
        {unassignedRows.map(renderRow)}
        {unassignedRows.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            {t("schedule.unassignedEmpty")}
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
          {t("schedule.addIdea")}
        </Button>
      </Box>

      <Divider />

      <Typography variant="subtitle2">{t("schedule.placedSection")}</Typography>
      {/* 裏方 (#383) の開閉。0件のときは押しても何も起きないので出さない。
          開くと、寄せ集めではなく**同じ時間軸の並びの中**に現れる */}
      {staffRowCount > 0 && (
        <Box>
          <Button
            size="small"
            startIcon={<LockOutlinedIcon fontSize="small" />}
            onClick={() => setShowStaffRows((v) => !v)}
          >
            {showStaffRows
              ? t("schedule.hideStaffRows")
              : t("schedule.showStaffRows", { n: staffRowCount })}
          </Button>
        </Box>
      )}
      {overlaps.length > 0 && (
        <Alert severity="warning">
          <Typography variant="body2" fontWeight={600}>
            {t("schedule.overlapTitle")}
          </Typography>
          <Typography variant="body2">{t("schedule.overlapNote")}</Typography>
          <Box component="ul" sx={{ pl: 2.5, m: 0.5 }}>
            {overlaps.slice(0, 5).map((o, i) => (
              <li key={i}>
                <Typography variant="caption">
                  {t("schedule.overlapItem", {
                    // trackName が null なら「全トラック共通どうし」。
                    // 文言は辞書が持つ (#363)
                    track: o.trackName ?? t("schedule.allTracks"),
                    a: o.a.title || t("schedule.untitled"),
                    aStart:
                      o.a.start === null ? "--:--" : formatTime(o.a.start),
                    b: o.b.title || t("schedule.untitled"),
                    bStart:
                      o.b.start === null ? "--:--" : formatTime(o.b.start),
                  })}
                </Typography>
              </li>
            ))}
            {overlaps.length > 5 && (
              <li>
                <Typography variant="caption">
                  {/* 単複で綴りが変わらない言い方なので、キーは1つでよい */}
                  {t("schedule.overlapMore", { n: overlaps.length - 5 })}
                </Typography>
              </li>
            )}
          </Box>
        </Alert>
      )}
      <Stack spacing={1.5}>{shownRows.map(renderRow)}</Stack>

      {conflicted ? (
        <ScheduleConflictAlert onReload={reload} />
      ) : (
        save.isError && <ScheduleSaveFailedAlert />
      )}

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Button
          size="small"
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={() => setRows((rs) => [...rs, newRow()])}
        >
          {t("schedule.addRow")}
        </Button>
        <Button
          size="small"
          variant="outlined"
          startIcon={<PlaylistAddIcon />}
          onClick={(e) => setTemplateAnchor(e.currentTarget)}
        >
          {t("common.fromTemplate")}
        </Button>
        <Menu
          anchorEl={templateAnchor}
          open={Boolean(templateAnchor)}
          onClose={() => setTemplateAnchor(null)}
        >
          {/* テンプレートの中身（コマの題名）は保存されるデータなので
              @eventer/shared が持つ日本語のまま。ここで訳すのは選ぶときの名前だけ */}
          {SCHEDULE_TEMPLATES.map((template) => (
            <MenuItem
              key={template.key}
              onClick={() => applyTemplate(template.key)}
            >
              {tDynamic(`schedule.templateName_${template.key}`, template.name)}
            </MenuItem>
          ))}
        </Menu>
        <Box sx={{ flex: 1 }} />
        <Button size="small" onClick={onClose} disabled={save.isPending}>
          {t("common.cancel")}
        </Button>
        <Button
          size="small"
          variant="contained"
          onClick={submit}
          // 版が食い違ったあとは、同じ内容を送っても必ずまた弾かれる。
          // 押せるままにすると同じ失敗を繰り返させるので、読み込み直しへ誘導する
          disabled={!canSave || save.isPending || conflicted}
        >
          {t("common.save")}
        </Button>
      </Stack>
    </Stack>
  );
}
