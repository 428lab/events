import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  NOTIFICATION_PAGE_SIZE,
  type Notification,
  type NotificationsPayload,
} from "@eventer/shared";

/**
 * お知らせの一覧 (#294)。
 *
 * これまで受け取った連絡は通知ベルのドロップダウンでしか読めず、閉じると
 * 読み直せなかった。一斉連絡 (#172) の本文は最大2000字あるので、この画面で
 * 「最後まで読める」ことと「既読／未読が分かる」ことが要点。
 */

const { getMock, postMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
}));

vi.mock("../api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client.js")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      get: (...args: unknown[]) => getMock(...args),
      post: (...args: unknown[]) => postMock(...args),
    },
  };
});

const { NotificationsPage } = await import("./NotificationsPage.js");

const notification = (over: Partial<Notification> = {}): Notification => ({
  id: "n-1",
  type: "info",
  title: "お知らせ",
  body: "",
  link: "",
  read: true,
  createdAt: 1_700_000_000_000,
  ...over,
});

/** 一斉連絡の本文。ドロップダウンでは読み切れない長さ・改行つき */
const LONG_BODY = `会場が変更になりました。\n新しい会場は駅前ビル5Fです。\n${"詳細な案内。".repeat(200)}末尾まで表示`;

function payload(
  notifications: Notification[],
  over: Partial<NotificationsPayload> = {},
): NotificationsPayload {
  return {
    notifications,
    total: notifications.length,
    page: 1,
    limit: NOTIFICATION_PAGE_SIZE,
    ...over,
  };
}

/** API のモック。unread-count と一覧を出し分ける */
function mockApi(pages: Record<number, NotificationsPayload>, unread = 0): void {
  getMock.mockImplementation((path: string) => {
    if (path.startsWith("/notifications/unread-count")) {
      return Promise.resolve({ count: unread });
    }
    const page = Number(new URL(path, "https://x").searchParams.get("page") ?? 1);
    return Promise.resolve(pages[page] ?? payload([]));
  });
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <NotificationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  postMock.mockResolvedValue({ ok: true });
});

describe("お知らせ一覧 (#294)", () => {
  it("一斉連絡の本文が途中で切られずに出る", async () => {
    mockApi({
      1: payload([
        notification({
          type: "event_broadcast",
          title: "【重要】会場変更のお知らせ",
          body: LONG_BODY,
          link: "/events/e-1",
        }),
      ]),
    });
    renderPage();

    expect(await screen.findByText("【重要】会場変更のお知らせ")).toBeTruthy();
    // 本文の要素そのものに全文が入っている（末尾まで読める）
    const body = await screen.findByText(/会場が変更になりました/);
    expect(body.textContent).toBe(LONG_BODY);
    expect(body.textContent).toContain("末尾まで表示");
    // 改行を潰さない
    expect(getComputedStyle(body).whiteSpace).toBe("pre-wrap");
    // 種別が分かる
    expect(screen.getByText("イベントからの連絡")).toBeTruthy();
  });

  it("未読は未読と分かり、既読にできる", async () => {
    mockApi(
      {
        1: payload([
          notification({ id: "n-unread", title: "未読の連絡", read: false }),
          notification({ id: "n-read", title: "既読の連絡", read: true }),
        ]),
      },
      1,
    );
    renderPage();

    expect(await screen.findByText("未読の連絡")).toBeTruthy();
    // 未読の1件だけに印がつく
    expect(screen.getAllByText("未読")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "既読にする" }));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/notifications/n-unread/read", {}),
    );
  });

  it("すべて既読は未読があるときだけ出る", async () => {
    mockApi({ 1: payload([notification({ read: true })]) }, 0);
    const { unmount } = renderPage();
    expect(await screen.findByText("お知らせ")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "すべて既読" })).toBeNull();
    unmount();

    mockApi({ 1: payload([notification({ read: false })]) }, 1);
    renderPage();
    const all = await screen.findByRole("button", { name: "すべて既読" });
    fireEvent.click(all);
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/notifications/read-all", {}),
    );
  });

  it("遷移先が無い通知には開くボタンを出さない", async () => {
    mockApi({
      1: payload([
        notification({
          title: "会場写真は見送られました",
          body: "公開されませんでした",
          link: "",
          read: true,
        }),
      ]),
    });
    renderPage();

    expect(await screen.findByText("会場写真は見送られました")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "開く" })).toBeNull();
  });

  it("件数が1ページを超えるとページ送りが出て、次のページを取りに行く", async () => {
    const first = Array.from({ length: NOTIFICATION_PAGE_SIZE }, (_, i) =>
      notification({ id: `a-${i}`, title: `1ページ目の${i}` }),
    );
    const second = [notification({ id: "b-0", title: "2ページ目の通知" })];
    mockApi({
      1: payload(first, { total: NOTIFICATION_PAGE_SIZE + 1, page: 1 }),
      2: payload(second, { total: NOTIFICATION_PAGE_SIZE + 1, page: 2 }),
    });
    renderPage();

    expect(await screen.findByText("1ページ目の0")).toBeTruthy();
    expect(screen.getByText(`全 ${NOTIFICATION_PAGE_SIZE + 1} 件`)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Go to page 2" }));
    expect(await screen.findByText("2ページ目の通知")).toBeTruthy();
    expect(getMock).toHaveBeenCalledWith("/notifications?page=2");
  });

  it("1ページに収まるならページ送りは出ない", async () => {
    mockApi({ 1: payload([notification()]) });
    renderPage();
    expect(await screen.findByText("お知らせ")).toBeTruthy();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("通知が無いときは空であることを伝える", async () => {
    mockApi({ 1: payload([]) });
    renderPage();
    expect(await screen.findByText("お知らせはまだありません。")).toBeTruthy();
  });
});
