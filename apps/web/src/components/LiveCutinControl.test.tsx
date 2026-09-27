import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LiveCutinControl } from "./LiveCutinControl.js";

const trigger = vi.fn();
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../api/liveControlHooks.js", () => ({ cutinApi: { trigger: (...args: unknown[]) => trigger(...args) } }));
beforeEach(() => { trigger.mockReset().mockResolvedValue({}); Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn().mockReturnValue({ matches: false }) }); });
describe("staff cut-in button", () => {
  it("local preview never sends; manual rapid second click sends a new caption without a busy guard", async () => {
    render(<LiveCutinControl eventId="event-a" />);
    fireEvent.change(screen.getByLabelText("studio.cutinName"), { target: { value: "山田" } });
    fireEvent.click(screen.getByRole("button", { name: "studio.cutinPreview" }));
    expect(screen.getByText("studio.cutinLocalOnly")).toBeTruthy();
    expect(trigger).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "studio.cutinSend" }));
    await waitFor(() => expect(screen.getByText("studio.cutinSent")).toBeTruthy());
    expect(trigger).toHaveBeenCalledWith("event-a", { message: "山田さん 参戦！！" });
    fireEvent.change(screen.getByLabelText("studio.cutinMessage"), { target: { value: "二番目 参戦！！" } });
    fireEvent.click(screen.getByRole("button", { name: "studio.cutinSend" }));
    await waitFor(() => expect(trigger).toHaveBeenCalledTimes(2));
    expect(trigger).toHaveBeenLastCalledWith("event-a", { message: "二番目 参戦！！" });
  });
  it("allows a second intentional press before the first response; older result cannot replace the latest copy", async () => {
    let resolveFirst!: (value: object) => void;
    trigger.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; })).mockResolvedValueOnce({});
    render(<LiveCutinControl eventId="event-a" />);
    fireEvent.change(screen.getByLabelText("studio.cutinMessage"), { target: { value: "first" } });
    fireEvent.click(screen.getByRole("button", { name: "studio.cutinSend" }));
    fireEvent.change(screen.getByLabelText("studio.cutinMessage"), { target: { value: "second" } });
    fireEvent.click(screen.getByRole("button", { name: "studio.cutinPending" }));
    expect(trigger).toHaveBeenCalledTimes(2);
    expect(trigger).toHaveBeenLastCalledWith("event-a", { message: "second" });
    await waitFor(() => expect(screen.getByText("studio.cutinSent")).toBeTruthy());
    resolveFirst({});
    await waitFor(() => expect(screen.getByRole("button", { name: "studio.cutinSend" })).toBeTruthy());
  });
  it("does not claim success or retry after a failed or unknown response", async () => {
    trigger.mockRejectedValue(new Error("lost response"));
    render(<LiveCutinControl eventId="event-a" />);
    fireEvent.change(screen.getByLabelText("studio.cutinMessage"), { target: { value: "直接の演出文" } });
    fireEvent.click(screen.getByRole("button", { name: "studio.cutinSend" }));
    await waitFor(() => expect(screen.getByText("studio.cutinUnknown")).toBeTruthy());
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("studio.cutinSent")).toBeNull();
    fireEvent.change(screen.getByLabelText("studio.cutinMessage"), { target: { value: "A".repeat(41) } });
    expect(screen.getByRole("button", { name: "studio.cutinSend" }).hasAttribute("disabled")).toBe(true);
  });
});
