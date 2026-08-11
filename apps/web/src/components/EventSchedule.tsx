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
import { useEventSchedule } from "../api/eventScheduleHooks.js";
import { formatTime } from "../lib/format.js";
import { MaterialEditDialog } from "./MaterialEditDialog.js";
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
  const { data } = useEventSchedule(eventId);
  const { data: me } = useMe();
  const [editing, setEditing] = useState(false);
  // 登壇者本人による資料URL編集ダイアログの対象コマ (#148)
  const [materialItem, setMaterialItem] = useState<ScheduleItem | null>(null);

  if (!data) return null;
  const tracks = data.tracks;
  // 未割り当て（ネタ出し中 #338）は参加者にも staff の閲覧表示にも出さない。
  // 編集画面（下の ScheduleEditor）には全件そのまま渡す
  const items = data.items.filter((it) => it.placement !== "unassigned");
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
            <IconButton
              size="small"
              onClick={() => setEditing(true)}
              title="タイムテーブルを編集"
            >
              <EditOutlinedIcon fontSize="small" />
            </IconButton>
          )}
        </Stack>

        {editing ? (
          <ScheduleEditor
            eventId={eventId}
            eventStartsAt={eventStartsAt}
            items={data.items}
            tracks={tracks}
            onClose={() => setEditing(false)}
          />
        ) : items.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {data.items.length === 0
              ? "まだタイムテーブルはありません。右上の編集ボタンから作成できます。"
              : "配置済みのセッションはまだありません。右上の編集ボタンから配置できます。"}
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
                          全トラック共通の枠は全部に出るので何も出さない (#338) */}
                      {tracks.length > 0 && it.placement === "tracks" && (
                        <Stack
                          direction="row"
                          spacing={0.5}
                          sx={{ mb: 0.25, flexWrap: "wrap" }}
                          useFlexGap
                        >
                          {it.trackIds.map((tid) => (
                            <Chip
                              key={tid}
                              size="small"
                              variant="outlined"
                              label={trackName.get(tid) ?? ""}
                              sx={{ height: 18, fontSize: "0.7rem" }}
                            />
                          ))}
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
