import { afterEach, expect, it, vi } from "vitest";
import { AWARDS_DRUMROLL_MS } from "@eventer/shared";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

it("audio denial cannot reveal early, and the committed elapsed time shortens the remaining wait", async () => {
  vi.useFakeTimers();
  const audios: { currentTime: number; play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal("Audio", class {
    currentTime = 0;
    play = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    pause = vi.fn();
    constructor() { audios.push(this); }
  });
  const { playDrumroll } = await import("./effects.js");
  const reveal = vi.fn();
  const stop = playDrumroll(reveal, 700);
  await Promise.resolve();
  expect(audios[0].currentTime).toBe(0.7);
  expect(reveal).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(AWARDS_DRUMROLL_MS - 701);
  expect(reveal).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(reveal).toHaveBeenCalledOnce();
  stop();
  expect(audios[0].pause).toHaveBeenCalled();
  const cancelled = vi.fn();
  playDrumroll(cancelled)();
  await vi.advanceTimersByTimeAsync(AWARDS_DRUMROLL_MS);
  expect(cancelled).not.toHaveBeenCalled();
});
