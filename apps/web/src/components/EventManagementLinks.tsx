import type { ReactNode } from "react";
import type { ParseKeys } from "i18next";
import { Button, Stack } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import AssignmentIndOutlinedIcon from "@mui/icons-material/AssignmentIndOutlined";
import BadgeIcon from "@mui/icons-material/Badge";
import BarChartIcon from "@mui/icons-material/BarChart";
import CampaignIcon from "@mui/icons-material/Campaign";
import CardGiftcardIcon from "@mui/icons-material/CardGiftcard";
import CasinoOutlinedIcon from "@mui/icons-material/CasinoOutlined";
import ChecklistIcon from "@mui/icons-material/Checklist";
import ForumOutlinedIcon from "@mui/icons-material/ForumOutlined";
import LiveTvIcon from "@mui/icons-material/LiveTv";
import PollOutlinedIcon from "@mui/icons-material/PollOutlined";
import QrCodeScannerIcon from "@mui/icons-material/QrCodeScanner";

/** Existing dedicated operations; access is still governed by the real event role. */
export function EventManagementLinks({ eventId, isStaff, attendanceCheck, chatAvailable }: {
  eventId: string; isStaff: boolean; attendanceCheck: boolean; chatAvailable: boolean;
}) {
  const { t } = useTranslation();
  if (!isStaff) return null;
  const links: { path: string; labelKey: ParseKeys; icon?: ReactNode; variant?: "contained"; show: boolean }[] = [
    { path: "edit", labelKey: "common.edit", variant: "contained", show: isStaff },
    // ここから運営用（myRole === "staff" のときだけ。isAdmin は混ぜない #275）
    { path: "live/control", labelKey: "eventDetail.live", icon: <LiveTvIcon />, show: isStaff },
    { path: "broadcast", labelKey: "eventDetail.broadcast", icon: <CampaignIcon />, show: isStaff },
    { path: "todos", labelKey: "staffOps.todoTitle", icon: <ChecklistIcon />, show: isStaff },
    { path: "staff-chat", labelKey: "staffOps.staffChatTitle", icon: <ForumOutlinedIcon />, show: isStaff },
    { path: "staffing", labelKey: "staffOps.dutyTitle", icon: <AssignmentIndOutlinedIcon />, show: isStaff },
    { path: "prize-desk", labelKey: "staffOps.prizeDeskTitle", icon: <CardGiftcardIcon />, show: isStaff },
    { path: "bingo/control", labelKey: "staffOps.bingoControlTitle", icon: <CasinoOutlinedIcon />, show: isStaff },
    { path: "pre-survey", labelKey: "staffOps.preSurveyTitle", icon: <PollOutlinedIcon />, show: isStaff },
    { path: "stats", labelKey: "eventDetail.stats", icon: <BarChartIcon />, show: isStaff },
    {
      path: "checkin",
      labelKey: "eventDetail.checkin",
      icon: <QrCodeScannerIcon />,
      show: isStaff && attendanceCheck,
    },
    { path: "name-cards", labelKey: "eventDetail.nameCards", icon: <BadgeIcon />, show: isStaff },
    { path: "chat", labelKey: "eventManagement.chat", icon: <ForumOutlinedIcon />, show: chatAvailable },
  ];
  return <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
    {links.filter((link) => link.show).map((link) => <Button key={link.path}
      component={RouterLink} to={`/events/${eventId}/${link.path}`} variant={link.variant ?? "outlined"} startIcon={link.icon}>
      {t(link.labelKey)}
    </Button>)}
  </Stack>;
}
