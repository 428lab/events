import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Avatar,
  Card,
  CardContent,
  Checkbox,
  Chip,
  IconButton,
  List,
  ListItem,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  Snackbar,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { Link as RouterLink } from "react-router-dom";
import type { EventMemberWithUser, EventRole } from "@eventer/shared";
import { EVENT_ROLES } from "@eventer/shared";
import {
  useEventMembers,
  useMe,
  useSetAttendance,
  useSetEventMemberRole,
} from "../api/hooks.js";
import { errorMessage } from "../lib/errorMessage.js";
import { i18next } from "../i18n/index.js";
import { participationStatusLabel, roleLabel } from "../lib/format.js";
import { isMyMembership } from "../lib/eventMembership.js";

/** ロール変更が断られた理由を、その場で直せる形の文言にする (#281)。
 * 何が起きたか（なぜ変えられないか）と、次に何をすればよいかまで書く。
 * ここに挙げないコードは共通の辞書 (#352) がそのまま面倒を見る */
export function roleChangeErrorMessage(err: unknown): string {
  return errorMessage(err, {
    default: i18next.t("eventDetail.roleErrorDefault"),
    last_staff: i18next.t("eventDetail.roleErrorLastStaff"),
    event_ended: i18next.t("eventDetail.roleErrorEventEnded"),
    not_found: i18next.t("eventDetail.roleErrorNotFound"),
  });
}

/** 出席チェックが断られた理由 (#286)。UI では確定でない人のチェックを無効にして
 * いるが、一覧を開いたまま抽選が走るなどで通ってしまうことがあるので、その場合も
 * 無言で失敗させない */
export function attendanceErrorMessage(err: unknown): string {
  return errorMessage(err, {
    default: i18next.t("eventDetail.attendanceErrorDefault"),
    not_confirmed: i18next.t("eventDetail.attendanceErrorNotConfirmed"),
    not_found: i18next.t("eventDetail.attendanceErrorNotFound"),
  });
}

/** 参加者一覧のカード。人数の見出しと、出席チェックモードの注意書きを添える。
 * 一覧そのものは誰にでも見せ、操作（ロール変更・出席チェック）だけ staff に出す */
export function EventMemberList({
  eventId,
  isStaff,
  attendanceCheck,
}: {
  eventId: string;
  isStaff: boolean;
  attendanceCheck: boolean;
}) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const { data: members } = useEventMembers(eventId, true);
  if (!members) return null;

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          {t("eventDetail.participantsWithCount", { n: members.length })}
        </Typography>
        {attendanceCheck && (
          <Alert severity="info" sx={{ mb: 1, py: 0 }}>
            {t(
              isStaff
                ? "eventDetail.attendanceModeNoticeStaff"
                : "eventDetail.attendanceModeNotice",
            )}
          </Alert>
        )}
        <List dense>
          {members.map((m) => (
            <MemberRow
              key={m.id}
              eventId={eventId}
              member={m}
              isStaff={isStaff}
              attendanceCheck={attendanceCheck}
              isMe={isMyMembership(m, me)}
            />
          ))}
        </List>
      </CardContent>
    </Card>
  );
}

/** 参加者一覧の1行。staff にはロール変更メニューと出席チェックを出す */
export function MemberRow({
  eventId,
  member: m,
  isStaff,
  attendanceCheck,
  isMe,
}: {
  eventId: string;
  member: EventMemberWithUser;
  isStaff: boolean;
  attendanceCheck: boolean;
  isMe: boolean;
}) {
  const { t } = useTranslation();
  const setRole = useSetEventMemberRole(eventId);
  // 行ごとに持つ（ロール変更と同じ）。1つを全行で共有すると、続けて操作したとき
  // 後の行の結果が前の行のエラー表示を消してしまう (#286)
  const setAttendance = useSetAttendance(eventId);
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const [roleError, setRoleError] = useState("");
  const [attendError, setAttendError] = useState("");
  const showCheck = attendanceCheck && isStaff;
  const memberName = m.user.globalName ?? m.user.username;
  /** 出席にできるのは参加確定の人だけ (#286)。staff/judge/observer は
   * ロール変更時に確定になる (#277) ので、ここで弾かれるのは
   * 落選・抽選申込中・キャンセル待ちの人だけ。
   * 既に出席が付いている行は、確定でなくても解除できるようチェックを触れる状態にする */
  const isConfirmed = m.status === "confirmed";
  const canAttend = isConfirmed || m.attended;
  const status = participationStatusLabel(m.status);
  const attendTitle = isConfirmed
    ? t("eventDetail.attendCheck")
    : m.attended
      ? t("eventDetail.attendUncheckOnly", { status })
      : t("eventDetail.attendNotConfirmed", { status });

  /** 一般参加者に戻すのは参加の取消 (#281)。申込が無言で消えるのを防ぐため、
   * この遷移だけ確認を挟む。他のロールへの変更は破壊的ではないので挟まない */
  const confirmRoleChange = (r: EventRole): boolean =>
    r !== "participant" ||
    window.confirm(t("eventDetail.demoteConfirm", { name: memberName }));
  const attendChip =
    attendanceCheck && m.attended ? (
      <Chip
        size="small"
        color="success"
        label={t("eventDetail.attendedChip")}
        sx={{ height: 18, fontSize: 10 }}
      />
    ) : null;

  return (
    <ListItem
      key={m.id}
      disableGutters
      secondaryAction={
        <Stack direction="row" spacing={0.5} alignItems="center">
          {showCheck ? (
            /* 押せない理由はその場で読めるようにする。無効なチェックボックスだけ
               置くと「押しても何も起きない」に見えるため (#286) */
            <Tooltip
              title={attendTitle}
              enterTouchDelay={0}
              leaveTouchDelay={5000}
            >
              {/* 無効なチェックボックスはフォーカスを受け取らないので、包む span を
                  フォーカス可能にする。そうしないとキーボードだけでは理由を読めない */}
              <span
                tabIndex={canAttend ? undefined : 0}
                aria-label={canAttend ? undefined : attendTitle}
              >
                <Checkbox
                  edge="end"
                  size="small"
                  icon={<CheckCircleOutlineIcon />}
                  checkedIcon={<CheckCircleIcon />}
                  checked={m.attended}
                  disabled={setAttendance.isPending || !canAttend}
                  onChange={(e) =>
                    setAttendance.mutate(
                      { userId: m.user.id, attended: e.target.checked },
                      { onError: (err) => setAttendError(attendanceErrorMessage(err)) },
                    )
                  }
                  inputProps={{ "aria-label": attendTitle }}
                />
              </span>
            </Tooltip>
          ) : (
            attendChip
          )}
          {/* 断られた理由は画面に出す（一覧を開いたまま状態が変わった場合） */}
          <Snackbar
            open={Boolean(attendError)}
            autoHideDuration={8000}
            onClose={() => setAttendError("")}
            message={attendError}
          />
          {/* 自分自身のロールは誤操作防止のため変更不可 */}
          {isStaff && !isMe && (
            <>
              <IconButton
                size="small"
                onClick={(e) => setAnchor(e.currentTarget)}
                title={t("eventDetail.changeRole")}
              >
                <MoreVertIcon fontSize="small" />
              </IconButton>
              <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
                {EVENT_ROLES.map((r) => (
                  <MenuItem
                    key={r}
                    selected={m.role === r}
                    disabled={setRole.isPending}
                    onClick={() => {
                      setAnchor(null);
                      if (r === m.role || !confirmRoleChange(r)) return;
                      setRole.mutate(
                        { userId: m.user.id, role: r },
                        { onError: (e) => setRoleError(roleChangeErrorMessage(e)) },
                      );
                    }}
                  >
                    {roleLabel(r as EventRole)}
                    {m.role === r && (
                      <CheckIcon fontSize="small" sx={{ ml: 0.5 }} />
                    )}
                  </MenuItem>
                ))}
              </Menu>
              {/* 断られた理由は画面に出す。出さないと「押しても何も起きない」に見える */}
              <Snackbar
                open={Boolean(roleError)}
                autoHideDuration={8000}
                onClose={() => setRoleError("")}
                message={roleError}
              />
            </>
          )}
        </Stack>
      }
    >
      <ListItemButton
        component={RouterLink}
        to={`/users/${m.user.username}`}
        sx={{ borderRadius: 1 }}
      >
        <ListItemAvatar>
          <Avatar
            src={m.user.avatarUrl ?? undefined}
            alt={m.user.globalName ?? m.user.username}
          >
            {(m.user.globalName ?? m.user.username).charAt(0)}
          </Avatar>
        </ListItemAvatar>
        <ListItemText
          primary={m.user.globalName ?? m.user.username}
          secondary={roleLabel(m.role)}
        />
      </ListItemButton>
    </ListItem>
  );
}
