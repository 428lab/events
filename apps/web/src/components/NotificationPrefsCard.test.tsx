import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * 通知設定カード (#413)。
 *
 * アプリ内の通知（フォロー相手・既定オン）とメール通知は、届く場所も既定も
 * 違うのにスイッチが同列に並んでいて、取り違えが実際に起きた。
 * 「アプリ内」「メール」の見出しで節が分かれて見えることを確かめる。
 */

const { getMock, putMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  putMock: vi.fn(),
}));

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

const { NotificationPrefsCard } = await import("./NotificationPrefsCard.js");

function draw() {
  const qc = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <NotificationPrefsCard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getMock.mockReset();
  putMock.mockReset();
});

describe("通知設定カードの節分け (#413)", () => {
  it("「アプリ内」と「メール」の見出しが出て、スイッチがそれぞれの節に入る", async () => {
    getMock.mockResolvedValue({
      prefs: { followeeCreated: true, followeeJoined: true, emailEnabled: true },
      email: "user@example.com",
    });
    draw();

    // 設定の読み込みが反映されるまで待つ（宛先表示は読み込み後にしか出ない）
    expect(await screen.findByText("送信先: user@example.com")).toBeTruthy();
    expect(screen.getByText("アプリ内")).toBeTruthy();
    expect(screen.getByText("メール")).toBeTruthy();
    // スイッチの実体は変えていない（3つそのまま）
    expect(screen.getByLabelText("フォロー相手がイベントを公開したとき")).toBeTruthy();
    expect(screen.getByLabelText("フォロー相手がイベントに参加したとき")).toBeTruthy();
    expect(
      screen.getByLabelText("メール通知（通知と参加イベントの前日リマインダー）"),
    ).toBeTruthy();
  });

  it("メール未連携でも見出しは両方出て、連携をうながす注記がメール節に出る", async () => {
    getMock.mockResolvedValue({
      prefs: { followeeCreated: true, followeeJoined: true, emailEnabled: true },
      email: null,
    });
    draw();

    expect(
      await screen.findByText(
        /メール通知には Google \/ GitHub \/ Discord のログイン連携が必要/,
      ),
    ).toBeTruthy();
    expect(screen.getByText("アプリ内")).toBeTruthy();
    expect(screen.getByText("メール")).toBeTruthy();
  });
});
