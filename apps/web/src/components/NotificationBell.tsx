import { Badge, IconButton } from "@mui/material";
import NotificationsNoneIcon from "@mui/icons-material/NotificationsNone";
import { useNavigate } from "react-router-dom";
import { useInquiryUnreadCount } from "../api/inquiryHooks.js";

/** お問い合わせの回答（運営からの新着）を知らせる通知ベル */
export function NotificationBell() {
  const navigate = useNavigate();
  const { data: count } = useInquiryUnreadCount();
  return (
    <IconButton
      color="inherit"
      onClick={() => navigate("/inquiries")}
      aria-label="お知らせ"
      title="お問い合わせ・お知らせ"
    >
      <Badge badgeContent={count ?? 0} color="error">
        <NotificationsNoneIcon />
      </Badge>
    </IconButton>
  );
}
