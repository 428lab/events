import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  VideoThumbOverlay,
  eventMediaThumbUrl,
  formatVideoDuration,
} from "./videoThumb.js";

describe("formatVideoDuration", () => {
  it("0:42 形式で出す", () => {
    expect(formatVideoDuration(42_000)).toBe("0:42");
    expect(formatVideoDuration(0)).toBe("0:00");
    expect(formatVideoDuration(60_000)).toBe("1:00");
    expect(formatVideoDuration(83_500)).toBe("1:24"); // 四捨五入
    expect(formatVideoDuration(9_000)).toBe("0:09");
  });

  it("負値は 0:00 に倒す", () => {
    expect(formatVideoDuration(-5)).toBe("0:00");
  });
});

describe("eventMediaThumbUrl", () => {
  it("写真は image、動画は poster を指す", () => {
    expect(eventMediaThumbUrl("ev1", "m1", "photo")).toBe(
      "/api/events/ev1/photos/m1/image",
    );
    expect(eventMediaThumbUrl("ev1", "m1", "video")).toBe(
      "/api/events/ev1/photos/m1/poster",
    );
  });
});

describe("VideoThumbOverlay", () => {
  it("再生アイコンと長さバッジを重ねる", () => {
    render(<VideoThumbOverlay durationMs={42_000} />);
    expect(screen.getByTestId("video-play-overlay")).toBeInTheDocument();
    expect(screen.getByText("0:42")).toBeInTheDocument();
  });

  it("小さい枠では長さバッジを出さない", () => {
    render(<VideoThumbOverlay durationMs={42_000} small />);
    expect(screen.getByTestId("video-play-overlay")).toBeInTheDocument();
    expect(screen.queryByText("0:42")).toBeNull();
  });

  it("長さ不明（null）はバッジなし", () => {
    render(<VideoThumbOverlay durationMs={null} />);
    expect(screen.queryByText(/\d+:\d+/)).toBeNull();
  });
});
