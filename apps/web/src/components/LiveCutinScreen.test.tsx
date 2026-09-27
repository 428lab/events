import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CutinStatus } from "@eventer/shared";
import { LiveCutinScreen } from "./LiveCutinScreen.js";
import { LiveCutin } from "./LiveCutin.js";

let snapshot: { data?: CutinStatus; dataUpdatedAt: number; isError: boolean; isFetchedAfterMount: boolean };
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../api/liveControlHooks.js", () => ({ useLiveCutin: () => snapshot }));
const action = (id: string, issuedAt = Date.now()) => ({ actionId: id, message: `${id} 参戦！！`, issuedAt, expiresAt: issuedAt + 8000 });
const status = (id: string | null, serverNow = Date.now(), issuedAt = serverNow): CutinStatus => ({ action: id ? action(id, issuedAt) : null, serverNow });
let update = 1;
function poll(view: ReturnType<typeof render>, id: string | null, serverNow = Date.now(), issuedAt = serverNow) {
  snapshot = { data: status(id, serverNow, issuedAt), dataUpdatedAt: Date.now() + update++, isError: false, isFetchedAfterMount: true };
  view.rerender(<LiveCutinScreen eventId="one" />);
}
beforeEach(() => { sessionStorage.clear(); update = 1; snapshot = { data: undefined, dataUpdatedAt: 0, isError: false, isFetchedAfterMount: false }; Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn().mockReturnValue({ matches: false }) }); });
afterEach(() => vi.useRealTimers());

describe("live screen cut-in polling", () => {
  it("shows action on first valid GET, replaces on second, prevents reload replay but allows a new tab", async () => {
    const view = render(<LiveCutinScreen eventId="one" />);
    poll(view, "first", Date.now());
    await waitFor(() => expect(screen.getByTestId("live-cutin").textContent).toContain("first"));
    expect(sessionStorage.getItem("live-cutin:one")).toBe("first");
    poll(view, "second", Date.now() + 2);
    await waitFor(() => expect(screen.getByTestId("live-cutin").textContent).toContain("second"));
    view.unmount();
    const reload = render(<LiveCutinScreen eventId="one" />);
    expect(screen.queryByTestId("live-cutin")).toBeNull();
    reload.unmount();
    sessionStorage.clear(); // independent new tab
    render(<LiveCutinScreen eventId="one" />);
    await waitFor(() => expect(screen.getByTestId("live-cutin")).toBeTruthy());
  });
  it("shows the last DB action despite an older issue time, but rejects older GETs and expired actions", () => {
    const now = Date.now();
    const view = render(<LiveCutinScreen eventId="one" />);
    poll(view, "first", now);
    expect(screen.getByTestId("live-cutin").textContent).toContain("first");
    poll(view, "last-write", now + 2, now - 1000);
    expect(screen.getByTestId("live-cutin").textContent).toContain("last-write");
    expect(sessionStorage.getItem("live-cutin:one")).toBe("last-write");
    poll(view, "delayed-get", now + 1, now + 1000);
    expect(screen.getByTestId("live-cutin").textContent).toContain("last-write");
    poll(view, "expired", now + 3, now - 9000);
    expect(screen.queryByTestId("live-cutin")).toBeNull();
  });
  it("hides on error, stale, expiry, event change and delayed older response", async () => {
    const view = render(<LiveCutinScreen eventId="one" />);
    poll(view, "first", Date.now());
    expect(screen.getByTestId("live-cutin")).toBeTruthy();
    const earlier = snapshot.data!.serverNow - 100;
    const secondServer = Date.now() + 2;
    poll(view, "second", secondServer);
    expect(screen.getByTestId("live-cutin").textContent).toContain("second");
    poll(view, "first", earlier);
    expect(screen.getByTestId("live-cutin").textContent).toContain("second");
    poll(view, "first", secondServer);
    expect(screen.getByTestId("live-cutin").textContent).toContain("second");
    snapshot = { ...snapshot, isError: true }; view.rerender(<LiveCutinScreen eventId="one" />);
    expect(screen.queryByTestId("live-cutin")).toBeNull();
    poll(view, "second", Date.now() + 3);
    expect(screen.queryByTestId("live-cutin")).toBeNull();
    poll(view, "third", Date.now() + 4);
    expect(screen.getByTestId("live-cutin")).toBeTruthy();
    snapshot = { ...snapshot, dataUpdatedAt: Date.now() - 6000 }; view.rerender(<LiveCutinScreen eventId="one" />);
    expect(screen.queryByTestId("live-cutin")).toBeNull();
    view.rerender(<LiveCutinScreen eventId="two" />);
    expect(screen.queryByTestId("live-cutin")).toBeNull();
    view.unmount();
    snapshot = { data: { action: action("expired", Date.now() - 9000), serverNow: Date.now() }, dataUpdatedAt: Date.now(), isError: false, isFetchedAfterMount: true };
    render(<LiveCutinScreen eventId="three" />);
    expect(screen.queryByTestId("live-cutin")).toBeNull();
  });
  it("fails closed when session storage cannot be used", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw Error("blocked"); });
    snapshot = { data: status("first"), dataUpdatedAt: Date.now(), isError: false, isFetchedAfterMount: true };
    const view = render(<LiveCutinScreen eventId="one" />);
    expect(screen.queryByTestId("live-cutin")).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("studio.cutinStorageError");
    view.unmount(); spy.mockRestore();
  });
  it("uses static fallback when font fails; reduced motion exits in three seconds", async () => {
    Object.defineProperty(document, "fonts", { configurable: true, value: { load: () => Promise.reject(new Error("font unavailable")) } });
    render(<LiveCutin action={{ message: "X 参戦！！" }} />);
    await waitFor(() => expect(screen.getByTestId("live-cutin").className).toContain("live-cutin--static"));
    Reflect.deleteProperty(document, "fonts");
  });
  it("renders safe text in reduced motion then exits", async () => {
    vi.useFakeTimers();
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    render(<LiveCutin action={{ message: "<img src=x onerror=alert(1)>" }} />);
    expect(document.querySelector(".live-cutin img")).toBeNull();
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(screen.queryByTestId("live-cutin")).toBeNull();
  });
});
