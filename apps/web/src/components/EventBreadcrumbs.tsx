import { Breadcrumbs, Link, Typography } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";

/** イベント配下ページ用のパンくず: イベント一覧 / {イベント名} / {現在ページ} */
export function EventBreadcrumbs({
  eventId,
  eventTitle,
  current,
}: {
  eventId: string;
  eventTitle: string;
  current: string;
}) {
  return (
    <Breadcrumbs sx={{ mb: 2 }}>
      <Link component={RouterLink} to="/events" underline="hover" color="inherit">
        イベント
      </Link>
      <Link
        component={RouterLink}
        to={`/events/${eventId}`}
        underline="hover"
        color="inherit"
      >
        {eventTitle}
      </Link>
      <Typography color="text.primary">{current}</Typography>
    </Breadcrumbs>
  );
}
