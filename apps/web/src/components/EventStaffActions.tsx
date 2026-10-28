import { useState, type ReactNode } from "react";
import { Alert, Badge, Box, Button, Divider, ListItemIcon, ListItemText, ListSubheader, Menu, MenuItem, Stack, Typography, type SxProps, type Theme } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import type { Event, EventRole } from "@eventer/shared";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import DashboardIcon from "@mui/icons-material/Dashboard";
import EditIcon from "@mui/icons-material/Edit";
import EmojiEventsOutlinedIcon from "@mui/icons-material/EmojiEventsOutlined";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import EventBusyIcon from "@mui/icons-material/EventBusy";
import GroupAddIcon from "@mui/icons-material/GroupAdd";
import LiveTvIcon from "@mui/icons-material/LiveTv";
import PublishIcon from "@mui/icons-material/Publish";
import QrCodeScannerIcon from "@mui/icons-material/QrCodeScanner";
import { useCancelScheduledPublish, usePublishEvent } from "../api/hooks.js";
import { errorMessage } from "../lib/errorMessage.js";
import { useEventInquiryUnreadCount } from "../api/inquiryHooks.js";
import { getEventPhase } from "../lib/eventPhase.js";
import type { EventTiming } from "../lib/useEventTiming.js";
import { MANAGEMENT_LINK_GROUPS, managementLinks } from "./EventManagementLinks.js";

/** `/events/:id#contest-operations` のアンカー先。詳細ページの入口に付ける */
const ANCHOR_ID = "contest-operations";

/**
 * 詳細ページ見出し直下の運営の入口 (#613)。
 *
 * スタッフには「時期で変わる主ボタン」+「編集」+「運営 ▾」メニューを出す。
 * 並びはオーナー決定（PR #620 2026-10-14）: 時期で変わるボタンは役割チップ・シェアと同じ行の
 * シェアのすぐ右、「編集」「運営 ▾」はどの時期でも同じ位置（PC は行の右端、スマホは次の行）。
 * そのため2つのかたまりを Fragment で返し、外側のチップ行（flex-wrap）にそのまま並べてもらう。
 * 予約公開 (#624) がある下書きは「公開する」の代わりに「今すぐ公開」を出し、メニューには「今すぐ公開」「予約を取り消す」を出す。
 * メニューの項目と表示条件は運営ページのボタン列 (EventManagementLinks) と共有する。
 * 日程調整・招待の権限だけを持つ人には、持っている権限ぶんのボタンだけを出す。
 */
export function EventStaffActions({ eventId, event, myRole, canManageSchedule, canManageAccess, chatAvailable, timing, sx }: {
  eventId: string;
  event: Event;
  myRole: EventRole | null;
  canManageSchedule: boolean;
  canManageAccess: boolean;
  chatAvailable: boolean;
  timing: Pick<EventTiming, "ended">;
  /** 外側の並び（詳細ページのチップ行）での置き方 */
  sx?: SxProps<Theme>;
}) {
  const isStaff = myRole === "staff";
  // 主催者あての問い合わせの未読数 (D-EVENT-CONTACT)。スタッフのときだけ取りに行く
  const { data: inquiryUnread = 0 } = useEventInquiryUnreadCount(eventId, isStaff);
  const canInvite = event.visibility === "private" && canManageAccess;
  // 時計は useEventTiming が 1 分ごとに再描画させるので、ここでは描画時の時刻を読むだけ
  const phase = getEventPhase(event, timing, Date.now());
  if (isStaff) return <StaffActions eventId={eventId} event={event} chatAvailable={chatAvailable} inquiryUnread={inquiryUnread} phase={phase} sx={sx} />;
  if (!canManageSchedule && !canInvite) return null;
  return <LimitedActions eventId={eventId} canManageSchedule={canManageSchedule} canInvite={canInvite} scheduling={phase === "scheduling"} sx={sx} />;
}

function LimitedActions({ eventId, canManageSchedule, canInvite, scheduling, sx }: {
  eventId: string; canManageSchedule: boolean; canInvite: boolean; scheduling: boolean; sx?: SxProps<Theme>;
}) {
  const { t } = useTranslation();
  const manage = `/events/${eventId}/manage`;
  const buttons: { key: string; to: string; label: string; icon: ReactNode; contained: boolean }[] = [];
  if (canManageSchedule) {
    buttons.push({ key: "date-poll", to: `${manage}#date-poll`, label: t("eventManagement.datePoll"), icon: <EventAvailableIcon />, contained: scheduling });
  }
  if (canInvite) {
    buttons.push({ key: "invites", to: `${manage}#invites`, label: t("eventManagement.invites"), icon: <GroupAddIcon />, contained: false });
  }
  return <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={sx}>
    {buttons.map((button, i) => <Button key={button.key} id={i === 0 ? ANCHOR_ID : undefined} component={RouterLink} to={button.to}
      variant={button.contained ? "contained" : "outlined"} startIcon={button.icon}>
      {button.label}
    </Button>)}
  </Stack>;
}

function StaffActions({ eventId, event, chatAvailable, inquiryUnread, phase, sx }: {
  eventId: string; event: Event; chatAvailable: boolean; inquiryUnread: number; phase: ReturnType<typeof getEventPhase>; sx?: SxProps<Theme>;
}) {
  const { t } = useTranslation();
  const publish = usePublishEvent();
  const cancelSchedule = useCancelScheduledPublish();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const base = `/events/${eventId}`;
  const close = () => setAnchor(null);
  const busy = publish.isPending || cancelSchedule.isPending;
  const onPublish = () => publish.mutate(event.id);
  const onCancelSchedule = () => cancelSchedule.mutate({ id: event.id, expectedAccessRevision: event.accessRevision });
  // 予約公開 (D-EVENT-SCHEDULED-PUBLISH)。予約があるときは「公開する」を出さず、運営ページと同じ2択にする
  const scheduled = phase === "draft" && Boolean(event.publishAt);

  let primary: ReactNode = null;
  if (phase === "draft") {
    // 予約があるときは「今すぐ公開」だけをシェアの右に置く。「予約を取り消す」は運営ページと同じく
    // 詳細ページ上部の公開予定の案内（ScheduledPublishNotice）とメニューに置く（行に収めるため）
    primary = scheduled
      ? <Button variant="contained" startIcon={<PublishIcon />} disabled={busy} onClick={onPublish}>{t("eventDetail.publishNow")}</Button>
      : <Button variant="contained" startIcon={<PublishIcon />} disabled={busy} onClick={onPublish}>{t("eventDetail.publish")}</Button>;
  } else if (phase === "scheduling") {
    primary = <Button variant="contained" startIcon={<EventAvailableIcon />} component={RouterLink} to={`${base}/manage#date-poll`}>{t("eventManagement.datePoll")}</Button>;
  } else if (phase === "onDay") {
    primary = event.attendanceCheck
      ? <Button variant="contained" startIcon={<QrCodeScannerIcon />} component={RouterLink} to={`${base}/checkin`}>{t("eventDetail.checkin")}</Button>
      : <Button variant="contained" startIcon={<LiveTvIcon />} component={RouterLink} to={`${base}/live/control`}>{t("eventDetail.live")}</Button>;
  }

  // Menu の子に Fragment を置けないので、区切りごとに平らな配列へ積む
  const links = managementLinks({ isStaff: true, attendanceCheck: event.attendanceCheck, chatAvailable, inquiryUnread });
  const items: ReactNode[] = [];
  for (const group of MANAGEMENT_LINK_GROUPS) {
    const inGroup = links.filter((link) => link.group === group.key);
    if (inGroup.length === 0) continue;
    items.push(<ListSubheader key={`group-${group.key}`}>{t(group.labelKey)}</ListSubheader>);
    for (const link of inGroup) {
      items.push(<MenuItem key={link.path} component={RouterLink} to={`${base}/${link.path}`} onClick={close}>
        <ListItemIcon>{link.icon}</ListItemIcon>
        <ListItemText>{t(link.labelKey)}</ListItemText>
        {(link.badge ?? 0) >= 1 && <Badge color="error" badgeContent={link.badge} max={99}
          sx={{ ml: 2, "& .MuiBadge-badge": { position: "static", transform: "none" } }} />}
      </MenuItem>);
      // 公開は内容の区切りの「編集」の直後に置く（下書きのときだけ。予約があれば主ボタンと同じ2択）
      if (link.path === "edit" && event.status === "draft") {
        if (event.publishAt) {
          items.push(<MenuItem key="publish-now" disabled={busy} onClick={() => { close(); onPublish(); }}>
            <ListItemIcon><PublishIcon /></ListItemIcon>
            <ListItemText>{t("eventDetail.publishNow")}</ListItemText>
          </MenuItem>);
          items.push(<MenuItem key="cancel-schedule" disabled={busy} onClick={() => { close(); onCancelSchedule(); }}>
            <ListItemIcon><EventBusyIcon /></ListItemIcon>
            <ListItemText>{t("eventDetail.cancelSchedule")}</ListItemText>
          </MenuItem>);
        } else {
          items.push(<MenuItem key="publish" disabled={busy} onClick={() => { close(); onPublish(); }}>
            <ListItemIcon><PublishIcon /></ListItemIcon>
            <ListItemText>{t("eventDetail.publish")}</ListItemText>
          </MenuItem>);
        }
      }
    }
  }
  if (event.contestMode) {
    items.push(<Divider key="contest-divider" />);
    items.push(<MenuItem key="contest" component={RouterLink} to={`${base}/manage#contest-operations`} onClick={close}>
      <ListItemIcon><EmojiEventsOutlinedIcon /></ListItemIcon>
      <ListItemText>{t("eventRun.operationsTitle")}</ListItemText>
    </MenuItem>);
  }
  items.push(<Divider key="page-divider" />);
  items.push(<MenuItem key="manage" component={RouterLink} to={`${base}/manage`} onClick={close}>
    <ListItemIcon><DashboardIcon /></ListItemIcon>
    <ListItemText>{t("eventManagement.openPage")}</ListItemText>
  </MenuItem>);

  const menuId = "event-staff-actions-menu";
  return <>
    {primary && <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap data-testid="event-phase-actions">{primary}</Stack>}
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={sx} data-testid="event-fixed-actions">
      <Button variant="outlined" startIcon={<EditIcon />} component={RouterLink} to={`${base}/edit`}>{t("common.edit")}</Button>
      <Box>
        <Button id={ANCHOR_ID} variant="outlined" startIcon={<DashboardIcon />} endIcon={<ArrowDropDownIcon />} aria-haspopup="true"
          aria-controls={anchor ? menuId : undefined} aria-expanded={anchor ? "true" : undefined}
          onClick={(e) => setAnchor(e.currentTarget)}>
          {t("eventManagement.title")}
        </Button>
        <Menu id={menuId} anchorEl={anchor} open={Boolean(anchor)} onClose={close}>{items}</Menu>
      </Box>
    </Stack>
    {cancelSchedule.isError && <Typography variant="body2" color="error" sx={{ width: "100%" }}>
      {errorMessage(cancelSchedule.error, { default: t("eventForm.saveError"), publish_state_changed: t("eventForm.publishStateChanged") })}
    </Typography>}
  </>;
}

/**
 * 詳細ページ上部の公開予定の案内 (#613/#624)。運営ページの案内と同じ文言・同じ処理で、
 * 「予約を取り消す」を持つ（「今すぐ公開」は見出し下の時期のボタン）。staff の予約中の下書きだけ
 */
export function ScheduledPublishNotice({ event, date }: { event: Event; date: string }) {
  const { t } = useTranslation();
  const publish = usePublishEvent();
  const cancelSchedule = useCancelScheduledPublish();
  // ボタンは運営ページと同じく本文の下に置く（action に置くとスマホ幅で本文が細く折れるため）
  return <Alert severity="info">
    <Trans i18nKey="eventDetail.scheduledNotice" values={{ date }} components={{ b: <strong /> }} />
    <Box sx={{ mt: 1 }}>
      <Button variant="outlined" size="small" startIcon={<EventBusyIcon />} disabled={publish.isPending || cancelSchedule.isPending}
        onClick={() => cancelSchedule.mutate({ id: event.id, expectedAccessRevision: event.accessRevision })}>{t("eventDetail.cancelSchedule")}</Button>
    </Box>
    {cancelSchedule.isError && <Typography variant="body2" color="error" sx={{ mt: 1 }}>
      {errorMessage(cancelSchedule.error, { default: t("eventForm.saveError"), publish_state_changed: t("eventForm.publishStateChanged") })}
    </Typography>}
  </Alert>;
}
