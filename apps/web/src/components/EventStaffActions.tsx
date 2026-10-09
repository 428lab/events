import { useState, type ReactNode } from "react";
import { Box, Button, Divider, ListItemIcon, ListItemText, ListSubheader, Menu, MenuItem, Stack, type SxProps, type Theme } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Event, EventRole } from "@eventer/shared";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import DashboardIcon from "@mui/icons-material/Dashboard";
import EditIcon from "@mui/icons-material/Edit";
import EmojiEventsOutlinedIcon from "@mui/icons-material/EmojiEventsOutlined";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import GroupAddIcon from "@mui/icons-material/GroupAdd";
import LiveTvIcon from "@mui/icons-material/LiveTv";
import PublishIcon from "@mui/icons-material/Publish";
import QrCodeScannerIcon from "@mui/icons-material/QrCodeScanner";
import { usePublishEvent } from "../api/hooks.js";
import { getEventPhase } from "../lib/eventPhase.js";
import type { EventTiming } from "../lib/useEventTiming.js";
import { MANAGEMENT_LINK_GROUPS, managementLinks } from "./EventManagementLinks.js";

/** `/events/:id#contest-operations` のアンカー先。詳細ページの入口に付ける */
const ANCHOR_ID = "contest-operations";

/**
 * 詳細ページ見出し直下の運営の入口 (#613)。
 *
 * スタッフには「時期で変わる主ボタン 1 つ」+「編集」+「運営 ▾」メニューを出す。
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
  const canInvite = event.visibility === "private" && canManageAccess;
  // 時計は useEventTiming が 1 分ごとに再描画させるので、ここでは描画時の時刻を読むだけ
  const phase = getEventPhase(event, timing, Date.now());
  if (isStaff) return <StaffActions eventId={eventId} event={event} chatAvailable={chatAvailable} phase={phase} sx={sx} />;
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

function StaffActions({ eventId, event, chatAvailable, phase, sx }: {
  eventId: string; event: Event; chatAvailable: boolean; phase: ReturnType<typeof getEventPhase>; sx?: SxProps<Theme>;
}) {
  const { t } = useTranslation();
  const publish = usePublishEvent();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const base = `/events/${eventId}`;
  const close = () => setAnchor(null);
  const onPublish = () => publish.mutate(event.id);

  let primary: ReactNode = null;
  if (phase === "draft") {
    primary = <Button variant="contained" startIcon={<PublishIcon />} disabled={publish.isPending} onClick={onPublish}>{t("eventDetail.publish")}</Button>;
  } else if (phase === "scheduling") {
    primary = <Button variant="contained" startIcon={<EventAvailableIcon />} component={RouterLink} to={`${base}/manage#date-poll`}>{t("eventManagement.datePoll")}</Button>;
  } else if (phase === "upcoming") {
    primary = <Button variant="contained" startIcon={<EditIcon />} component={RouterLink} to={`${base}/edit`}>{t("common.edit")}</Button>;
  } else if (phase === "onDay") {
    primary = event.attendanceCheck
      ? <Button variant="contained" startIcon={<QrCodeScannerIcon />} component={RouterLink} to={`${base}/checkin`}>{t("eventDetail.checkin")}</Button>
      : <Button variant="contained" startIcon={<LiveTvIcon />} component={RouterLink} to={`${base}/live/control`}>{t("eventDetail.live")}</Button>;
  }

  // Menu の子に Fragment を置けないので、区切りごとに平らな配列へ積む
  const links = managementLinks({ isStaff: true, attendanceCheck: event.attendanceCheck, chatAvailable });
  const items: ReactNode[] = [];
  for (const group of MANAGEMENT_LINK_GROUPS) {
    const inGroup = links.filter((link) => link.group === group.key);
    if (inGroup.length === 0) continue;
    items.push(<ListSubheader key={`group-${group.key}`}>{t(group.labelKey)}</ListSubheader>);
    for (const link of inGroup) {
      items.push(<MenuItem key={link.path} component={RouterLink} to={`${base}/${link.path}`} onClick={close}>
        <ListItemIcon>{link.icon}</ListItemIcon>
        <ListItemText>{t(link.labelKey)}</ListItemText>
      </MenuItem>);
      // 公開は内容の区切りの「編集」の直後に置く（下書きのときだけ）
      if (link.path === "edit" && event.status === "draft") {
        items.push(<MenuItem key="publish" disabled={publish.isPending} onClick={() => { close(); onPublish(); }}>
          <ListItemIcon><PublishIcon /></ListItemIcon>
          <ListItemText>{t("eventDetail.publish")}</ListItemText>
        </MenuItem>);
      }
    }
  }
  if (event.contestMode) {
    items.push(<Divider key="contest-divider" />);
    items.push(<MenuItem key="contest" component={RouterLink} to={`${base}/manage#contest-operations`} onClick={close}>
      <ListItemIcon><EmojiEventsOutlinedIcon /></ListItemIcon>
      <ListItemText>{t("eventManagement.contestOps")}</ListItemText>
    </MenuItem>);
  }
  items.push(<Divider key="page-divider" />);
  items.push(<MenuItem key="manage" component={RouterLink} to={`${base}/manage`} onClick={close}>
    <ListItemIcon><DashboardIcon /></ListItemIcon>
    <ListItemText>{t("eventManagement.openPage")}</ListItemText>
  </MenuItem>);

  const menuId = "event-staff-actions-menu";
  return <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={sx}>
    {primary}
    {phase !== "upcoming" && <Button variant="outlined" startIcon={<EditIcon />} component={RouterLink} to={`${base}/edit`}>{t("common.edit")}</Button>}
    <Box>
      <Button id={ANCHOR_ID} variant="outlined" startIcon={<DashboardIcon />} endIcon={<ArrowDropDownIcon />} aria-haspopup="true"
        aria-controls={anchor ? menuId : undefined} aria-expanded={anchor ? "true" : undefined}
        onClick={(e) => setAnchor(e.currentTarget)}>
        {t("eventManagement.title")}
      </Button>
      <Menu id={menuId} anchorEl={anchor} open={Boolean(anchor)} onClose={close}>{items}</Menu>
    </Box>
  </Stack>;
}
