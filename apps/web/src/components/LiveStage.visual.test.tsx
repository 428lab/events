import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { LiveSceneStage } from "./LiveStage.js";
import { visualLiveSetContent } from "@eventer/shared";
import type { LiveScene } from "@eventer/shared";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const scene: LiveScene = { id: "scene", name: "scene", background: "#0E1426", elements: [
  { id: "clock", type: "clock", x: 20, y: 30, w: 200, h: 42, rotation: 0, timezone: "UTC", showSeconds: true },
  { id: "countdown", type: "countdown", x: 20, y: 90, w: 200, h: 42, rotation: 0, target: "custom", targetEpochMs: Date.UTC(2026, 0, 1, 0, 0, 12) },
  { id: "live", type: "liveIndicator", x: 20, y: 150, w: 120, h: 30, rotation: 0, text: "LIVE" },
  { id: "motif", type: "motif", x: 15, y: 180, w: 40, h: 40, rotation: 0, motif: "halo", motion: { kind: "rotation", seconds: 30, direction: "clockwise" } },
  { id: "marquee", type: "marquee", x: 15, y: 240, w: 300, h: 40, rotation: 0, text: "開催案内" },
] };
describe("LiveSceneStage runtime", () => {
  it("shows real datetime prominently in Signal standby and hides the entire card if schedule is unknown", () => {
    const scene = visualLiveSetContent("signal").scenes[0];
    const runtime = { eventDatetimeAvailable: true, eventInfo: (field: string) => field === "datetime" ? "2026/09/27 19:00–21:00" : "実際のイベント名" };
    const { container, rerender } = render(<LiveSceneStage scene={scene} width={960} runtime={runtime} />);
    expect(screen.getByText("2026/09/27 19:00–21:00")).toBeTruthy();
    expect(container.querySelectorAll('[title="実際のイベント名"]')).toHaveLength(2);
    rerender(<LiveSceneStage scene={scene} width={960} runtime={{ ...runtime, eventDatetimeAvailable: false }} />);
    expect(screen.queryByText("2026/09/27 19:00–21:00")).toBeNull();
    expect(container.querySelectorAll('[title="実際のイベント名"]')).toHaveLength(1);
  });
  it("clamps long Japanese event titles while retaining full text in template edit data", () => {
    const title = "非常に長い日本語イベントタイトルとコミュニティの集いを一緒に楽しむための追加のご案内";
    const { container } = render(<LiveSceneStage scene={visualLiveSetContent("signal").scenes[0]} width={960} runtime={{ eventInfo: field => field === "title" ? title : "2026/09/27 19:00" }} />);
    const headline = container.querySelector('[title="' + title + '"]') as HTMLElement;
    expect(headline).toBeTruthy();
    expect(headline.style.webkitLineClamp).toBe("2");
    expect(headline.textContent).toBe(title);
    expect(screen.getByText("2026/09/27 19:00")).toBeTruthy();
  });
  it("renders actual changing clock/countdown, OFF hidden, motion paused but time still updates", () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.useFakeTimers(); vi.setSystemTime(Date.UTC(2026, 0, 1, 0, 0, 5));
    const { container, rerender } = render(<LiveSceneStage scene={scene} width={960} runtime={{ pauseMotion: true }} />);
    expect(screen.queryByText("LIVE")).toBeNull();
    expect(screen.getByText("00:00:07")).toBeTruthy();
    expect(container.querySelector(".live-decoration-rotation")).toHaveStyle({ animationPlayState: "paused" });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByText("00:00:05")).toBeTruthy();
    rerender(<LiveSceneStage scene={scene} width={960} runtime={{ liveIndicatorOn: true }} />);
    expect(screen.getByText("LIVE")).toBeTruthy();
    expect(container.querySelectorAll(".live-marquee-half")).toHaveLength(2);
  });
});
