import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { useDeckImport } from "./useDeckImport.js";
import { readImportDraft, writeImportDraft, emptyImportDraft, DECK_IMPORT_STORAGE_KEY } from "./deckImportSession.js";
import { ApiError, NetworkError } from "../api/client.js";
const save = vi.hoisted(() => vi.fn());
vi.mock("../api/deckImport.js", () => ({ saveDeckImport: save }));
class ValidatorWorker {
  static workers: ValidatorWorker[] = [];
  onmessage: ((event: { data: object }) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = vi.fn(); terminate = vi.fn();
  constructor() { ValidatorWorker.workers.push(this); }
  valid(revision: number) { this.onmessage?.({ data: { ok: true, revision, title: "test", content: { slides: [] } } }); }
}
const receipt = { id: "11111111-1111-4111-8111-111111111111", slug: "0123456789", replayed: false };
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
beforeEach(() => { sessionStorage.clear(); save.mockReset(); ValidatorWorker.workers = []; vi.stubGlobal("Worker", ValidatorWorker); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function ready() {
  const hook = renderHook(({ owner }) => useDeckImport(owner), { initialProps: { owner: "owner" }, wrapper });
  act(() => hook.result.current.edit("  original bytes\n"));
  act(() => { hook.result.current.bindOwner(); hook.result.current.validate(); });
  act(() => ValidatorWorker.workers.at(-1)!.valid(hook.result.current.draft.revision));
  return hook;
}
describe("useDeckImport recovery and identity", () => {
  it("does not save on preview; rejects stale worker output after edits", () => {
    const hook = ready();
    expect(save).not.toHaveBeenCalled();
    const old = ValidatorWorker.workers.at(-1)!;
    act(() => hook.result.current.edit("changed"));
    act(() => old.valid(1));
    expect(hook.result.current.result).toBeNull();
    expect(hook.result.current.draft.raw).toBe("changed");
    expect(readImportDraft(sessionStorage).raw).toBe("changed");
  });
  it("persists raw/key before POST, serializes clicks, retains identity after network failure and reload", async () => {
    let reject!: (e: unknown) => void;
    save.mockImplementation((raw, key) => {
      expect(readImportDraft(sessionStorage)).toMatchObject({ raw, key, state: "pending", ownerId: "owner" });
      return new Promise((_, no) => { reject = no; });
    });
    const hook = ready();
    act(() => { void hook.result.current.save(); void hook.result.current.save(); });
    expect(save).toHaveBeenCalledTimes(1);
    const key = hook.result.current.draft.key;
    act(() => hook.result.current.edit("do not replace"));
    expect(hook.result.current.draft.raw).toBe("  original bytes\n");
    await act(async () => reject(new NetworkError(false)));
    hook.unmount();
    const recovered = renderHook(() => useDeckImport("owner"), { wrapper });
    expect(recovered.result.current.draft.key).toBe(key);
    expect(save).toHaveBeenCalledTimes(1);
    save.mockResolvedValue(receipt);
    await act(async () => recovered.result.current.save());
    expect(save).toHaveBeenLastCalledWith("  original bytes\n", key);
    expect(readImportDraft(sessionStorage)).toMatchObject({ state: "success", raw: "", receipt });
  });
  it("storage failure or readback mismatch prevents POST, preserving source", async () => {
    const hook = ready();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    await act(async () => hook.result.current.save());
    expect(save).not.toHaveBeenCalled();
    expect(hook.result.current.storageError).toBe(true);
    expect(hook.result.current.draft).toMatchObject({ state: "input", raw: "  original bytes\n", key: null });
  });
  it("another owner cannot edit, bind or retry a recovered pending operation", async () => {
    const draft = { ...emptyImportDraft(), raw: "private draft", ownerId: "loser", key: receipt.id, state: "pending" as const };
    writeImportDraft(sessionStorage, draft);
    const hook = renderHook(() => useDeckImport("winner"), { wrapper });
    expect(hook.result.current.owned).toBe(false);
    act(() => { hook.result.current.edit("replace"); hook.result.current.bindOwner(); });
    await act(async () => hook.result.current.save());
    expect(save).not.toHaveBeenCalled();
    expect(readImportDraft(sessionStorage)).toEqual(draft);
  });
  it.each([401, 404, 405, 429, 503])("HTTP %i keeps the key; 429 cannot retry early", async (status) => {
    const hook = ready();
    save.mockRejectedValue(new ApiError(status, { retryAfter: 60 }));
    await act(async () => hook.result.current.save());
    expect(hook.result.current.draft.state).toBe("pending");
    expect(hook.result.current.draft.key).not.toBeNull();
    if (status === 429) { await act(async () => hook.result.current.save()); expect(save).toHaveBeenCalledTimes(1); }
  });
  it.each([400, 413, 415, 422])("HTTP %i permits correction without dropping input", async (status) => {
    const hook = ready(); save.mockRejectedValue(new ApiError(status, {}));
    await act(async () => hook.result.current.save());
    expect(hook.result.current.draft).toMatchObject({ state: "input", key: null, raw: "  original bytes\n" });
    expect(hook.result.current.result).toBeNull();
  });
  it.each([403, 409, 410])("HTTP %i stops retries until an explicit supported action", async (status) => {
    const hook = ready(); save.mockRejectedValue(new ApiError(status, { id: receipt.id, slug: receipt.slug }));
    await act(async () => hook.result.current.save());
    await act(async () => hook.result.current.save());
    expect(hook.result.current.draft.state).toBe("blocked");
    expect(save).toHaveBeenCalledTimes(1);
  });
  it("corrupt storage is not silently treated as safe to send", () => {
    sessionStorage.setItem(DECK_IMPORT_STORAGE_KEY, "not JSON");
    const hook = renderHook(() => useDeckImport("owner"), { wrapper });
    expect(hook.result.current.storageError).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });
});
