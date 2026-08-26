import { Suspense, lazy, useEffect } from "react";
import { Box, CircularProgress } from "@mui/material";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { useMe, usePendingDeletion } from "./api/hooks.js";
import { Layout } from "./components/Layout.js";
import { PublicLayout } from "./components/PublicLayout.js";
import { EventLayout } from "./components/EventLayout.js";
import { LoginPage } from "./pages/LoginPage.js";

import { EventDetailPage } from "./pages/EventDetailPage.js";
import { EventChatPage } from "./pages/EventChatPage.js";
import { EventChatScreenPage } from "./pages/EventChatScreenPage.js";
import { StaffChatPage } from "./pages/StaffChatPage.js";
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
import { EventBroadcastPage } from "./pages/EventBroadcastPage.js";
import { EventTodoPage } from "./pages/EventTodoPage.js";
import { EventPrizeDeskPage } from "./pages/EventPrizeDeskPage.js";
import { EventBingoPage } from "./pages/EventBingoPage.js";
import { EventBingoControlPage } from "./pages/EventBingoControlPage.js";
import { EventBingoScreenPage } from "./pages/EventBingoScreenPage.js";
import { EventStaffingPage } from "./pages/EventStaffingPage.js";
import { AccountPage } from "./pages/AccountPage.js";
import { AccountRestorePage } from "./pages/AccountRestorePage.js";
import { InquiriesPage } from "./pages/InquiriesPage.js";
import { NotificationsPage } from "./pages/NotificationsPage.js";
import { StaffInvitesPage } from "./pages/StaffInvitesPage.js";
import { InquiryThreadPage } from "./pages/InquiryThreadPage.js";
import { AdminInquiriesPage } from "./pages/AdminInquiriesPage.js";
import { AdminInquiryThreadPage } from "./pages/AdminInquiryThreadPage.js";
import { PrivacyPolicyPage } from "./pages/PrivacyPolicyPage.js";
import { TermsPage } from "./pages/TermsPage.js";
import { UserProfilePage } from "./pages/UserProfilePage.js";
import { MeetScanPage } from "./pages/MeetScanPage.js";
import { safeRedirectPath } from "./lib/safeRedirect.js";
import { CommunitiesPage } from "./pages/CommunitiesPage.js";
import { CommunityPage } from "./pages/CommunityPage.js";
import { CommunityMembersPage } from "./pages/CommunityMembersPage.js";
import { CreateCommunityPage } from "./pages/CreateCommunityPage.js";
import { CommunityEditPage } from "./pages/CommunityEditPage.js";
import { CommunityKpiPage } from "./pages/CommunityKpiPage.js";
import { UpcomingEventsPage } from "./pages/UpcomingEventsPage.js";
import { EventRequestsPage } from "./pages/EventRequestsPage.js";
import { EventRequestNewPage } from "./pages/EventRequestNewPage.js";
import { EventRequestDetailPage } from "./pages/EventRequestDetailPage.js";
import { ShortRequestPage } from "./pages/ShortRequestPage.js";
import { FollowingPage } from "./pages/FollowingPage.js";
import { VenuesPage } from "./pages/VenuesPage.js";
import { VenueDetailPage } from "./pages/VenueDetailPage.js";
import { VenueFormPage } from "./pages/VenueFormPage.js";
import { DecksPage } from "./pages/DecksPage.js";
import { LiveSetsPage } from "./pages/LiveSetsPage.js";
import { LiveSetEditorPage } from "./pages/LiveSetEditorPage.js";
import { LiveScreenPage } from "./pages/LiveScreenPage.js";
import { MeetRankingScreenPage } from "./pages/MeetRankingScreenPage.js";
import { LiveControlPage } from "./pages/LiveControlPage.js";
import { EventStatsPage } from "./pages/EventStatsPage.js";
import { EventTimetablePage } from "./pages/EventTimetablePage.js";
import { AdminStatsPage } from "./pages/AdminStatsPage.js";
import { AdminKpiPage } from "./pages/AdminKpiPage.js";
import { AdminTrendingPage } from "./pages/AdminTrendingPage.js";
import { AdminSettingsPage } from "./pages/AdminSettingsPage.js";
import { AdminAuditPage } from "./pages/AdminAuditPage.js";
import { AdminAbusePage } from "./pages/AdminAbusePage.js";
import { AdminModerationPage } from "./pages/AdminModerationPage.js";
import { DeckEditorPage } from "./pages/DeckEditorPage.js";
import { DeckViewerPage } from "./pages/DeckViewerPage.js";
import { ShortEventPage } from "./pages/ShortEventPage.js";

/** ライセンスカード (#178)。背景パターンのパスデータが大きいため遅延読み込みで分離する。
 * デプロイ直後は旧ハッシュのチャンクが404になり得るため、一度だけリロードして復旧する */
const LicenseCardPage = lazy(() =>
  import("./pages/LicenseCardPage.js")
    .then((m) => ({ default: m.LicenseCardPage }))
    .catch((e) => {
      const KEY = "eventer:chunk-reloaded";
      if (!sessionStorage.getItem(KEY)) {
        sessionStorage.setItem(KEY, "1");
        window.location.reload();
      }
      throw e;
    }),
);

/** QR受付 (#154)。カメラ読み取り＋jsQR フォールバックが大きいため遅延読み込みで分離する */
const CheckinPage = lazy(() =>
  import("./pages/CheckinPage.js").then((m) => ({ default: m.CheckinPage })),
);

/** 名札の一括印刷 (#304)。カード描画（QR生成・背景パターン）が大きいため遅延読み込みで分離する */
const NameCardPrintPage = lazy(() =>
  import("./pages/NameCardPrintPage.js").then((m) => ({
    default: m.NameCardPrintPage,
  })),
);

/** 動画エンコードの実機計測 (#408)。新端末の検証用に維持。
 * ナビには載せず URL 直打ちのみ。
 * 変換ライブラリ（mediabunny）が大きいため遅延読み込みで分離する */
const DevVideoEncodePage = lazy(() =>
  import("./pages/DevVideoEncodePage.js").then((m) => ({
    default: m.DevVideoEncodePage,
  })),
);

/** 遅延読み込みページ共通のフォールバック */
function LazyFallback() {
  return (
    <Box sx={{ display: "grid", placeItems: "center", minHeight: "40vh" }}>
      <CircularProgress />
    </Box>
  );
}

/** 遅延読み込みページ共通のフォールバック付きラッパー */
function LicenseCardRoute() {
  return (
    <Suspense fallback={<LazyFallback />}>
      <LicenseCardPage />
    </Suspense>
  );
}

function CheckinRoute() {
  return (
    <Suspense fallback={<LazyFallback />}>
      <CheckinPage />
    </Suspense>
  );
}

function NameCardPrintRoute() {
  return (
    <Suspense fallback={<LazyFallback />}>
      <NameCardPrintPage />
    </Suspense>
  );
}

/** ログイン前に控えた戻り先（/login?next=…）へ、ログイン後に一度だけ遷移する。
 * 外部サイトへの踏み台にされないよう、同一オリジンのパスだけを通す */
function PostLoginRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    const next = localStorage.getItem("postLoginRedirect");
    if (!next) return;
    localStorage.removeItem("postLoginRedirect");
    const safe = safeRedirectPath(next);
    if (safe) navigate(safe, { replace: true });
  }, [navigate]);
  return null;
}

export function App() {
  const { data: user, isLoading } = useMe();
  const pendingDeletion = usePendingDeletion();

  if (isLoading) {
    return (
      <Box sx={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
        <CircularProgress />
      </Box>
    );
  }

  // 退会申請中（猶予期間 #250）のアカウントでログインした場合は、
  // どのURLに居ても復帰画面だけを出す（他の画面はサーバー側でも使えない）
  if (pendingDeletion) {
    return <AccountRestorePage pending={pendingDeletion} />;
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
          path="/requests"
          element={
            <PublicLayout>
              <EventRequestsPage />
            </PublicLayout>
          }
        />
        <Route
          path="/requests/:id"
          element={
            <PublicLayout>
              <EventRequestDetailPage />
            </PublicLayout>
          }
        />
        <Route
          path="/venues"
          element={
            <PublicLayout>
              <VenuesPage />
            </PublicLayout>
          }
        />
        <Route
          path="/venues/:id"
          element={
            <PublicLayout>
              <VenueDetailPage />
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
          path="/users/:id/card"
          element={
            <PublicLayout>
              <LicenseCardRoute />
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
          path="/c/:slug/members"
          element={
            <PublicLayout>
              <CommunityMembersPage />
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
        <Route
          path="/r/:slug"
          element={
            <PublicLayout>
              <ShortRequestPage />
            </PublicLayout>
          }
        />
        {/* QRを読み取った先 (#330)。未ログインならログインへ送り、
            ログイン後にこのURLへ戻ってから記録する */}
        <Route
          path="/m/:token"
          element={
            <PublicLayout>
              <MeetScanPage />
            </PublicLayout>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  // 自分のプロフィールページ。マイページの転送先でもある (#319)
  const myPath = `/users/${encodeURIComponent(user.username)}`;

  return (
    <Layout user={user}>
      <PostLoginRedirect />
      <Routes>
        <Route path="/" element={<PublicEventsPage />} />
        {/* マイページは自分のプロフィールページに統合した (#319)。
            既存のリンクやブックマークが死なないよう転送だけ残す */}
        <Route path="/me" element={<Navigate to={myPath} replace />} />
        <Route path="/following" element={<FollowingPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        {/* 運営への招待 (#339)。承諾するまでイベントページは開けないのでここで返事する */}
        <Route path="/staff-invites" element={<StaffInvitesPage />} />
        {/* 動画エンコード計測 (#408)。検証用に維持。ログイン必須・URL直打ちのみ */}
        <Route
          path="/dev/video-encode"
          element={
            <Suspense fallback={<LazyFallback />}>
              <DevVideoEncodePage />
            </Suspense>
          }
        />
        <Route path="/inquiries" element={<InquiriesPage />} />
        <Route path="/inquiries/:id" element={<InquiryThreadPage />} />
        <Route path="/admin/inquiries" element={<AdminInquiriesPage />} />
        <Route path="/admin/stats" element={<AdminStatsPage />} />
        <Route path="/admin/kpi" element={<AdminKpiPage />} />
        <Route path="/admin/trending" element={<AdminTrendingPage />} />
        <Route path="/admin/settings" element={<AdminSettingsPage />} />
        <Route path="/admin/audit-logs" element={<AdminAuditPage />} />
        <Route path="/admin/abuse" element={<AdminAbusePage />} />
        <Route path="/admin/moderation" element={<AdminModerationPage />} />
        <Route path="/admin/inquiries/:id" element={<AdminInquiryThreadPage />} />
        <Route path="/privacy" element={<PrivacyPolicyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/users/:id" element={<UserProfilePage />} />
        <Route path="/users/:id/card" element={<LicenseCardRoute />} />
        {/* QRを読み取った先 (#330)。開いた時点でその場で記録する */}
        <Route path="/m/:token" element={<MeetScanPage />} />
        <Route path="/communities" element={<CommunitiesPage />} />
        <Route path="/communities/new" element={<CreateCommunityPage />} />
        <Route path="/c/:slug" element={<CommunityPage />} />
        <Route path="/c/:slug/members" element={<CommunityMembersPage />} />
        <Route path="/c/:slug/edit" element={<CommunityEditPage />} />
        {/* コミュニティ別KPI (#262)。管理者・運営管理者のみ（ページ側でも判定） */}
        <Route path="/c/:slug/kpi" element={<CommunityKpiPage />} />
        <Route path="/decks" element={<DecksPage />} />
        <Route path="/decks/:id/edit" element={<DeckEditorPage />} />
        <Route path="/live-sets" element={<LiveSetsPage />} />
        <Route path="/live-sets/:id/edit" element={<LiveSetEditorPage />} />
        <Route path="/d/:slug" element={<DeckViewerPage />} />
        <Route path="/e/:slug" element={<ShortEventPage />} />
        <Route path="/r/:slug" element={<ShortRequestPage />} />
        {/* 旧 /events はトップに統合 (#165)。ブックマーク互換のためリダイレクト */}
        <Route path="/events" element={<Navigate to="/" replace />} />
        <Route path="/events/upcoming" element={<UpcomingEventsPage />} />
        <Route path="/requests" element={<EventRequestsPage />} />
        <Route path="/requests/new" element={<EventRequestNewPage />} />
        <Route path="/requests/:id" element={<EventRequestDetailPage />} />
        <Route path="/venues" element={<VenuesPage />} />
        <Route path="/venues/new" element={<VenueFormPage />} />
        <Route path="/venues/:id" element={<VenueDetailPage />} />
        <Route path="/venues/:id/edit" element={<VenueFormPage />} />
        <Route path="/events/new" element={<CreateEventPage />} />
        {/* 配信画面/コントロール（EventLayoutのモード強制遷移を受けない） */}
        <Route path="/events/:id/live/screen" element={<LiveScreenPage />} />
        <Route path="/events/:id/live/control" element={<LiveControlPage />} />
        {/* QR受付。カメラ使用中に余計な再描画やSSE購読を避けるため EventLayout の外に置く */}
        <Route path="/events/:id/checkin" element={<CheckinRoute />} />
        {/* 名札の一括印刷 (#304)。印刷用の面付けを邪魔しないよう EventLayout の外に置く */}
        <Route path="/events/:id/name-cards" element={<NameCardPrintRoute />} />
        {/* チャット専用ページ (#215)。リレー接続を維持するため EventLayout の外 */}
        <Route path="/events/:id/chat" element={<EventChatPage />} />
        {/* 投影用画面 (#215)。配信画面と同じくモード強制遷移を受けない位置に置く */}
        <Route path="/events/:id/chat/screen" element={<EventChatScreenPage />} />
        {/* 出会いランキングの投影 (#418)。同じくモード強制遷移を受けない位置 */}
        <Route
          path="/events/:id/meet-ranking/screen"
          element={<MeetRankingScreenPage />}
        />
        {/* ビンゴの投影 (#436)。同じくモード強制遷移を受けない位置 */}
        <Route path="/events/:id/bingo/screen" element={<EventBingoScreenPage />} />
        {/* スタッフチャット (#382)。リレー接続を維持するため EventLayout の外 */}
        <Route path="/events/:id/staff-chat" element={<StaffChatPage />} />
        <Route path="/events/:id" element={<EventLayout />}>
          <Route index element={<EventDetailPage />} />
          <Route path="edit" element={<EditEventPage />} />
          <Route path="scoring" element={<ScoringPage />} />
          <Route path="present" element={<PresentPage />} />
          <Route path="awards" element={<AwardsPage />} />
          <Route path="control" element={<ControlPage />} />
          <Route path="stats" element={<EventStatsPage />} />
          {/* マルチトラックのタイムテーブル (#338)。導線はトラックが2本以上のときだけ出る */}
          <Route path="timetable" element={<EventTimetablePage />} />
          <Route path="criteria" element={<CriteriaAdminPage />} />
          <Route path="results" element={<ScoreResultsPage />} />
          <Route path="lottery" element={<LotteryAdminPage />} />
          {/* 参加者への一斉連絡 (#172)。スタッフ専用 */}
          <Route path="broadcast" element={<EventBroadcastPage />} />
          {/* 準備の段取り (#393)。スタッフ専用 */}
          <Route path="todos" element={<EventTodoPage />} />
          {/* 役割と持ち場 (#384)。スタッフ専用 */}
          <Route path="staffing" element={<EventStaffingPage />} />
          {/* 景品の引き換えデスク (#431)。スタッフ専用 */}
          <Route path="prize-desk" element={<EventPrizeDeskPage />} />
          {/* 数字ビンゴ (#436)。カードは確定メンバー・抽選コントロールはスタッフ専用 */}
          <Route path="bingo" element={<EventBingoPage />} />
          <Route path="bingo/control" element={<EventBingoControlPage />} />
        </Route>
        <Route path="*" element={<Navigate to={myPath} replace />} />
      </Routes>
    </Layout>
  );
}
