import { useEffect } from "react";
import { Box, CircularProgress } from "@mui/material";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { useMe } from "./api/hooks.js";
import { Layout } from "./components/Layout.js";
import { PublicLayout } from "./components/PublicLayout.js";
import { EventLayout } from "./components/EventLayout.js";
import { LoginPage } from "./pages/LoginPage.js";
import { MyPage } from "./pages/MyPage.js";
import { EventsPage } from "./pages/EventsPage.js";
import { EventDetailPage } from "./pages/EventDetailPage.js";
import { CreateEventPage } from "./pages/CreateEventPage.js";
import { EditEventPage } from "./pages/EditEventPage.js";
import { PublicEventsPage } from "./pages/PublicEventsPage.js";
import { ScoringPage } from "./pages/ScoringPage.js";
import { AwardsPage } from "./pages/AwardsPage.js";
import { PresentPage } from "./pages/PresentPage.js";
import { ControlPage } from "./pages/ControlPage.js";
import { CriteriaAdminPage } from "./pages/CriteriaAdminPage.js";
import { ScoreResultsPage } from "./pages/ScoreResultsPage.js";
import { LotteryAdminPage } from "./pages/LotteryAdminPage.js";
import { AccountPage } from "./pages/AccountPage.js";
import { InquiriesPage } from "./pages/InquiriesPage.js";
import { InquiryThreadPage } from "./pages/InquiryThreadPage.js";
import { AdminInquiriesPage } from "./pages/AdminInquiriesPage.js";
import { AdminInquiryThreadPage } from "./pages/AdminInquiryThreadPage.js";
import { PrivacyPolicyPage } from "./pages/PrivacyPolicyPage.js";
import { TermsPage } from "./pages/TermsPage.js";
import { UserProfilePage } from "./pages/UserProfilePage.js";
import { CommunitiesPage } from "./pages/CommunitiesPage.js";
import { CommunityPage } from "./pages/CommunityPage.js";
import { CreateCommunityPage } from "./pages/CreateCommunityPage.js";
import { CommunityEditPage } from "./pages/CommunityEditPage.js";
import { UpcomingEventsPage } from "./pages/UpcomingEventsPage.js";
import { DecksPage } from "./pages/DecksPage.js";
import { LiveSetsPage } from "./pages/LiveSetsPage.js";
import { LiveSetEditorPage } from "./pages/LiveSetEditorPage.js";
import { LiveScreenPage } from "./pages/LiveScreenPage.js";
import { LiveControlPage } from "./pages/LiveControlPage.js";
import { DeckEditorPage } from "./pages/DeckEditorPage.js";
import { DeckViewerPage } from "./pages/DeckViewerPage.js";
import { ShortEventPage } from "./pages/ShortEventPage.js";

/** ログイン前に控えた戻り先（/login?next=…）へ、ログイン後に一度だけ遷移する */
function PostLoginRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    const next = localStorage.getItem("postLoginRedirect");
    if (next && next.startsWith("/")) {
      localStorage.removeItem("postLoginRedirect");
      navigate(next, { replace: true });
    } else if (next) {
      localStorage.removeItem("postLoginRedirect");
    }
  }, [navigate]);
  return null;
}

export function App() {
  const { data: user, isLoading } = useMe();

  if (isLoading) {
    return (
      <Box sx={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {/* 未ログインの公開ページ */}
        <Route
          path="/"
          element={
            <PublicLayout>
              <PublicEventsPage />
            </PublicLayout>
          }
        />
        <Route
          path="/events/upcoming"
          element={
            <PublicLayout>
              <UpcomingEventsPage />
            </PublicLayout>
          }
        />
        <Route
          path="/events/:id"
          element={
            <PublicLayout>
              <EventDetailPage />
            </PublicLayout>
          }
        />
        <Route
          path="/events/:id/results"
          element={
            <PublicLayout>
              <ScoreResultsPage />
            </PublicLayout>
          }
        />
        <Route
          path="/privacy"
          element={
            <PublicLayout>
              <PrivacyPolicyPage />
            </PublicLayout>
          }
        />
        <Route
          path="/terms"
          element={
            <PublicLayout>
              <TermsPage />
            </PublicLayout>
          }
        />
        <Route
          path="/users/:id"
          element={
            <PublicLayout>
              <UserProfilePage />
            </PublicLayout>
          }
        />
        <Route
          path="/communities"
          element={
            <PublicLayout>
              <CommunitiesPage />
            </PublicLayout>
          }
        />
        <Route
          path="/c/:slug"
          element={
            <PublicLayout>
              <CommunityPage />
            </PublicLayout>
          }
        />
        <Route
          path="/d/:slug"
          element={
            <PublicLayout>
              <DeckViewerPage />
            </PublicLayout>
          }
        />
        <Route
          path="/e/:slug"
          element={
            <PublicLayout>
              <ShortEventPage />
            </PublicLayout>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  return (
    <Layout user={user}>
      <PostLoginRedirect />
      <Routes>
        <Route path="/" element={<PublicEventsPage />} />
        <Route path="/me" element={<MyPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/inquiries" element={<InquiriesPage />} />
        <Route path="/inquiries/:id" element={<InquiryThreadPage />} />
        <Route path="/admin/inquiries" element={<AdminInquiriesPage />} />
        <Route path="/admin/inquiries/:id" element={<AdminInquiryThreadPage />} />
        <Route path="/privacy" element={<PrivacyPolicyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/users/:id" element={<UserProfilePage />} />
        <Route path="/communities" element={<CommunitiesPage />} />
        <Route path="/communities/new" element={<CreateCommunityPage />} />
        <Route path="/c/:slug" element={<CommunityPage />} />
        <Route path="/c/:slug/edit" element={<CommunityEditPage />} />
        <Route path="/decks" element={<DecksPage />} />
        <Route path="/decks/:id/edit" element={<DeckEditorPage />} />
        <Route path="/live-sets" element={<LiveSetsPage />} />
        <Route path="/live-sets/:id/edit" element={<LiveSetEditorPage />} />
        <Route path="/d/:slug" element={<DeckViewerPage />} />
        <Route path="/e/:slug" element={<ShortEventPage />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/events/upcoming" element={<UpcomingEventsPage />} />
        <Route path="/events/new" element={<CreateEventPage />} />
        {/* 配信画面/コントロール（EventLayoutのモード強制遷移を受けない） */}
        <Route path="/events/:id/live/screen" element={<LiveScreenPage />} />
        <Route path="/events/:id/live/control" element={<LiveControlPage />} />
        <Route path="/events/:id" element={<EventLayout />}>
          <Route index element={<EventDetailPage />} />
          <Route path="edit" element={<EditEventPage />} />
          <Route path="scoring" element={<ScoringPage />} />
          <Route path="present" element={<PresentPage />} />
          <Route path="awards" element={<AwardsPage />} />
          <Route path="control" element={<ControlPage />} />
          <Route path="criteria" element={<CriteriaAdminPage />} />
          <Route path="results" element={<ScoreResultsPage />} />
          <Route path="lottery" element={<LotteryAdminPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/me" replace />} />
      </Routes>
    </Layout>
  );
}
