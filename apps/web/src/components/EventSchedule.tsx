import { useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Button,
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
import { alpha } from "@mui/material/styles";
import ScheduleIcon from "@mui/icons-material/Schedule";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import ViewWeekOutlinedIcon from "@mui/icons-material/ViewWeekOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import SlideshowOutlinedIcon from "@mui/icons-material/SlideshowOutlined";
import CancelIcon from "@mui/icons-material/Cancel";
import { computeScheduleTimes, publicTracks } from "@eventer/shared";
import type { ScheduleItem } from "@eventer/shared";
import { useMe } from "../api/hooks.js";
import {
  useEventSchedule,
  useScheduleEditingState,
  useSetScheduleLiveDeck,
} from "../api/eventScheduleHooks.js";
import { formatTime } from "../lib/format.js";
import { MaterialEditDialog } from "./MaterialEditDialog.js";
import { LiveDeckDialog } from "./LiveDeckDialog.js";
import { editorLabel } from "./ScheduleEditNotice.js";
import { ScheduleEditor } from "./ScheduleEditor.js";
import { UserLink } from "./UserLink.js";

/** イベントのタイムテーブル (#116)。閲覧はイベントが見える人全員、編集は staff。
 * 各行の時刻はイベント開始時刻から所要時間を積み上げて自動計算する。 */
export function EventSchedule({
  eventId,
  eventStartsAt,
  isStaff,
  showManagementActions = true,
}: {
  eventId: string;
  /** イベント開始時刻（epoch ms）。日程調整中（未定）は null */
  eventStartsAt: number | null;
  isStaff: boolean;
  showManagementActions?: boolean;
}) {
  const { t } = useTranslation();
  const canManage = isStaff && showManagementActions;
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
    canManage && !editing,
  );
  // 登壇者本人による資料URL編集ダイアログの対象コマ (#148)
  const [materialItem, setMaterialItem] = useState<ScheduleItem | null>(null);
  // 登壇者本人による配信スライドの紐付けダイアログの対象コマ (#571)
  const [liveDeckItem, setLiveDeckItem] = useState<ScheduleItem | null>(null);

  if (!data) return null;
  // Detail derives a public display subset; the shared query and editor retain all items.
  const items = showManagementActions ? data.items : data.items.filter(
    (item) => item.visibility !== "staff" && item.placement !== "unassigned",
  );
  const tracks = showManagementActions ? data.tracks : publicTracks(data.tracks);
  // 自分の編集中は出さない（編集画面を閉じた直後は期限切れまで残るため）
  const otherEditor =
    editState?.editor && editState.editor.userId !== me?.id
      ? editState.editor
      : null;
  // 空のタイムテーブルは staff にだけ編集導線として見せる
  if (items.length === 0 && !canManage) return null;

  // スタッフ用の列 (#383) は「並んでいる列」ではあるが、**時刻を連鎖させる列には
  // 入れない**（理由は @eventer/shared の publicTracks に書いてある）。
  // トラック別に見る導線の本数も同じ数え方でそろえる
  const shownTracks = publicTracks(tracks);
  const times = computeScheduleTimes(
    items,
    eventStartsAt,
    shownTracks.map((track) => track.id),
  );
  const trackName = new Map(tracks.map((track) => [track.id, track.name]));
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
            {t("schedule.timetable")}
          </Typography>
          <Stack direction="row" alignItems="center" spacing={0.5}>
            {/* 並行して走っているのが見える専用画面への導線 (#338)。
                トラックが2本以上ないと格子にする意味がないので出さない。
                数えるのは**公開トラックだけ** (#383)。スタッフ用の列を1本
                足しただけで staff にだけ導線が生えるのは分かりにくい */}
            {shownTracks.length >= 2 && !editing && (
              <Button
                component={RouterLink}
                to={`/events/${eventId}/timetable`}
                size="small"
                startIcon={<ViewWeekOutlinedIcon fontSize="small" />}
              >
                {t("schedule.viewByTrack")}
              </Button>
            )}
            {canManage && !editing && (
              <>
                {/* 編集を始める前に気づけるように、編集ボタンのすぐ隣に出す (#340) */}
                {otherEditor && (
                  <Chip
                    size="small"
                    variant="outlined"
                    color="info"
                    label={t("schedule.editingByShort", {
                      editor: editorLabel(otherEditor),
                    })}
                  />
                )}
                <IconButton
                  size="small"
                  onClick={() => setEditing(true)}
                  title={t("schedule.edit")}
                >
                  <EditOutlinedIcon fontSize="small" />
                </IconButton>
              </>
            )}
          </Stack>
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
            {t("schedule.empty")}
          </Typography>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 72, whiteSpace: "nowrap" }}>
                    {t("schedule.time")}
                  </TableCell>
                  <TableCell>{t("schedule.content")}</TableCell>
                  {hasSpeakers && (
                    <TableCell sx={{ width: "1%", whiteSpace: "nowrap" }}>
                      {t("schedule.speaker")}
                    </TableCell>
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((it, i) => (
                  <TableRow
                    key={it.id}
                    sx={{
                      "&:last-child td": { border: 0 },
                      // 裏方の行 (#383) は薄く敷いて、表のコマと見分けられるようにする
                      ...(it.visibility === "staff"
                        ? {
                            bgcolor: (theme) =>
                              alpha(theme.palette.text.primary, 0.04),
                          }
                        : {}),
                    }}
                  >
                    <TableCell sx={{ whiteSpace: "nowrap", verticalAlign: "top" }}>
                      <Typography variant="body2" fontWeight={600}>
                        {times[i] !== null ? formatTime(times[i]!) : "--:--"}
                      </Typography>
                      {it.durationMin > 0 && (
                        <Typography variant="caption" color="text.secondary">
                          {t("schedule.durationMin", { n: it.durationMin })}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ verticalAlign: "top" }}>
                      {/* トラックを使っているイベントだけ、どの枠かを添える。
                          全トラック共通の枠は全部に出るので何も出さない。
                          未割り当ては staff にしか届かないので、そうと分かる印を出す (#338) */}
                      {(it.visibility === "staff" ||
                        it.placement === "unassigned" ||
                        (tracks.length > 0 && it.placement === "tracks")) && (
                        <Stack
                          direction="row"
                          spacing={0.5}
                          sx={{ mb: 0.25, flexWrap: "wrap" }}
                          useFlexGap
                        >
                          {/* 裏方 (#383)。サーバーが staff にしか返さないので、
                              ここに来ている時点で見てよい人が見ている */}
                          {it.visibility === "staff" && (
                            <Chip
                              size="small"
                              variant="outlined"
                              icon={<LockOutlinedIcon sx={{ fontSize: 13 }} />}
                              label={t("schedule.staffOnlyChip")}
                              sx={{ height: 18, fontSize: "0.7rem" }}
                            />
                          )}
                          {it.placement === "unassigned" ? (
                            <Chip
                              size="small"
                              variant="outlined"
                              label={t("schedule.unassignedChip")}
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
                            aria-label={t("schedule.materialOpen")}
                            title={t("schedule.material")}
                          >
                            <DescriptionOutlinedIcon sx={{ fontSize: 18 }} />
                          </MuiLink>
                        )}
                        {/* リンクされた登壇者本人は自分のコマの資料URLを編集できる
                            （staff は上の編集ボタンから全体を編集する） (#148) */}
                        {!canManage && me && it.speaker?.id === me.id && (
                          <IconButton
                            size="small"
                            onClick={() => setMaterialItem(it)}
                            title={t("schedule.materialEdit")}
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
                      <LiveDeckRowControl
                        eventId={eventId}
                        item={it}
                        isSpeakerSelf={Boolean(me && it.speaker?.id === me.id)}
                        isStaff={isStaff}
                        onOpen={() => setLiveDeckItem(it)}
                      />
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

        {liveDeckItem && (
          <LiveDeckDialog
            eventId={eventId}
            item={liveDeckItem}
            onClose={() => setLiveDeckItem(null)}
          />
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

/** タイムテーブル行の「この発表で使うスライド」(#571)。
 *
 * - 担当者本人には、未登録なら選ぶボタン、登録済みならチップ（押すと選び直し・外す）
 * - staff には紐付け済みのチップだけ。付けることはできず、外すことだけできる
 *   （紐付けは本人の同意なので、staff が代わりに付けない）
 * - 参加者には何も出さない（サーバーもこの相手には紐付けを返さない）
 *
 * 対象は参加者に見せるコマだけ。資料URLの自己編集 (#148) と同じ範囲 */
function LiveDeckRowControl({
  eventId,
  item,
  isSpeakerSelf,
  isStaff,
  onOpen,
}: {
  eventId: string;
  item: ScheduleItem;
  isSpeakerSelf: boolean;
  isStaff: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const unlink = useSetScheduleLiveDeck(eventId, item.id);
  if (item.visibility !== "public" || item.placement === "unassigned") return null;
  if (!isSpeakerSelf && !isStaff) return null;
  const deck = item.liveDeck;
  if (!deck) {
    if (!isSpeakerSelf) return null;
    return (
      <Button
        size="small"
        variant="outlined"
        startIcon={<SlideshowOutlinedIcon />}
        onClick={onOpen}
        sx={{ mt: 0.5 }}
      >
        {t("schedule.liveDeckChoose")}
      </Button>
    );
  }
  const label = t("schedule.liveDeckChip", { title: deck.title || t("studio.untitledDeck") });
  return (
    <Chip
      size="small"
      color="primary"
      variant="outlined"
      icon={<SlideshowOutlinedIcon />}
      label={label}
      title={label}
      onClick={isSpeakerSelf ? onOpen : undefined}
      onDelete={
        unlink.isPending
          ? undefined
          : () => {
              if (window.confirm(t("schedule.liveDeckUnlinkConfirm", { title: item.title }))) unlink.mutate(null);
            }
      }
      deleteIcon={<CancelIcon titleAccess={t("schedule.liveDeckUnlink")} />}
      sx={{ mt: 0.5, maxWidth: "100%" }}
    />
  );
}
