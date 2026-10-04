import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AccessToken } from "@eventer/shared";

/**
 * アカウント設定「AI 連携（アクセストークン）」カード (#581)。
 *
 * 発行フォームが仕様どおりの値を送ること、平文は発行直後の1回だけ出て
 * Claude 側の接続コマンドにも埋まること、一覧で失効済みが区別できること、
 * 失効は確認を挟むこと、10本の上限に当たったら案内が出ることを確かめる。
 */

const { getMock, postMock, delMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  delMock: vi.fn(),
}));

vi.mock("../api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client.js")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      get: (...args: unknown[]) => getMock(...args),
      post: (...args: unknown[]) => postMock(...args),
      del: (...args: unknown[]) => delMock(...args),
    },
  };
});

const { AccessTokensCard, claudeCodeCommand } = await import(
  "./AccessTokensCard.js"
);
const { ApiError } = await import("../api/client.js");

const DAY = 86_400_000;
const NOW = Date.now();
const PLAIN = "evl_abcdefghABCDEFGH0123456789-_abcdefghijklmnop";

function token(over: Partial<AccessToken> = {}): AccessToken {
  return {
    id: "tok-1",
    name: "Claude Code",
    prefix: "evl_abcdefgh",
    scopes: ["read"],
    createdAt: NOW - DAY,
    expiresAt: NOW + 89 * DAY,
    lastUsedAt: null,
    revokedAt: null,
    ...over,
  };
}

function draw() {
  const qc = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AccessTokensCard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  delMock.mockReset();
});

describe("一覧 (#581)", () => {
  it("名前・prefix・スコープが出て、有効なものだけに失効ボタンがある", async () => {
    getMock.mockResolvedValue({
      tokens: [
        token({ id: "tok-a", name: "読み取り用" }),
        token({
          id: "tok-b",
          name: "書き込み用",
          prefix: "evl_zzzzzzzz",
          scopes: ["read", "write"],
          lastUsedAt: NOW,
        }),
        token({ id: "tok-c", name: "古いもの", revokedAt: NOW - 1000 }),
        token({ id: "tok-d", name: "切れたもの", expiresAt: NOW - 1000 }),
      ],
    });
    draw();

    const a = await screen.findByTestId("access-token-tok-a");
    expect(within(a).getByText("読み取り用")).toBeTruthy();
    expect(within(a).getByText("evl_abcdefgh…")).toBeTruthy();
    expect(within(a).getByText("読み取りのみ")).toBeTruthy();
    expect(within(a).getByText(/未使用/)).toBeTruthy();
    expect(within(a).getByRole("button", { name: "失効" })).toBeTruthy();

    const b = screen.getByTestId("access-token-tok-b");
    expect(within(b).getByText("読み取り・下書き作成")).toBeTruthy();
    expect(within(b).getByText(/最終使用/)).toBeTruthy();

    const c = screen.getByTestId("access-token-tok-c");
    expect(within(c).getByText("失効済み")).toBeTruthy();
    expect(within(c).queryByRole("button", { name: "失効" })).toBeNull();
    expect(c.style.opacity || getComputedStyle(c).opacity).toBe("0.5");

    const d = screen.getByTestId("access-token-tok-d");
    expect(within(d).getByText("期限切れ")).toBeTruthy();
    expect(within(d).queryByRole("button", { name: "失効" })).toBeNull();
  });

  it("1本も無いときは空の案内が出る", async () => {
    getMock.mockResolvedValue({ tokens: [] });
    draw();
    expect(await screen.findByText("発行したトークンはまだありません。")).toBeTruthy();
  });
});

describe("発行フォーム (#581)", () => {
  it("名前が空のあいだは発行できず、既定は読み取りのみ・90日で送る", async () => {
    getMock.mockResolvedValue({ tokens: [] });
    postMock.mockResolvedValue({ ...token(), token: PLAIN });
    draw();

    fireEvent.click(await screen.findByRole("button", { name: "トークンを発行" }));
    const dialog = await screen.findByRole("dialog");
    const run = within(dialog).getByRole("button", { name: "発行する" });
    expect((run as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(within(dialog).getByLabelText(/名前/), {
      target: { value: "  Claude Code  " },
    });
    expect((run as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(run);

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/me/access-tokens", {
        name: "Claude Code",
        write: false,
        expiresInDays: 90,
      }),
    );
  });

  it("書き込みを選ぶと注意書きが出て、write と期限が送られる", async () => {
    getMock.mockResolvedValue({ tokens: [] });
    postMock.mockResolvedValue({ ...token({ scopes: ["read", "write"] }), token: PLAIN });
    draw();

    fireEvent.click(await screen.findByRole("button", { name: "トークンを発行" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText(/AI がイベントの下書きを作れるようになります/)).toBeNull();

    fireEvent.change(within(dialog).getByLabelText(/名前/), {
      target: { value: "Desktop" },
    });
    fireEvent.click(within(dialog).getByLabelText(/書き込みも許可する/));
    expect(within(dialog).getByText(/AI がイベントの下書きを作れるようになります/)).toBeTruthy();

    // 期限の select を開いて 30日 を選ぶ
    fireEvent.mouseDown(within(dialog).getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: "30日" }));

    fireEvent.click(within(dialog).getByRole("button", { name: "発行する" }));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/me/access-tokens", {
        name: "Desktop",
        write: true,
        expiresInDays: 30,
      }),
    );
  });

  it("上限（409 too_many_tokens）に当たったら案内が出る", async () => {
    getMock.mockResolvedValue({ tokens: [] });
    postMock.mockRejectedValue(new ApiError(409, { error: "too_many_tokens" }));
    draw();

    fireEvent.click(await screen.findByRole("button", { name: "トークンを発行" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/名前/), {
      target: { value: "x" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "発行する" }));
    expect(
      await within(dialog).findByText(/有効なトークンは 10 本までです/),
    ).toBeTruthy();
  });
});

describe("発行直後の平文表示 (#581)", () => {
  it("平文と、トークンを埋めた接続コマンドが1回だけ出る", async () => {
    getMock.mockResolvedValue({ tokens: [] });
    postMock.mockResolvedValue({ ...token(), token: PLAIN });
    draw();

    fireEvent.click(await screen.findByRole("button", { name: "トークンを発行" }));
    let dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/名前/), {
      target: { value: "Claude Code" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "発行する" }));

    expect(await within(dialog).findByText("トークンを発行しました")).toBeTruthy();
    expect(within(dialog).getByText(/この画面を閉じると二度と表示されません/)).toBeTruthy();
    expect(within(dialog).getByDisplayValue(PLAIN)).toBeTruthy();
    const command = `claude mcp add --transport http events-lab ${window.location.origin}/api/mcp --header "Authorization: Bearer ${PLAIN}"`;
    expect(within(dialog).getByDisplayValue(command)).toBeTruthy();
    expect(within(dialog).getByDisplayValue(`${window.location.origin}/api/mcp`)).toBeTruthy();
    expect(within(dialog).getByDisplayValue(`Bearer ${PLAIN}`)).toBeTruthy();

    // 閉じると平文はどこにも残らない。開き直すと空の発行フォームに戻る
    fireEvent.click(within(dialog).getByRole("button", { name: "閉じる" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByDisplayValue(PLAIN)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "トークンを発行" }));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("アクセストークンを発行")).toBeTruthy();
    expect(within(dialog).queryByDisplayValue(PLAIN)).toBeNull();
  });

  it("コピーボタンで平文がクリップボードに入る", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    getMock.mockResolvedValue({ tokens: [] });
    postMock.mockResolvedValue({ ...token(), token: PLAIN });
    draw();

    fireEvent.click(await screen.findByRole("button", { name: "トークンを発行" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/名前/), {
      target: { value: "Claude Code" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "発行する" }));
    fireEvent.click(
      await within(dialog).findByRole("button", { name: "コピー: アクセストークン" }),
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(PLAIN));
  });

  it("接続コマンドの形（docs/ai-integration.md §6.6）", () => {
    expect(claudeCodeCommand("evl_x", "https://events.kojira.io/api/mcp")).toBe(
      'claude mcp add --transport http events-lab https://events.kojira.io/api/mcp --header "Authorization: Bearer evl_x"',
    );
  });
});

describe("失効の確認ダイアログ (#581)", () => {
  it("失効は確認を挟み、キャンセルなら送らない", async () => {
    getMock.mockResolvedValue({ tokens: [token()] });
    draw();

    fireEvent.click(await screen.findByRole("button", { name: "失効" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("トークンを失効しますか？")).toBeTruthy();
    expect(within(dialog).getByText(/「Claude Code」（evl_abcdefgh…）を失効します/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "キャンセル" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(delMock).not.toHaveBeenCalled();
  });

  it("確認して失効すると DELETE が飛ぶ", async () => {
    getMock.mockResolvedValue({ tokens: [token()] });
    delMock.mockResolvedValue({ ok: true });
    draw();

    fireEvent.click(await screen.findByRole("button", { name: "失効" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "失効する" }));
    await waitFor(() => expect(delMock).toHaveBeenCalledWith("/me/access-tokens/tok-1"));
  });
});
