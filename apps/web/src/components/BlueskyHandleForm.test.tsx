import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { translations } from "@eventer/shared/i18n";
import { i18next, tDynamic } from "../i18n/index.js";
import {
  BLUESKY_LOGIN_PATH,
  BlueskyHandleForm,
  normalizeHandleInput,
} from "./BlueskyHandleForm.js";
import { blueskyErrorMessage } from "../lib/blueskyError.js";

/**
 * Bluesky のログイン・連携の画面 (#381)。
 *
 * 要点は3つ。**素のフォームの GET であること**（fetch にすると外部の許可画面へ
 * 行けない）、**内部用語を画面に出さないこと**、**日本語と英語で同じものが
 * 出ること**。入力補助（前後の空白・先頭の @・大文字）もここで固定する。
 */

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));

vi.mock("../api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client.js")>();
  return {
    ...actual,
    api: { ...actual.api, get: (...args: unknown[]) => getMock(...args) },
  };
});

const { LoginPage } = await import("../pages/LoginPage.js");
const { AccountPage } = await import("../pages/AccountPage.js");

/** 画面に出てはいけない内部の仕組みの呼び名（設計 12） */
const INTERNAL_TERMS = ["DID", "PDS", "DPoP", "PAR", "PKCE", "OAuth"];

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getMock.mockReset();
  getMock.mockImplementation((path: string) => {
    if (path === "/auth/providers") return Promise.resolve({ providers: ["discord"] });
    if (path === "/auth/identities") return Promise.resolve({ identities: [] });
    if (path === "/auth/me") {
      return Promise.resolve({ user: { id: "u-1", username: "tester" } });
    }
    return Promise.resolve({});
  });
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("ハンドルの入力補助 (#381)", () => {
  it("前後の空白を落とし、先頭の @ を落とし、小文字にする", () => {
    expect(normalizeHandleInput("  @Yourname.Bsky.Social  ")).toBe(
      "yourname.bsky.social",
    );
    expect(normalizeHandleInput("@@kojira.io")).toBe("kojira.io");
    expect(normalizeHandleInput("KOJIRA.IO")).toBe("kojira.io");
  });

  /** 貼り付けで混ざる途中の空白も落とす（ハンドルに空白は使えない） */
  it("途中の空白も落とす", () => {
    expect(normalizeHandleInput("your name.bsky.social")).toBe(
      "yourname.bsky.social",
    );
  });

  /** 妥当性の判定はサーバーの1か所だけが持つ。ここは形を整えるだけ */
  it("妥当かどうかは判定しない（整えるだけで通す）", () => {
    expect(normalizeHandleInput("@")).toBe("");
    expect(normalizeHandleInput("ドット無し")).toBe("ドット無し");
  });
});

describe("ハンドル入力フォーム (#381)", () => {
  it("素のフォームの GET で、認可開始のURLへ送る", () => {
    const { container } = renderWithProviders(
      <BlueskyHandleForm submitLabel="送信" />,
    );
    const form = container.querySelector("form");
    // fetch ではなくトップレベル遷移でないと認可画面へ飛べない
    expect(form?.getAttribute("method")).toBe("get");
    expect(form?.getAttribute("action")).toBe(BLUESKY_LOGIN_PATH);
    expect(BLUESKY_LOGIN_PATH).toBe("/api/auth/bluesky/login");
    // 送るのは handle だけ（名前が変わるとサーバー側の入力検証に届かない）
    expect(container.querySelector("input[name=handle]")).toBeInTheDocument();
  });

  it("空のままでは送信できない", () => {
    renderWithProviders(<BlueskyHandleForm submitLabel="送信" />);
    const button = screen.getByRole("button", { name: "送信" });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: " @Yourname.Bsky.Social " },
    });
    expect(button).toBeEnabled();
    // 入力欄そのものが整った値になっている（送られる値と見える値が同じ）
    expect(screen.getByRole("textbox")).toHaveValue("yourname.bsky.social");
  });

  it("戻り先が指定されているときだけ next を一緒に送る", () => {
    const { container } = renderWithProviders(
      <BlueskyHandleForm submitLabel="送信" next="/events/abc" />,
    );
    expect(container.querySelector("input[name=next]")).toHaveValue(
      "/events/abc",
    );
    const { container: without } = renderWithProviders(
      <BlueskyHandleForm submitLabel="送信" />,
    );
    expect(without.querySelector("input[name=next]")).toBeNull();
  });
});

describe("ログイン画面の Bluesky (#381)", () => {
  it("日本語でハンドル入力欄とボタンが出る", async () => {
    renderWithProviders(<LoginPage />);
    expect(
      await screen.findByRole("button", { name: "Bluesky でログイン" }),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("yourname.bsky.social"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Bluesky のハンドル")).toBeInTheDocument();
  });

  it("英語でも同じものが出る", async () => {
    await i18next.changeLanguage("en");
    renderWithProviders(<LoginPage />);
    expect(
      await screen.findByRole("button", { name: "Sign in with Bluesky" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Bluesky handle")).toBeInTheDocument();
  });

  it("失敗して戻ってきたら理由を出し、クエリを消す", async () => {
    window.history.replaceState(null, "", "/login?bluesky_error=handle_not_found");
    renderWithProviders(<LoginPage />);
    expect(
      await screen.findByText(
        "そのハンドルのアカウントが見つかりませんでした。入力を確認してください（例: yourname.bsky.social）。",
      ),
    ).toBeInTheDocument();
    // リロードや「戻る」で蒸し返さない
    await waitFor(() =>
      expect(window.location.search).not.toContain("bluesky_error"),
    );
  });

  it("内部の仕組みの呼び名を画面に出さない", async () => {
    window.history.replaceState(null, "", "/login?bluesky_error=failed");
    const { container } = renderWithProviders(<LoginPage />);
    await screen.findByRole("button", { name: "Bluesky でログイン" });
    for (const term of INTERNAL_TERMS) {
      expect(container.textContent).not.toContain(term);
    }
  });
});

describe("アカウント設定の Bluesky (#381)", () => {
  it("連携の一覧に並び、押すとハンドル入力欄が出る", async () => {
    renderWithProviders(<AccountPage />);
    expect(await screen.findByText("Bluesky")).toBeInTheDocument();
    // 押すまでは入力欄を出さない（一覧が縦に伸びない）
    expect(screen.queryByLabelText("Bluesky のハンドル")).toBeNull();
    // 「連携する」は discord と bluesky の2つ。bluesky は最後の行
    const links = screen.getAllByRole("button", { name: "連携する" });
    fireEvent.click(links[links.length - 1]!);
    expect(
      await screen.findByLabelText("Bluesky のハンドル"),
    ).toBeInTheDocument();
  });

  it("失敗して戻ってきたら既存のモーダルで理由を出し、入力欄を開いておく", async () => {
    window.history.replaceState(null, "", "/account?bluesky_error=expired");
    renderWithProviders(<AccountPage />);
    expect(
      await screen.findByText("時間が経ちすぎました。もう一度やり直してください。"),
    ).toBeInTheDocument();
    // やり直しに1手戻らせない
    expect(screen.getByLabelText("Bluesky のハンドル")).toBeInTheDocument();
    // 閉じるとクエリが消える
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    await waitFor(() =>
      expect(window.location.search).not.toContain("bluesky_error"),
    );
  });
});

/**
 * 文言そのもの (#381)。キーの過不足は型と辞書のテストが見張るので、ここは
 * **サーバーが返すコードで引ける**ことと、日本語が英語に混ざっていないことを見る。
 */
describe("Bluesky の失敗の文言 (#381)", () => {
  const codes = ["handle_not_found", "unavailable", "expired", "failed"];

  it("サーバーが返すコードが両方の言語で引ける", async () => {
    for (const code of codes) {
      expect(tDynamic(`blueskyError.${code}`, ""), code).not.toBe("");
    }
    await i18next.changeLanguage("en");
    for (const code of codes) {
      const text = tDynamic(`blueskyError.${code}`, "");
      expect(text, code).not.toBe("");
      expect(text, code).not.toMatch(/[぀-ヿ㐀-䶿一-鿿]/);
    }
  });

  it("知らないコードでもキー名が画面に出ない", () => {
    expect(blueskyErrorMessage("brand_new_code_from_server")).toBe(
      i18next.t("blueskyError.default"),
    );
    expect(blueskyErrorMessage(null)).toBe(i18next.t("blueskyError.default"));
  });

  /** `linkError` と混ぜない（混ぜると未知のコードが誤った説明になる。設計 12） */
  it("連携失敗の表とは別の名前空間になっている", () => {
    expect(Object.keys(translations.ja.blueskyError)).toContain(
      "handle_not_found",
    );
    expect(Object.keys(translations.ja.linkError)).not.toContain(
      "handle_not_found",
    );
  });
});
