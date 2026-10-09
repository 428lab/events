import type { ReactNode } from "react";
import type { ParseKeys } from "i18next";
import { Badge, Button, Stack } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useEventInquiryUnreadCount } from "../api/inquiryHooks.js";
import AssignmentIndOutlinedIcon from "@mui/icons-material/AssignmentIndOutlined";
import BadgeIcon from "@mui/icons-material/Badge";
import BarChartIcon from "@mui/icons-material/BarChart";
import CampaignIcon from "@mui/icons-material/Campaign";
import CardGiftcardIcon from "@mui/icons-material/CardGiftcard";
import CasinoOutlinedIcon from "@mui/icons-material/CasinoOutlined";
import ChecklistIcon from "@mui/icons-material/Checklist";
import EditIcon from "@mui/icons-material/Edit";
import ForumOutlinedIcon from "@mui/icons-material/ForumOutlined";
import MailOutlineIcon from "@mui/icons-material/MailOutline";
import LiveTvIcon from "@mui/icons-material/LiveTv";
import PollOutlinedIcon from "@mui/icons-material/PollOutlined";
import QrCodeScannerIcon from "@mui/icons-material/QrCodeScanner";

/** 運営メニューの区切り (#613)。並びはこの順 */
export const MANAGEMENT_LINK_GROUPS = [
  { key: "content", labelKey: "eventManagement.groupContent" },
  { key: "comms", labelKey: "eventManagement.groupComms" },
  { key: "day", labelKey: "eventManagement.groupDay" },
  { key: "review", labelKey: "eventManagement.groupReview" },
] as const satisfies readonly { key: string; labelKey: ParseKeys }[];

export interface ManagementLink {
  path: string;
  labelKey: ParseKeys;
  icon: ReactNode;
  group: (typeof MANAGEMENT_LINK_GROUPS)[number]["key"];
  variant?: "contained";
  show: boolean;
  badge?: number;
}

/**
 * 運営ページのボタン列と、詳細ページの「運営」メニュー (#613) が共有する項目の定義。
 * 項目と表示条件はここ1か所に置き、2か所で食い違わないようにする。
 */
export function managementLinks({ isStaff, attendanceCheck, chatAvailable, inquiryUnread }: {
  isStaff: boolean; attendanceCheck: boolean; chatAvailable: boolean; inquiryUnread?: number;
}): ManagementLink[] {
  if (!isStaff) return [];
  const links: ManagementLink[] = [
    { path: "edit", labelKey: "common.edit", icon: <EditIcon />, group: "content", variant: "contained", show: isStaff },
    // ここから運営用（myRole === "staff" のときだけ。isAdmin は混ぜない #275）
    { path: "live/control", labelKey: "eventDetail.live", icon: <LiveTvIcon />, group: "day", show: isStaff },
    { path: "broadcast", labelKey: "eventDetail.broadcast", icon: <CampaignIcon />, group: "comms", show: isStaff },
    { path: "inquiries", labelKey: "eventInquiry.manageTitle", icon: <MailOutlineIcon />, group: "comms", show: isStaff, badge: inquiryUnread },
    { path: "todos", labelKey: "staffOps.todoTitle", icon: <ChecklistIcon />, group: "review", show: isStaff },
    { path: "staff-chat", labelKey: "staffOps.staffChatTitle", icon: <ForumOutlinedIcon />, group: "comms", show: isStaff },
    { path: "staffing", labelKey: "staffOps.dutyTitle", icon: <AssignmentIndOutlinedIcon />, group: "day", show: isStaff },
    { path: "prize-desk", labelKey: "staffOps.prizeDeskTitle", icon: <CardGiftcardIcon />, group: "day", show: isStaff },
    { path: "bingo/control", labelKey: "staffOps.bingoControlTitle", icon: <CasinoOutlinedIcon />, group: "day", show: isStaff },
    { path: "pre-survey", labelKey: "staffOps.preSurveyTitle", icon: <PollOutlinedIcon />, group: "content", show: isStaff },
    { path: "stats", labelKey: "eventDetail.stats", icon: <BarChartIcon />, group: "review", show: isStaff },
    {
      path: "checkin",
      labelKey: "eventDetail.checkin",
      icon: <QrCodeScannerIcon />,
      group: "day",
      show: isStaff && attendanceCheck,
    },
    { path: "name-cards", labelKey: "eventDetail.nameCards", icon: <BadgeIcon />, group: "day", show: isStaff },
    { path: "chat", labelKey: "eventManagement.chat", icon: <ForumOutlinedIcon />, group: "comms", show: chatAvailable },
  ];
  return links.filter((link) => link.show);
}

/** Existing dedicated operations; access is still governed by the real event role. */
export function EventManagementLinks({ eventId, isStaff, attendanceCheck, chatAvailable }: {
  eventId: string; isStaff: boolean; attendanceCheck: boolean; chatAvailable: boolean;
}) {
  const { t } = useTranslation();
  // 主催者あての問い合わせの未読数 (D-EVENT-CONTACT)。スタッフのときだけ取りに行く
  const { data: inquiryUnread = 0 } = useEventInquiryUnreadCount(eventId, isStaff);
  if (!isStaff) return null;
  const links = managementLinks({ isStaff, attendanceCheck, chatAvailable, inquiryUnread });
  return <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
    {links.map((link) => <Badge key={link.path} color="error" badgeContent={link.badge ?? 0} max={99}>
      <Button component={RouterLink} to={`/events/${eventId}/${link.path}`} variant={link.variant ?? "outlined"} startIcon={link.icon}>
        {t(link.labelKey)}
      </Button>
    </Badge>)}
  </Stack>;
}
