import { useState } from "react";
import {
  Card,
  CardContent,
  IconButton,
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
import { computeScheduleTimes } from "@eventer/shared";
import { useEventSchedule } from "../api/eventScheduleHooks.js";
import { formatTime } from "../lib/format.js";
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
  const { data: items } = useEventSchedule(eventId);
  const [editing, setEditing] = useState(false);

  if (!items) return null;
  // 空のタイムテーブルは staff にだけ編集導線として見せる
  if (items.length === 0 && !isStaff) return null;

  const times = computeScheduleTimes(items, eventStartsAt);
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
            items={items}
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
                      <Typography variant="body2">{it.title}</Typography>
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
      </CardContent>
    </Card>
  );
}
