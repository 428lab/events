import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@eventer/shared";

/**
 * 入場QR (#154) は自動では更新しない（D-POLL-MIN 第5段階 5b-4、D5）。
 * 期限が切れたら QR を伏せて「タップで更新」を出し、押したときだけ取り直す。
 */

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock("../api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client.js")>();
  return { ...actual, api: { ...actual.api, get: (...args: unknown[]) => getMock(...args) } };
});
vi.mock("qrcode", () => ({ default: { toDataURL: async (text: string) => `data:image/png;qr=${text}` } }));

const { EntranceQrDialog } = await import("./EntranceQrDialog.js");
const USER = { id: "u-1", username: "tester", globalName: "テスター", avatarUrl: null } as unknown as User;
const TICKET = "/events/e-1/my-ticket";

function draw() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <EntranceQrDialog eventId="e-1" user={USER} open onClose={() => {}} />
    </QueryClientProvider>,
  );
}
async function flush(ms = 50) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}
const ticketCalls = () => getMock.mock.calls.filter(([url]) => url === TICKET).length;

beforeEach(() => {
  vi.useFakeTimers();
  getMock.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("入場QR (D5: タップで更新)", () => {
  it("期限まで取り直さず、切れたら QR を伏せ、押したときだけ取り直す", async () => {
    getMock.mockResolvedValue({ token: "first", expiresAt: Date.now() + 180_000 });
    draw();
    await flush();
    expect(screen.getByRole("img", { name: "入場QRコード" }).getAttribute("src")).toContain("first");
    expect(ticketCalls()).toBe(1);

    // 期限が切れても勝手には取りに行かない
    await flush(181_000);
    expect(ticketCalls()).toBe(1);
    expect(screen.queryByRole("img", { name: "入場QRコード" })).toBeNull();
    const refresh = screen.getByRole("button", { name: /タップで更新/ });

    getMock.mockResolvedValue({ token: "second", expiresAt: Date.now() + 180_000 });
    fireEvent.click(refresh);
    await flush();
    await flush(1_000);
    expect(ticketCalls()).toBe(2);
    expect(screen.getByRole("img", { name: "入場QRコード" }).getAttribute("src")).toContain("second");
  });
});
