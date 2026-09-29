import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { LiveSceneStage } from "./LiveStage.js";
import { liveSetContentSchema, visualLiveSetContent } from "@eventer/shared";
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
  it("retains two-line title and readable placeholders when a 白磁 scene is duplicated", () => {
    const original = visualLiveSetContent("hakuji").scenes[0];
    const duplicated = { ...original, id: "new-scene-id", elements: original.elements.map((element, index) => ({ ...element, id: `new-${index}` })) };
    const title = "地域と技術をつなぐ非常に長い日本語のシンポジウムと次世代の学びについて";
    const { container } = render(<LiveSceneStage scene={duplicated} width={1280} runtime={{ eventInfo: field => field === "title" ? title : "", eventDatetimeAvailable: false }} />);
    expect((container.querySelector(`[title="${title}"]`) as HTMLElement).style.webkitLineClamp).toBe("2");
    expect(container.querySelector('[style*="background: rgb(246, 242, 234)"]')).toBeTruthy();
  });
  it("renders seven distinct bright scenes at 720/1080 widths with real title, no unknown schedule or invented speaker", () => {
    const title = "日本語による非常に長い講演タイトルと配信イベントの説明を含む特別なご案内";
    const scenes = visualLiveSetContent("hakuji").scenes;
    for (const width of [1280, 1920]) {
      for (const scene of scenes) {
        const { container, unmount } = render(<LiveSceneStage scene={scene} width={width} runtime={{ eventDatetimeAvailable: false, eventInfo: field => field === "title" ? title : "" }} />);
        const stage = container.firstElementChild as HTMLElement;
        expect(stage.style.height).toBe(`${width * 540 / 960}px`);
        expect(stage.firstElementChild).toHaveStyle({ background: "#F6F2EA" });
        expect(screen.queryByText("氏名を入力")).not.toBeInTheDocument();
        expect(screen.queryByText("役割を入力")).not.toBeInTheDocument();
        if (scene.id.endsWith("-wait")) {
          expect(screen.queryByText("イベント日時")).not.toBeInTheDocument();
          expect(container.querySelector('[title="' + title + '"]')).toHaveStyle({ webkitLineClamp: "2" });
        }
        if (scene.id.endsWith("-keynote")) {
          expect(container.querySelectorAll('[style*="color: rgb(32, 49, 70)"]')).not.toHaveLength(0);
          // 番号のないカメラ（#570 以前の要素）はカメラ1 として見せる
          expect(screen.getByText("カメラ1")).toBeInTheDocument();
        }
        unmount();
      }
    }
  });
  it.each(["keynote", "camera"] as const)("renders a blank 白磁 %s speaker plate below camera, then shows entered name and role", kind => {
    const original = visualLiveSetContent("hakuji").scenes.find(scene => scene.id === `v1-hakuji-${kind}`)!;
    const nameId = `v1-hakuji-${kind}-${kind}-name`;
    const roleId = `v1-hakuji-${kind}-${kind}-role`;
    const { container, rerender } = render(<LiveSceneStage scene={original} width={960} runtime={{ eventInfo: () => "実際のイベント名" }} />);
    const [backX, backY] = kind === "keynote" ? [633, 356] : [56, 431];
    expect(container.querySelector(`[style*="left: ${backX}px"][style*="top: ${backY}px"] .live-decoration`)).toHaveStyle({ background: "#203146" });
    expect(screen.queryByText("氏名を入力")).not.toBeInTheDocument();
    expect(screen.queryByText("山田 花子")).not.toBeInTheDocument();
    const entered = { ...original, elements: original.elements.map(element => element.id === nameId ? { ...element, text: "山田 花子" } : element.id === roleId ? { ...element, text: "講師" } : element) };
    rerender(<LiveSceneStage scene={entered} width={960} runtime={{ eventInfo: () => "実際のイベント名" }} />);
    expect(screen.getByText("山田 花子")).toBeInTheDocument();
    expect(screen.getByText("講師")).toBeInTheDocument();
    expect(screen.getByText("実際のイベント名")).toBeInTheDocument();
  });
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
  it("hides a saved pending custom target even if the event has a start time, then renders its confirmed target", () => {
    vi.useFakeTimers(); vi.setSystemTime(Date.UTC(2026, 0, 1));
    const pending = liveSetContentSchema.parse({ scenes: [{ id: "scene", name: "scene", elements: [{ ...scene.elements[1], targetEpochMs: undefined }] }] }).scenes[0];
    const { container, rerender } = render(<LiveSceneStage scene={pending} width={960} runtime={{ eventStartMs: Date.UTC(2026, 0, 1, 0, 0, 30) }} />);
    expect(container.querySelector(".live-time")).toBeNull();
    rerender(<LiveSceneStage scene={{ ...pending, elements: [{ ...pending.elements[0], targetEpochMs: Date.UTC(2026, 0, 1, 0, 0, 12) }] }} width={960} runtime={{ eventStartMs: Date.UTC(2026, 0, 1, 0, 0, 30) }} />);
    expect(screen.getByText("00:00:12")).toBeInTheDocument();
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
