import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

/**
 * アカウント設定の「プロフィールに表示する」(docs/profile-social-links.md)。
 * 連携している・リンクを出せる連携先にだけスイッチが出て、押すと本人の連携1件を
 * 切り替える API を呼ぶ。リンクを作れない（名前がまだ分からない）連携はオンにできない。
 */

const { getMock, putMock } = vi.hoisted(() => ({ getMock: vi.fn(), putMock: vi.fn() }));

vi.mock("../api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client.js")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      get: (...args: unknown[]) => getMock(...args),
      put: (...args: unknown[]) => putMock(...args),
    },
  };
});

const { AccountPage } = await import("./AccountPage.js");

let identities: unknown[] = [];

beforeEach(() => {
  getMock.mockReset();
  putMock.mockReset();
  putMock.mockResolvedValue({ ok: true });
  getMock.mockImplementation((path: string) => {
    if (path === "/auth/providers") return Promise.resolve({ providers: ["github", "google"] });
    if (path === "/auth/identities") return Promise.resolve({ identities });
    if (path === "/auth/me") return Promise.resolve({ user: { id: "u-1", username: "tester" } });
    return Promise.resolve({});
  });
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AccountPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("アカウント設定: 連携アカウントをプロフィールに表示する", () => {
  it("リンクを出せる連携にだけスイッチが出て、既定はオフ。押すとオンにする API を呼ぶ", async () => {
    identities = [
      {
        provider: "github",
        email: null,
        profilePublic: false,
        profileLink: { provider: "github", url: "https://github.com/octo-cat", label: "@octo-cat" },
      },
      { provider: "google", email: "g@example.com", profilePublic: false, profileLink: null },
    ];
    renderPage();
    const sw = await screen.findByRole("checkbox", { name: "GitHub: プロフィールに表示する" });
    expect(sw).not.toBeChecked();
    // 何が公開されるかを押す前に見せる
    expect(screen.getByRole("link", { name: "@octo-cat" }).getAttribute("href")).toBe("https://github.com/octo-cat");
    // Google にはスイッチが無い
    expect(screen.queryByRole("checkbox", { name: "Google: プロフィールに表示する" })).toBeNull();

    fireEvent.click(sw);
    await waitFor(() =>
      expect(putMock).toHaveBeenCalledWith("/auth/identities/github/profile-public", { profilePublic: true }),
    );
  });

  it("名前がまだ分からない連携はオンにできず、理由を出す", async () => {
    identities = [{ provider: "github", email: null, profilePublic: false, profileLink: null }];
    renderPage();
    const sw = await screen.findByRole("checkbox", { name: "GitHub: プロフィールに表示する" });
    expect(sw).toBeDisabled();
    expect(screen.getByText(/アカウント名がまだ分からないため/)).toBeInTheDocument();
  });

  it("オンの連携はスイッチがオンで、押すとオフにする", async () => {
    identities = [
      {
        provider: "github",
        email: null,
        profilePublic: true,
        profileLink: { provider: "github", url: "https://github.com/octo-cat", label: "@octo-cat" },
      },
    ];
    renderPage();
    const sw = await screen.findByRole("checkbox", { name: "GitHub: プロフィールに表示する" });
    expect(sw).toBeChecked();
    fireEvent.click(sw);
    await waitFor(() =>
      expect(putMock).toHaveBeenCalledWith("/auth/identities/github/profile-public", { profilePublic: false }),
    );
  });
});
