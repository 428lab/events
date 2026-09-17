import type { ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Accordion, AccordionDetails, AccordionSummary, Alert, Button, Stack, Typography } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { Link as RouterLink, useLocation, useNavigate, useParams } from "react-router-dom";
import type { Event, EventRole } from "@eventer/shared";
import { useEvent, usePublishEvent } from "../api/hooks.js";
import { useContestAnchor } from "../lib/useContestAnchor.js";
import { useEventChatAccess } from "../lib/useEventChatAccess.js";
import { ContestOperationsSection } from "../components/ContestOperationsSection.js";
import { EventManagementLinks } from "../components/EventManagementLinks.js";
import { SchedulePanel } from "../components/SchedulePanel.js";
import { EventSchedule } from "../components/EventSchedule.js";
import { EventMaterials } from "../components/EventMaterials.js";
import { EventMemberList } from "../components/EventMemberList.js";
import { EventStaffInvitesCard } from "../components/EventStaffInvitesCard.js";
import { EventAccessInvitesCard } from "../components/EventAccessInvitesCard.js";
import { VenueOfferPanel } from "../components/VenueOffers.js";
import { EventPhotos } from "../components/EventPhotos.js";
import { EventComments } from "../components/EventComments.js";
import { EventQa } from "../components/EventQa.js";

/** URL-backed sections mount their real operations only while expanded. */
function ManagementSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const expanded = location.hash === `#${id}`;
  useContestAnchor(id, expanded);
  return <Accordion expanded={expanded} onChange={(_, open) => navigate({ ...location, hash: open ? `#${id}` : "" })}>
    <AccordionSummary id={id} expandIcon={<ExpandMoreIcon />} sx={{ scrollMarginTop: 88 }}>
      <Typography component="h2" variant="subtitle1" fontWeight={700}>{title}</Typography>
    </AccordionSummary>
    <AccordionDetails>{expanded ? children : null}</AccordionDetails>
  </Accordion>;
}

/** Outside EventLayout: participant mode redirects must not block access managers. */
export function EventManagePage() {
  const { id = "" } = useParams();
  const { t } = useTranslation();
  const { data, isLoading, isError } = useEvent(id);
  const back = <Button component={RouterLink} to={`/events/${id}`} sx={{ alignSelf: "flex-start" }}>{t("eventManagement.backToInfo")}</Button>;
  if (isError) return <Stack spacing={2}><Alert severity="info">{t("eventDetail.notFound")}</Alert>{back}</Stack>;
  if (isLoading || !data) return <Typography>{t("common.loading")}</Typography>;
  const { event, myRole } = data;
  const isStaff = myRole === "staff";
  const canInvite = event.visibility === "private" && Boolean(data.canManageAccess);
  if (!isStaff && !canInvite) return <Stack spacing={2}><Alert severity="info">{t("eventManagement.denied")}</Alert>{back}</Stack>;
  return <Stack spacing={3}>
    <Typography variant="h5" component="h1" fontWeight={700}>{event.title} / {t("eventManagement.title")}</Typography>
    {back}
    {isStaff ? <StaffManagement key={id} eventId={id} event={event} myRole={myRole} canInvite={canInvite} /> : (
      <ManagementSection id="invites" title={t("eventManagement.invites")}><EventAccessInvitesCard eventId={id} /></ManagementSection>
    )}
  </Stack>;
}

function StaffManagement({ eventId, event, myRole, canInvite }: {
  eventId: string; event: Event; myRole: EventRole | null; canInvite: boolean;
}) {
  const { t } = useTranslation();
  const publish = usePublishEvent();
  const { canChat, chatAvailable } = useEventChatAccess(eventId);
  const isStaff = myRole === "staff";
  return <>
    {event.status === "draft" && <Alert severity="warning" action={
      <Button color="inherit" size="small" disabled={publish.isPending} onClick={() => publish.mutate(event.id)}>{t("eventDetail.publish")}</Button>
    }><Trans i18nKey="eventDetail.draftNotice" components={{ b: <strong /> }} /></Alert>}
    {event.contestMode && <ContestOperationsSection eventId={eventId} event={event} myRole={myRole} />}
    <Typography variant="h6" component="h2">{t("eventManagement.general")}</Typography>
    <EventManagementLinks eventId={eventId} isStaff={isStaff} attendanceCheck={event.attendanceCheck} chatAvailable={chatAvailable} />
    <Typography variant="h6" component="h2">{t("eventManagement.inline")}</Typography>
    <Stack>
      <ManagementSection id="date-poll" title={t("eventManagement.datePoll")}>
        <SchedulePanel showEmptyState eventId={eventId} isStaff={isStaff} anonymous={event.scheduleAnonymous} finalized={!event.scheduling}
          visible={event.scheduleVisible} eventStartsAt={event.startsAt} eventEndsAt={event.endsAt} />
      </ManagementSection>
      <ManagementSection id="timetable" title={t("eventManagement.timetable")}>
        <EventSchedule eventId={eventId} isStaff={isStaff} eventStartsAt={event.scheduling ? null : event.startsAt} />
        <EventMaterials eventId={eventId} />
      </ManagementSection>
      <ManagementSection id="members" title={t("eventManagement.members")}>
        <EventMemberList eventId={eventId} isStaff={isStaff} attendanceCheck={event.attendanceCheck} />
      </ManagementSection>
      <ManagementSection id="invites" title={t("eventManagement.invites")}>
        <Stack spacing={2}>{canInvite && <EventAccessInvitesCard eventId={eventId} />}<EventStaffInvitesCard eventId={eventId} /></Stack>
      </ManagementSection>
      <ManagementSection id="venue-offers" title={t("eventManagement.venueOffers")}>
        <VenueOfferPanel showEmptyState kind="for-event" id={eventId} enabled={isStaff} />
      </ManagementSection>
      <ManagementSection id="photos" title={t("eventManagement.photos")}>
        <EventPhotos eventId={eventId} myRole={myRole} photosPublic={event.photosPublic} published={event.status === "published"} />
      </ManagementSection>
      <ManagementSection id="comments" title={t("eventManagement.comments")}>
        <EventComments eventId={eventId} myRole={myRole} canComment={canChat} />
      </ManagementSection>
      {canChat && event.qaEnabled && <ManagementSection id="qa" title={t("eventManagement.qa")}>
        <EventQa eventId={eventId} canPost={canChat} />
      </ManagementSection>}
    </Stack>
  </>;
}
