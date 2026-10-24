import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeckAgentPanel } from "./DeckAgentPanel.js";
import "../i18n/index.js";

const now = Date.now();
type Token = { id: string; createdAt: number; expiresAt: number; writeCount: number; imageCount: number; deck: null | { id: string; slug: string; title: string; editUrl: string; viewUrl: string } };
let tokens: Token[] = [];
const calls: { method: string; url: string }[] = [];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
beforeEach(() => {
  tokens = []; calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url });
    if (url === "/api/decks/agent-tokens" && method === "GET") return json({ tokens });
    if (url === "/api/decks/agent-tokens" && method === "POST") {
      const t: Token = { id: "t1", createdAt: now, expiresAt: now + 3600_000, writeCount: 0, imageCount: 0, deck: null };
      tokens = [t];
      return json({ ...t, token: "evd_SECRET", specUrl: "https://events.kojira.io/deck-import/agent.md" }, 201);
    }
    if (url === "/api/decks/agent-tokens/t1" && method === "DELETE") { tokens = []; return json({ ok: true }); }
    return json({ error: "not_found" }, 404);
  }));
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
let client: QueryClient;
const mount = () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><DeckAgentPanel /></QueryClientProvider>);
};

describe("DeckAgentPanel", () => {
  it("issues a token and shows the instructions with the spec URL and token once", async () => {
    mount();
    expect(screen.getByText(/URLを知る人はログインせず閲覧できます/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "トークンを発行して指示文を作る" }));
    const box = await screen.findByLabelText(/AIに渡す指示文/);
    expect((box as HTMLTextAreaElement).value).toContain("https://events.kojira.io/deck-import/agent.md");
    expect((box as HTMLTextAreaElement).value).toContain("evd_SECRET");
    expect(await screen.findByText("AIからの書き込みを待っています")).toBeInTheDocument();
  });

  it("shows the created deck links and revokes, which clears the instructions", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "トークンを発行して指示文を作る" }));
    await screen.findByLabelText(/AIに渡す指示文/);
    tokens = [{ ...tokens[0]!, writeCount: 2, imageCount: 1, deck: { id: "d1", slug: "abc", title: "紹介", editUrl: "", viewUrl: "" } }];
    // no polling (D-POLL-MIN): the user refreshes after the agent finishes
    fireEvent.click(screen.getByRole("button", { name: "最新にする" }));
    expect(await screen.findByText("AIがスライドを作りました: 紹介")).toBeInTheDocument();
    expect(screen.getByText(/書き込み 2回・画像 1枚/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "編集を開く" })).toHaveAttribute("href", "/decks/d1/edit");
    expect(screen.getByRole("link", { name: "表示を開く" })).toHaveAttribute("href", "/d/abc");
    fireEvent.click(screen.getByRole("button", { name: "取り消す" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/decks/agent-tokens/t1")).toBe(true));
    await waitFor(() => expect(screen.queryByLabelText(/AIに渡す指示文/)).not.toBeInTheDocument());
  });

  it("explains the daily limit", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) =>
      (init?.method ?? "GET") === "POST" ? json({ error: "agent_token_daily_limit" }, 429) : json({ tokens: [] })));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "トークンを発行して指示文を作る" }));
    expect(await screen.findByText("今日はこれ以上発行できません。時間をおいて試してください。")).toBeInTheDocument();
  });
});
