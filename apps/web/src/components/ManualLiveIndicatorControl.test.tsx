import { describe, expect, it, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import type { EventLiveState } from "@eventer/shared";
import { ManualLiveIndicatorControl } from "./ManualLiveIndicatorControl.js";
const off = { liveIndicatorOn: false, updatedAt: Date.UTC(2026, 8, 27) } as EventLiveState;
describe("event manual LIVE control", () => {
  it("starts OFF, requires confirmation, reflects server ON/OFF and disables on GET error", () => {
    const toggle = vi.fn(); const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const props = { state: off, fetchError: false, pending: false, saveError: false, onToggle: toggle };
    const { rerender } = render(<ManualLiveIndicatorControl {...props} />);
    expect(screen.getByText("配信中表示（手動） OFF")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ON にする" }));
    expect(toggle).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "ON にする" }));
    expect(toggle).toHaveBeenCalledWith(true);
    rerender(<ManualLiveIndicatorControl {...props} state={{ ...off, liveIndicatorOn: true }} />);
    fireEvent.click(screen.getByRole("button", { name: "OFF にする" }));
    expect(toggle).toHaveBeenCalledWith(false);
    rerender(<ManualLiveIndicatorControl {...props} state={{ ...off, liveIndicatorOn: true }} fetchError saveError />);
    expect(screen.getByText("配信中表示（手動） 状態不明 / OFF")).toBeTruthy();
    expect(screen.getByRole("button", { name: "ON にする" })).toBeDisabled();
    expect(screen.getByText(/保存失敗・再試行/)).toBeTruthy();
    confirm.mockRestore();
  });
});
