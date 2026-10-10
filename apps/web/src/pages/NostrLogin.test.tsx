import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Nostr でログイン・連携の入口 (D-NOSTR-SIGNER)。
 *
 * - 拡張（NIP-07）があれば今まで通りその場で署名する（シートは出さない）
 * - 無ければ署名アプリ（Amber など）でつなぐシートを開く。アカウント設定の連携も同じ
 * - お題への署名と送信（signLoginChallenge）は、どの署名器でも同じ形
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

// シートはリレーにつなぐので、ここでは開いたかどうかだけを見る
vi.mock("../components/NostrConnectSheet.js", () => ({
  NostrConnectSheet: ({ title }: { title: string }) => (
    <div role="dialog" aria-label={title} />
  ),
}));

const { LoginPage } = await import("./LoginPage.js");
const { AccountPage } = await import("./AccountPage.js");
const { signLoginChallenge } = await import("../lib/nostr.js");

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset().mockResolvedValue({});
  getMock.mockImplementation((path: string) => {
    if (path === "/auth/providers") return Promise.resolve({ providers: ["discord"] });
    if (path === "/auth/identities") return Promise.resolve({ identities: [] });
    if (path === "/auth/me") return Promise.resolve({ user: { id: "u-1", username: "tester" } });
    if (path === "/auth/nostr/challenge") return Promise.resolve({ challenge: "c-1" });
    return Promise.resolve({});
  });
  vi.stubGlobal("WebSocket", undefined);
});

afterEach(() => {
  delete (window as { nostr?: unknown }).nostr;
  vi.unstubAllGlobals();
});

describe("signLoginChallenge", () => {
  it("お題を取り、22242 に署名してもらってサーバーへ送る", async () => {
    const signed = { kind: 22242, id: "e" };
    const sign = vi.fn().mockResolvedValue(signed);
    await signLoginChallenge(sign);
    expect(sign).toHaveBeenCalledWith({
      kind: 22242,
      created_at: expect.any(Number),
      tags: [
        ["relay", window.location.origin],
        ["challenge", "c-1"],
      ],
      content: "events lab にログイン",
    });
    expect(postMock).toHaveBeenCalledWith("/auth/nostr/login", { event: signed });
  });
});

describe("ログイン画面の「Nostr でログイン」", () => {
  it("拡張が無ければ署名アプリのシートを開き、案内に秘密鍵が要らないことを書く", async () => {
    renderWithProviders(<LoginPage />);
    expect(
      screen.getByText(
        "ブラウザ拡張機能（Alby、nos2x など）か、Amber などの署名アプリでログインできます。秘密鍵を入力する必要はありません。",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Nostr でログイン" }));
    expect(await screen.findByRole("dialog", { name: "署名アプリでログイン" })).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  it("拡張があれば今まで通り拡張で署名し、シートは出さない", async () => {
    const signEvent = vi.fn().mockResolvedValue({ kind: 22242 });
    (window as { nostr?: unknown }).nostr = { getPublicKey: vi.fn(), signEvent };
    renderWithProviders(<LoginPage />);
    fireEvent.click(screen.getByRole("button", { name: "Nostr でログイン" }));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/auth/nostr/login", { event: { kind: 22242 } }),
    );
    expect(signEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 22242 }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("アカウント設定の Nostr 連携", () => {
  it("拡張が無ければ同じシートを連携用の見出しで開く", async () => {
    renderWithProviders(<AccountPage />);
    const row = (await screen.findByText("Nostr")).closest("div")!.parentElement!;
    const link = Array.from(row.querySelectorAll("button")).find(
      (b) => b.textContent === "連携する",
    )!;
    fireEvent.click(link);
    expect(await screen.findByRole("dialog", { name: "署名アプリで連携" })).toBeInTheDocument();
  });
});
