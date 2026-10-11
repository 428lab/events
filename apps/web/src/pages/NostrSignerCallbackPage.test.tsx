import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client.js";

/**
 * Amber（NIP-55）で署名して戻ってくるページ `/login/nostr-signer` (D-NOSTR-SIGNER PR-B)。
 * 署名済みのお題を URL から読み、URL から消して、サーバーに送って移る。
 */
const { submitMock } = vi.hoisted(() => ({ submitMock: vi.fn() }));
vi.mock("../lib/nostr.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/nostr.js")>();
  return {
    ...actual,
    submitSignedLoginEvent: (...a: unknown[]) => submitMock(...a),
  };
});

const { NostrSignerCallbackPage } = await import("./NostrSignerCallbackPage.js");
const { NOSTR_SIGNER_INTENT_KEY } = await import("../lib/nostrSignerLogin.js");

const SIGNED = {
  id: "e".repeat(64),
  pubkey: "ab".repeat(32),
  created_at: 1,
  kind: 22242,
  tags: [["challenge", "c"]],
  content: "events lab にログイン",
  sig: "cd".repeat(64),
};

const replaceMock = vi.fn();
const originalLocation = window.location;

/** 戻り先の URL を開いた状態にする（replace だけ見張る） */
function openCallback(hash: string) {
  window.history.replaceState(null, "", `/login/nostr-signer${hash}`);
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      origin: originalLocation.origin,
      get pathname() {
        return originalLocation.pathname;
      },
      get search() {
        return originalLocation.search;
      },
      get hash() {
        return originalLocation.hash;
      },
      replace: replaceMock,
    },
  });
}

beforeEach(() => {
  localStorage.clear();
  submitMock.mockReset();
  replaceMock.mockReset();
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
  window.history.replaceState(null, "", "/");
});

describe("NostrSignerCallbackPage", () => {
  it("署名済みのお題を送り、URL から消し、控えた戻り先へ移って控えを消す", async () => {
    submitMock.mockResolvedValue(undefined);
    localStorage.setItem("postLoginRedirect", "/events/abc");
    localStorage.setItem(NOSTR_SIGNER_INTENT_KEY, "login");
    openCallback(`#${encodeURIComponent(JSON.stringify(SIGNED))}`);

    render(<NostrSignerCallbackPage />);
    expect(screen.getByText("ログインしています…")).toBeInTheDocument();
    expect(originalLocation.hash).toBe("");
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/events/abc"));
    expect(submitMock).toHaveBeenCalledTimes(1);
    expect(submitMock).toHaveBeenCalledWith(SIGNED);
    expect(localStorage.getItem("postLoginRedirect")).toBeNull();
    expect(localStorage.getItem(NOSTR_SIGNER_INTENT_KEY)).toBeNull();
  });

  it("戻り先が無ければ /me へ。外部の URL は使わない", async () => {
    submitMock.mockResolvedValue(undefined);
    localStorage.setItem("postLoginRedirect", "https://evil.example/");
    openCallback(`#${encodeURIComponent(JSON.stringify(SIGNED))}`);

    render(<NostrSignerCallbackPage />);
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/me"));
  });

  it("連携なら /account に戻す", async () => {
    submitMock.mockResolvedValue(undefined);
    localStorage.setItem(NOSTR_SIGNER_INTENT_KEY, "link");
    localStorage.setItem("postLoginRedirect", "/events/abc");
    openCallback(`#${encodeURIComponent(JSON.stringify(SIGNED))}`);

    render(<NostrSignerCallbackPage />);
    expect(screen.getByText("連携しています…")).toBeInTheDocument();
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/account"));
    // 連携は戻り先の控えに触らない（ログインのためのもの）
    expect(localStorage.getItem("postLoginRedirect")).toBe("/events/abc");
  });

  it("連携で引き取りを断られた (409) ら、アカウント設定のいつものモーダルで説明する", async () => {
    submitMock.mockRejectedValue(new ApiError(409, { error: "account_in_use" }));
    localStorage.setItem(NOSTR_SIGNER_INTENT_KEY, "link");
    openCallback(`#${encodeURIComponent(JSON.stringify(SIGNED))}`);

    render(<NostrSignerCallbackPage />);
    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith("/account?link_error=account_in_use"),
    );
  });

  it("サーバーで弾かれたら、エラーとログイン画面に戻るリンクを出す", async () => {
    submitMock.mockRejectedValue(new ApiError(401, { error: "invalid_event" }));
    openCallback(`#${encodeURIComponent(JSON.stringify(SIGNED))}`);

    render(<NostrSignerCallbackPage />);
    expect(await screen.findByText("ログインに失敗しました。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ログイン画面に戻る" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("event が無い・壊れた JSON なら、何も送らずにエラーを出す", async () => {
    openCallback("#%7Bbroken");
    render(<NostrSignerCallbackPage />);
    expect(
      screen.getByText("署名アプリから署名を受け取れませんでした。もう一度お試しください。"),
    ).toBeInTheDocument();
    expect(originalLocation.hash).toBe("");
    await new Promise((r) => setTimeout(r, 0));
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("連携で event が無ければ、アカウント設定に戻るリンクを出す", () => {
    localStorage.setItem(NOSTR_SIGNER_INTENT_KEY, "link");
    openCallback("");
    render(<NostrSignerCallbackPage />);
    expect(screen.getByRole("link", { name: "アカウント設定に戻る" })).toHaveAttribute(
      "href",
      "/account",
    );
    expect(submitMock).not.toHaveBeenCalled();
  });
});
