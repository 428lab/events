import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../api/client.js";
import { EventInquiryButton } from "../components/EventInquiryButton.js";
import { EventManagementLinks } from "../components/EventManagementLinks.js";
import { EventInquiriesPage, EventInquiryThreadPage } from "./EventInquiriesPage.js";
import { InquiriesPage } from "./InquiriesPage.js";
import { InquiryThreadPage } from "./InquiryThreadPage.js";

// D-EVENT-CONTACT: real pages and query hooks; only the HTTP boundary is replaced.
let me: unknown;
let role: string | null;
beforeEach(() => {
  vi.restoreAllMocks();
  me = { user: { id: "me", username: "me" }, isAdmin: true };
  role = "staff";
  vi.spyOn(api, "get").mockImplementation(async (path) => {
    if (path === "/auth/me") {
      if (!me) throw new ApiError(401, { error: "unauthorized" });
      return me as never;
    }
    if (path === "/events/e") return { event: { id: "e", title: "夏の発表会", status: "published" }, myRole: role } as never;
    if (path === "/events/e/inquiries/unread-count") return { count: 2 } as never;
    // サーバーはイベント配下の一覧に event を付けない（ページ自体がそのイベント）
    if (path === "/events/e/inquiries") return { inquiries: [
      { id: "q1", subject: "", status: "open", createdAt: 1, lastMessageAt: 1, lastSender: "user", unread: true,
        event: null, userId: "u", userHandle: "taro", userName: "太郎", userAvatarUrl: null },
    ] } as never;
    if (path === "/events/e/inquiries/q1") return {
      id: "q1", subject: "", status: "answered", event: { id: "e", title: "夏の発表会" },
      userId: "u", userHandle: "taro", userName: "太郎", userAvatarUrl: null,
      messages: [
        { id: "m1", sender: "user", body: "駐車場はありますか", createdAt: 1 },
        { id: "m2", sender: "staff", body: "あります", createdAt: 2 },
      ],
    } as never;
    if (path === "/inquiries") return { inquiries: [
      { id: "q1", subject: "", status: "closed", createdAt: 1, lastMessageAt: 1, lastSender: "staff", unread: false,
        event: { id: "e", title: "夏の発表会" } },
      { id: "q2", subject: "退会について", status: "open", createdAt: 1, lastMessageAt: 1, lastSender: "user", unread: false, event: null },
    ] } as never;
    if (path === "/inquiries/q1") return {
      id: "q1", subject: "", status: "answered", event: { id: "e", title: "夏の発表会" },
      messages: [
        { id: "m1", sender: "user", body: "駐車場はありますか", createdAt: 1 },
        { id: "m2", sender: "staff", body: "あります", createdAt: 2 },
      ],
    } as never;
    throw new Error(`Unexpected GET ${path}`);
  });
  vi.spyOn(api, "post").mockResolvedValue({ id: "q9" } as never);
});

function draw(path: string, routes: { path: string; element: JSX.Element }[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}>
    <Routes>
      {routes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
      <Route path="/inquiries/:id" element={<p>thread page</p>} />
      <Route path="/login" element={<p>login page</p>} />
    </Routes>
  </MemoryRouter></QueryClientProvider>);
}

describe("EventInquiryButton", () => {
  const routes = (isStaff: boolean) => [{ path: "/events/:id", element: <EventInquiryButton eventId="e" isStaff={isStaff} /> }];

  it("sends an optional subject and body to the event, then opens the thread", async () => {
    role = null;
    draw("/events/e", routes(false));
    fireEvent.click(await screen.findByRole("button", { name: "主催者に問い合わせる" }));
    const dialog = await screen.findByRole("dialog", { name: "主催者への問い合わせ" });
    const send = within(dialog).getByRole("button", { name: "送る" });
    expect(send).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("問い合わせ内容"), { target: { value: " 駐車場は？ " } });
    fireEvent.click(send);
    await screen.findByText("thread page");
    expect(api.post).toHaveBeenCalledWith("/events/e/inquiries", { subject: "", body: "駐車場は？" });
  });

  it("explains the open-inquiry limit", async () => {
    vi.mocked(api.post).mockRejectedValue(new ApiError(429, { error: "event_inquiry_limit", limit: 3 }));
    draw("/events/e", routes(false));
    fireEvent.click(await screen.findByRole("button", { name: "主催者に問い合わせる" }));
    fireEvent.change(await screen.findByLabelText("問い合わせ内容"), { target: { value: "質問" } });
    fireEvent.click(screen.getByRole("button", { name: "送る" }));
    expect(await screen.findByText(/未完了の問い合わせが多すぎます/)).toBeInTheDocument();
  });

  it("asks logged-out visitors to log in and come back to the event", async () => {
    me = null;
    draw("/events/e", routes(false));
    expect(await screen.findByRole("link", { name: "ログインして問い合わせる" }))
      .toHaveAttribute("href", "/login?next=/events/e");
  });

  it("is not shown to the event's staff, who receive inquiries", async () => {
    const { container } = draw("/events/e", routes(true));
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

describe("sender side", () => {
  it("lists event inquiries with the event, the title fallback and the real closed chip (#359)", async () => {
    draw("/inquiries", [{ path: "/inquiries", element: <InquiriesPage /> }]);
    const eventRow = (await screen.findByText("イベント: 夏の発表会")).closest("a")!;
    expect(within(eventRow).getByText("夏の発表会")).toBeInTheDocument();
    expect(within(eventRow).getByText("クローズ")).toBeInTheDocument();
    const operatorRow = screen.getByText("退会について").closest("a")!;
    expect(within(operatorRow).getByText("対応中")).toBeInTheDocument();
    expect(within(operatorRow).queryByText(/イベント:/)).toBeNull();
  });

  it("shows the event header and labels staff replies as the organizer", async () => {
    draw("/inquiries/q1", [{ path: "/inquiries/:id", element: <InquiryThreadPage /> }]);
    expect(await screen.findByRole("link", { name: "夏の発表会 の主催者への問い合わせ" })).toHaveAttribute("href", "/events/e");
    expect(screen.getByText(/^主催者 ・ /)).toBeInTheDocument();
    expect(screen.getByText(/^あなた ・ /)).toBeInTheDocument();
  });
});

describe("organizer side", () => {
  it("lists the event's inquiries for confirmed staff", async () => {
    draw("/events/e/inquiries", [{ path: "/events/:id/inquiries", element: <EventInquiriesPage /> }]);
    const row = (await screen.findByText("太郎", { exact: false })).closest("a")!;
    expect(row).toHaveAttribute("href", "/events/e/inquiries/q1");
    expect(within(row).getByText("夏の発表会")).toBeInTheDocument();
    expect(within(row).getByText("対応中")).toBeInTheDocument();
  });

  it.each([null, "participant"])("denies %s (including site admin) without fetching inquiries", async (value) => {
    role = value;
    draw("/events/e/inquiries", [{ path: "/events/:id/inquiries", element: <EventInquiriesPage /> }]);
    await screen.findByText("このページはイベントのスタッフだけが使えます。");
    expect(vi.mocked(api.get).mock.calls.some(([p]) => p.includes("/inquiries"))).toBe(false);
  });

  it("replies as staff and marks the inquiry done", async () => {
    draw("/events/e/inquiries/q1", [{ path: "/events/:id/inquiries/:inquiryId", element: <EventInquiryThreadPage /> }]);
    expect(await screen.findByText("駐車場はありますか")).toBeInTheDocument();
    // スタッフ全員で受け持つので、スタッフの発言は誰が見ても「主催者」。問い合わせた人は名前で出る
    expect(screen.getByText(/^主催者 ・ /)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "太郎" })).toHaveAttribute("href", "/users/taro");
    fireEvent.change(screen.getByPlaceholderText("返信を入力…"), { target: { value: "ご案内します" } });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/events/e/inquiries/q1/messages", { body: "ご案内します" }));
    fireEvent.click(screen.getByRole("button", { name: "完了にする" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/events/e/inquiries/q1/close", {}));
  });

  it("management links show the inquiries entry with its unread badge", async () => {
    draw("/events/e/manage", [{ path: "/events/:id/manage", element:
      <EventManagementLinks eventId="e" isStaff attendanceCheck={false} chatAvailable={false} /> }]);
    const link = await screen.findByRole("link", { name: "問い合わせ" });
    expect(link).toHaveAttribute("href", "/events/e/inquiries");
    expect(await screen.findByText("2")).toBeInTheDocument();
  });
});
