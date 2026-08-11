import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { MyStaffInvite } from "@eventer/shared";

/**
 * 運営への招待 (#339) の受け取り側。
 *
 * 承諾するまでイベントページは開けないので、この画面には**判断に要るものだけ**
 * （題名・開催日時・招待した人）が出て、承諾/辞退の両方が選べることを確かめる。
 */

const { getMock, postMock, navigateMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  navigateMock: vi.fn(),
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

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});

const { StaffInvitesPage } = await import("./StaffInvitesPage.js");

const START = Date.parse("2026-09-01T10:00:00+09:00");

function invite(over: Partial<MyStaffInvite> = {}): MyStaffInvite {
  return {
    id: "inv-1",
    eventId: "e-1",
    eventTitle: "秋のハッカソン",
    eventStartsAt: START,
    eventEndsAt: START + 8 * 3600_000,
    eventPublished: false,
    holdsSlot: false,
    invitedBy: {
      id: "u-owner",
      discordId: "d-owner",
      username: "kojira",
      globalName: "こじら",
      avatarUrl: null,
      createdAt: 0,
    },
    createdAt: START - 86400_000,
    ...over,
  };
}

function draw() {
  const qc = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <StaffInvitesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  navigateMock.mockReset();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("運営への招待の受け取り (#339)", () => {
  it("誰からの・どのイベントの招待かが分かり、公開前だと分かる", async () => {
    getMock.mockResolvedValue({ invites: [invite()] });
    draw();
    expect(await screen.findByText("秋のハッカソン")).toBeTruthy();
    expect(screen.getByText("公開前")).toBeTruthy();
    expect(screen.getByText("こじら さんからの招待")).toBeTruthy();
  });

  it("承諾するとイベントページへ進む", async () => {
    getMock.mockResolvedValue({ invites: [invite()] });
    postMock.mockResolvedValue({ eventId: "e-1" });
    draw();
    fireEvent.click(await screen.findByText("承諾して運営になる"));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/me/staff-invites/inv-1/accept"),
    );
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/events/e-1"));
  });

  it("断れる（確認を挟む。イベントページへは進まない）", async () => {
    getMock.mockResolvedValue({ invites: [invite()] });
    postMock.mockResolvedValue({ ok: true });
    draw();
    fireEvent.click(await screen.findByText("断る"));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/me/staff-invites/inv-1/decline"),
    );
    expect(window.confirm).toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("参加枠を押さえている人には、承諾で枠が外れることを警告する", async () => {
    getMock.mockResolvedValue({ invites: [invite({ holdsSlot: true })] });
    draw();
    expect(await screen.findByText(/いま押さえている参加枠は外れます/)).toBeTruthy();
  });

  it("枠を持っていなくても、枠が外れる旨の断りは常に出す", async () => {
    getMock.mockResolvedValue({ invites: [invite()] });
    draw();
    expect(
      await screen.findByText(/すでに参加を申し込んでいる場合、参加枠は外れて/),
    ).toBeTruthy();
    expect(screen.queryByText(/いま押さえている参加枠は外れます/)).toBeNull();
  });

  it("日程調整中は「開催日時は調整中」と出す", async () => {
    getMock.mockResolvedValue({
      invites: [invite({ eventStartsAt: 0, eventEndsAt: 0 })],
    });
    draw();
    expect(await screen.findByText("開催日時は調整中")).toBeTruthy();
  });

  it("返事待ちが無ければその旨を出す", async () => {
    getMock.mockResolvedValue({ invites: [] });
    draw();
    expect(await screen.findByText("返事待ちの招待はありません。")).toBeTruthy();
  });
});
