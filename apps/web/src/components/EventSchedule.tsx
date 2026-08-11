import { useState } from "react";
import {
  Card,
  CardContent,
  Chip,
  IconButton,
  Link as MuiLink,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import ScheduleIcon from "@mui/icons-material/Schedule";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import { computeScheduleTimes } from "@eventer/shared";
import type { ScheduleItem } from "@eventer/shared";
import { useMe } from "../api/hooks.js";
import {
  useEventSchedule,
  useScheduleEditingState,
} from "../api/eventScheduleHooks.js";
import { formatTime } from "../lib/format.js";
import { MaterialEditDialog } from "./MaterialEditDialog.js";
import { editorLabel } from "./ScheduleEditNotice.js";
import { ScheduleEditor } from "./ScheduleEditor.js";
import { UserLink } from "./UserLink.js";

/** イベントのタイムテーブル (#116)。閲覧はイベントが見える人全員、編集は staff。
 * 各行の時刻はイベント開始時刻から所要時間を積み上げて自動計算する。 */
export function EventSchedule({
  eventId,
  eventStartsAt,
  isStaff,
}: {
  eventId: string;
  /** イベント開始時刻（epoch ms）。日程調整中（未定）は null */
  eventStartsAt: number | null;
  isStaff: boolean;
}) {
  const { data, refetch } = useEventSchedule(eventId);
  const { data: me } = useMe();
  const [editing, setEditing] = useState(false);
  // 編集画面を作り直すためのキー (#340)。版が食い違って保存が止まったとき、
  // 最新を取り直して編集画面を作り直す（手元の編集は失われると案内済み）
  const [editorSeed, setEditorSeed] = useState(0);
  // 誰かが編集中か (#340)。編集できる人にしか返らないので staff のときだけ。
  // 編集画面を開いている間は、そちら（心拍つき）が同じ状態を取りに行くので止める
  const { data: editState } = useScheduleEditingState(
    eventId,
    isStaff && !editing,
  );
  // 登壇者本人による資料URL編集ダイアログの対象コマ (#148)
  const [materialItem, setMaterialItem] = useState<ScheduleItem | null>(null);

  if (!data) return null;
  // 未割り当て（ネタ出し中 #338）はサーバーが staff にしか返さない。
  // ここで落とすと同じ判断が2か所になるので、来たものはそのまま扱う
  const { items, tracks } = data;
  // 自分の編集中は出さない（編集画面を閉じた直後は期限切れまで残るため）
  const otherEditor =
    editState?.editor && editState.editor.userId !== me?.id
      ? editState.editor
      : null;
  // 空のタイムテーブルは staff にだけ編集導線として見せる
  if (items.length === 0 && !isStaff) return null;

  const times = computeScheduleTimes(
    items,
    eventStartsAt,
    tracks.map((t) => t.id),
  );
  const trackName = new Map(tracks.map((t) => [t.id, t.name]));
  // 担当が全行空なら列ごと非表示（モバイルで内容欄を広く使う）
  const hasSpeakers = items.some((it) => it.speaker || it.speakerName);

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ mb: 1 }}
        >
          <Typography
            variant="h6"
            sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
          >
            <ScheduleIcon fontSize="small" />
            タイムテーブル
          </Typography>
          {isStaff && !editing && (
            <Stack direction="row" alignItems="center" spacing={0.5}>
              {/* 編集を始める前に気づけるように、編集ボタンのすぐ隣に出す (#340) */}
              {otherEditor && (
                <Chip
                  size="small"
                  variant="outlined"
                  color="info"
                  label={`${editorLabel(otherEditor)}が編集中`}
                />
              )}
              <IconButton
                size="small"
                onClick={() => setEditing(true)}
                title="タイムテーブルを編集"
              >
                <EditOutlinedIcon fontSize="small" />
              </IconButton>
            </Stack>
          )}
        </Stack>

        {editing ? (
          <ScheduleEditor
            // 読み込み直しは作り直しで行う（手元の編集を残すと、どこが最新で
            // どこが手元の変更か分からなくなる #340）
            key={editorSeed}
            eventId={eventId}
            eventStartsAt={eventStartsAt}
            items={items}
            tracks={tracks}
            version={data.version}
            onReload={async () => {
              await refetch();
              setEditorSeed((n) => n + 1);
            }}
            onClose={() => setEditing(false)}
          />
        ) : items.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            まだタイムテーブルはありません。右上の編集ボタンから作成できます。
          </Typography>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 72, whiteSpace: "nowrap" }}>
                    時刻
                  </TableCell>
                  <TableCell>内容</TableCell>
                  {hasSpeakers && (
                    <TableCell sx={{ width: "1%", whiteSpace: "nowrap" }}>
                      担当
                    </TableCell>
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((it, i) => (
                  <TableRow key={it.id} sx={{ "&:last-child td": { border: 0 } }}>
                    <TableCell sx={{ whiteSpace: "nowrap", verticalAlign: "top" }}>
                      <Typography variant="body2" fontWeight={600}>
                        {times[i] !== null ? formatTime(times[i]!) : "--:--"}
                      </Typography>
                      {it.durationMin > 0 && (
                        <Typography variant="caption" color="text.secondary">
                          {it.durationMin}分
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ verticalAlign: "top" }}>
                      {/* トラックを使っているイベントだけ、どの枠かを添える。
                          全トラック共通の枠は全部に出るので何も出さない。
                          未割り当ては staff にしか届かないので、そうと分かる印を出す (#338) */}
                      {(it.placement === "unassigned" ||
                        (tracks.length > 0 && it.placement === "tracks")) && (
                        <Stack
                          direction="row"
                          spacing={0.5}
                          sx={{ mb: 0.25, flexWrap: "wrap" }}
                          useFlexGap
                        >
                          {it.placement === "unassigned" ? (
                            <Chip
                              size="small"
                              variant="outlined"
                              label="未割り当て（参加者には出ません）"
                              sx={{ height: 18, fontSize: "0.7rem" }}
                            />
                          ) : (
                            it.trackIds.map((tid) => (
                              <Chip
                                key={tid}
                                size="small"
                                variant="outlined"
                                label={trackName.get(tid) ?? ""}
                                sx={{ height: 18, fontSize: "0.7rem" }}
                              />
                            ))
                          )}
                        </Stack>
                      )}
                      <Typography variant="body2">
                        {it.title}
                        {it.materialUrl && (
                          <MuiLink
                            href={it.materialUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            sx={{
                              ml: 0.75,
                              verticalAlign: "middle",
                              display: "inline-flex",
                            }}
                            aria-label="登壇資料を開く"
                            title="登壇資料"
                          >
                            <DescriptionOutlinedIcon sx={{ fontSize: 18 }} />
                          </MuiLink>
                        )}
                        {/* リンクされた登壇者本人は自分のコマの資料URLを編集できる
                            （staff は上の編集ボタンから全体を編集する） (#148) */}
                        {!isStaff && me && it.speaker?.id === me.id && (
                          <IconButton
                            size="small"
                            onClick={() => setMaterialItem(it)}
                            title="資料URLを編集"
                            sx={{ ml: 0.25, p: 0.25, verticalAlign: "middle" }}
                          >
                            <EditOutlinedIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        )}
                      </Typography>
                      {it.description && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: "block", whiteSpace: "pre-wrap" }}
                        >
                          {it.description}
                        </Typography>
                      )}
                    </TableCell>
                    {hasSpeakers && (
                      <TableCell sx={{ verticalAlign: "top", width: "1%" }}>
                        {it.speaker ? (
                          <UserLink
                            username={it.speaker.username}
                            name={it.speaker.globalName ?? it.speaker.username}
                            avatarUrl={it.speaker.avatarUrl}
                            withAvatar
                            avatarSize={22}
                            sx={{ fontSize: "0.875rem" }}
                          />
                        ) : it.speakerName ? (
                          <Typography variant="body2">{it.speakerName}</Typography>
                        ) : null}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {materialItem && (
          <MaterialEditDialog
            eventId={eventId}
            item={materialItem}
            onClose={() => setMaterialItem(null)}
          />
        )}
      </CardContent>
    </Card>
  );
}
