import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * 出席チェックの再取得 (#286)。
 *
 * 409 は「手元の参加者一覧が古い」という返事なので、成功時よりむしろ取り直したい。
 * 取り直さないと、抽選や取消で参加確定でなくなった人のチェックが押せる見た目のまま
 * 残り、押すたびに同じ 409 を食う。
 */

const { patchMock } = vi.hoisted(() => ({ patchMock: vi.fn() }));

vi.mock("./client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client.js")>();
  return {
    ...actual,
    api: { ...actual.api, patch: (...args: unknown[]) => patchMock(...args) },
  };
});

const { useSetAttendance } = await import("./hooks.js");
const { ApiError } = await import("./client.js");

function setup() {
  const qc = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useSetAttendance("e-1"), { wrapper });
  /** 再取得した対象のキー一覧 */
  const invalidatedKeys = (): unknown[] =>
    invalidate.mock.calls.map((c) => c[0]?.queryKey);
  return { result, invalidate, invalidatedKeys };
}

describe("useSetAttendance の再取得 (#286)", () => {
  beforeEach(() => {
    patchMock.mockReset();
  });

  it("成功したらメンバー一覧を取り直す", async () => {
    patchMock.mockResolvedValue({ member: null });
    const { result, invalidatedKeys } = setup();

    result.current.mutate({ userId: "u-1", attended: true });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidatedKeys()).toContainEqual(["event", "e-1", "members"]);
  });

  it("409（一覧が古い）でも取り直す", async () => {
    patchMock.mockRejectedValue(new ApiError(409, { error: "not_confirmed" }));
    const { result, invalidatedKeys } = setup();

    result.current.mutate({ userId: "u-1", attended: true });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidatedKeys()).toContainEqual(["event", "e-1", "members"]);
  });

  it("通信断など他の失敗では取り直さない（無駄な再取得を増やさない）", async () => {
    patchMock.mockRejectedValue(new Error("offline"));
    const { result, invalidate } = setup();

    result.current.mutate({ userId: "u-1", attended: true });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidate).not.toHaveBeenCalled();
  });
});
