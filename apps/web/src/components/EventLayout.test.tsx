import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";

/** プレゼンモードになったら全員をプレゼン画面へ（オーナー決定 2026-11-13「全員」）。
 * 運営は詳細・採点を見ているときだけ移し、進行画面などの作業ページからは動かさない */

const mocks = vi.hoisted(() => ({ role: "participant" as string, mode: "normal" }));
vi.mock("../api/hooks.js", () => ({
  useEvent: () => ({ data: { event: { contestMode: true }, myRole: mocks.role } }),
}));
vi.mock("../api/scoringHooks.js", () => ({
  useEventState: () => ({ data: { mode: mocks.mode } }),
  useEventStateSignal: () => {},
}));

const { EventLayout } = await import("./EventLayout.js");

function Where() {
  return <div data-testid="path">{useLocation().pathname}</div>;
}
function draw(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/events/:id" element={<EventLayout />}>
          <Route index element={<Where />} />
          <Route path="control" element={<Where />} />
          <Route path="present" element={<Where />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.mode = "normal";
});

it.each([
  ["participant", "/events/e1", "/events/e1/present"],
  ["staff", "/events/e1", "/events/e1/present"],
  ["staff", "/events/e1/control", "/events/e1/control"],
])("%s が %s を開いているときにプレゼンが始まると %s", (role, from, to) => {
  mocks.role = role;
  const view = draw(from);
  expect(screen.getByTestId("path").textContent).toBe(from);
  mocks.mode = "presentation";
  view.rerender(
    <MemoryRouter initialEntries={[from]}>
      <Routes>
        <Route path="/events/:id" element={<EventLayout />}>
          <Route index element={<Where />} />
          <Route path="control" element={<Where />} />
          <Route path="present" element={<Where />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  expect(screen.getByTestId("path").textContent).toBe(to);
});
