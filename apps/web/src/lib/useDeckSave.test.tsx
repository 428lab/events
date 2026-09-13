import { act, renderHook } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { useDeckSave } from "./useDeckSave.js";
const content = { slides: [] };
const flush = async () => { await act(async () => { vi.advanceTimersByTime(800); }); };
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe("useDeckSave revision ACK", () => {
  it("initial GET is acknowledged without PATCH; edits disable presentation before debounce", async () => {
    const save = vi.fn().mockResolvedValue({});
    const hook = renderHook(({ title }) => useDeckSave(title, content, save), { initialProps: { title: "initial" } });
    expect(hook.result.current.saved).toBe(true);
    await flush(); expect(save).not.toHaveBeenCalled();
    hook.rerender({ title: "edited" });
    expect(hook.result.current.saved).toBe(false);
    await flush();
    expect(save).toHaveBeenCalledWith({ title: "edited", content });
    expect(hook.result.current.saved).toBe(true);
  });
  it("one PATCH at a time; later edits collapse into latest and old ACK does not enable presentation", async () => {
    const resolves: (() => void)[] = [];
    const save = vi.fn(() => new Promise<void>((resolve) => resolves.push(resolve)));
    const hook = renderHook(({ title }) => useDeckSave(title, content, save), { initialProps: { title: "a" } });
    hook.rerender({ title: "b" }); await flush();
    hook.rerender({ title: "c" }); hook.rerender({ title: "d" }); await flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(hook.result.current.saved).toBe(false);
    await act(async () => resolves[0]());
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ title: "d", content });
    expect(hook.result.current.saved).toBe(false);
    await act(async () => resolves[1]());
    expect(hook.result.current.saved).toBe(true);
    expect(hook.result.current.acknowledgedRevision).toBe(hook.result.current.revision);
  });
  it("failed PATCH never reports saved, keeps latest changes, and needs explicit retry", async () => {
    const save = vi.fn().mockRejectedValue(new Error("offline"));
    const hook = renderHook(({ title }) => useDeckSave(title, content, save), { initialProps: { title: "a" } });
    hook.rerender({ title: "b" }); await flush();
    expect(hook.result.current.status).toBe("editorFailed");
    expect(hook.result.current.saved).toBe(false);
    hook.rerender({ title: "c" }); await flush();
    expect(save).toHaveBeenCalledTimes(1);
    save.mockResolvedValue({});
    await act(async () => hook.result.current.retry());
    expect(save).toHaveBeenLastCalledWith({ title: "c", content });
    expect(hook.result.current.saved).toBe(true);
  });
  it("image content changes require their own ACK", async () => {
    const save = vi.fn().mockResolvedValue({});
    const hook = renderHook(({ value }) => useDeckSave("a", value, save), { initialProps: { value: content } });
    const replacement = { slides: [] };
    hook.rerender({ value: replacement });
    expect(hook.result.current.saved).toBe(false);
    await flush(); expect(hook.result.current.saved).toBe(true);
  });
});
