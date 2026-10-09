import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Stack,
  Typography,
} from "@mui/material";
import { Link as RouterLink, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useEvent } from "../api/hooks.js";
import {
  useCloseEventInquiry,
  useEventInquiries,
  useEventInquiry,
  usePostEventInquiryMessage,
} from "../api/inquiryHooks.js";
import { EventBreadcrumbs } from "../components/EventBreadcrumbs.js";
import { InquiryThread, inquiryStatusColor } from "../components/InquiryThread.js";
import { tDynamic } from "../i18n/index.js";
import { formatDateTime } from "../lib/format.js";

/**
 * イベントの主催者あての問い合わせ (D-EVENT-CONTACT)。そのイベントの確定スタッフだけが使う。
 * イベント配下の表示はイベント内の役割だけで判定する（サイト管理者かどうかは混ぜない）。
 * 定期の取り直しはしない。開いたとき・送ったとき・タブに戻ったときに読む（D-POLL-MIN）
 */
export function EventInquiriesPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const { data: eventData } = useEvent(id);
  const isStaff = eventData?.myRole === "staff";
  const { data: inquiries, isError } = useEventInquiries(id, isStaff);

  if (!eventData) return <Typography>{t("common.loading")}</Typography>;
  if (!isStaff) return <Alert severity="info">{t("eventInquiry.staffOnly")}</Alert>;

  return (
    <Stack spacing={2}>
      <EventBreadcrumbs
        eventId={id}
        eventTitle={eventData.event.title}
        current={t("eventInquiry.manageTitle")}
      />
      <Typography variant="h5" component="h1" fontWeight={700}>
        {t("eventInquiry.manageTitle")}
      </Typography>
      {isError ? (
        <Alert severity="error">{t("staffOps.loadFailed")}</Alert>
      ) : !inquiries ? (
        <Typography>{t("common.loading")}</Typography>
      ) : inquiries.length === 0 ? (
        <Typography color="text.secondary">{t("eventInquiry.empty")}</Typography>
      ) : (
        <Stack spacing={1.5}>
          {inquiries.map((q) => (
            <Card key={q.id} variant="outlined">
              <CardActionArea component={RouterLink} to={`/events/${id}/inquiries/${q.id}`}>
                <CardContent>
                  <Stack direction="row" spacing={1.5} alignItems="center">
                    {q.unread && (
                      <Box
                        aria-hidden
                        sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "error.main", flexShrink: 0 }}
                      />
                    )}
                    <Avatar src={q.userAvatarUrl ?? undefined} sx={{ width: 28, height: 28 }}>
                      {q.userName.charAt(0)}
                    </Avatar>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontWeight: q.unread ? 700 : 400 }} noWrap>
                        {q.subject || eventData.event.title}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {q.userName}
                        {t("common.dotSeparator")}
                        {formatDateTime(q.lastMessageAt)}
                      </Typography>
                    </Box>
                    <Chip
                      size="small"
                      label={tDynamic(`inquiryStatus.${q.status}`, q.status)}
                      color={inquiryStatusColor(q.status)}
                    />
                  </Stack>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

export function EventInquiryThreadPage() {
  const { t } = useTranslation();
  const { id = "", inquiryId = "" } = useParams();
  const { data: eventData } = useEvent(id);
  const isStaff = eventData?.myRole === "staff";
  const { data, isError } = useEventInquiry(id, inquiryId, isStaff);
  const post = usePostEventInquiryMessage(id, inquiryId);
  const close = useCloseEventInquiry(id, inquiryId);

  if (!eventData) return <Typography>{t("common.loading")}</Typography>;
  if (!isStaff) return <Alert severity="info">{t("eventInquiry.staffOnly")}</Alert>;
  if (isError) return <Alert severity="info">{t("inquiries.notFound")}</Alert>;
  if (!data) return <Typography>{t("common.loading")}</Typography>;

  return (
    <Stack spacing={2}>
      <Button
        component={RouterLink}
        to={`/events/${id}/inquiries`}
        size="small"
        sx={{ alignSelf: "flex-start" }}
      >
        {t("eventInquiry.backToList")}
      </Button>
      {data.userHandle && (
        <Box
          component={RouterLink}
          to={`/users/${data.userHandle}`}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            textDecoration: "none",
            color: "inherit",
            alignSelf: "flex-start",
            "&:hover .name": { textDecoration: "underline" },
          }}
        >
          <Avatar src={data.userAvatarUrl ?? undefined} sx={{ width: 32, height: 32 }}>
            {data.userName?.charAt(0)}
          </Avatar>
          <Typography className="name" variant="body2" fontWeight={600}>
            {data.userName}
          </Typography>
        </Box>
      )}
      {close.isError && <Alert severity="error">{t("eventInquiry.markDoneFailed")}</Alert>}
      <InquiryThread
        detail={data}
        selfSender="staff"
        onSend={(body) => post.mutate(body)}
        sending={post.isPending}
        actions={
          data.status !== "closed" && (
            <Button size="small" variant="outlined" disabled={close.isPending} onClick={() => close.mutate()}>
              {t("eventInquiry.markDone")}
            </Button>
          )
        }
      />
    </Stack>
  );
}
