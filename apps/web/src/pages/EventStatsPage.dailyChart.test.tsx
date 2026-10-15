import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { EventStats } from "@eventer/shared";
import { DailyChart } from "./EventStatsPage.js";

/** 日別の推移：PVは左、参加は右の縦軸で描き、棒をタップした日の実数を上に出す */
const daily: EventStats["daily"] = [
  { day: "2026-10-07", views: 52, uniques: 20, joins: 6 },
  { day: "2026-10-08", views: 97, uniques: 31, joins: 9 },
  { day: "2026-10-09", views: 25, uniques: 12, joins: 0 },
];

const selectedLine = () => screen.getByTestId("daily-chart-selected");

it("shows the tap hint until a day is chosen", () => {
  render(<DailyChart daily={daily} />);
  expect(selectedLine().textContent).toBe("棒をタップすると、その日の数が出ます");
});

it("shows the tapped day's real counts and switches to another day", () => {
  render(<DailyChart daily={daily} />);
  const days = screen.getAllByRole("button");
  expect(days).toHaveLength(3);

  fireEvent.click(days[1]);
  expect(selectedLine().textContent).toBe("2026-10-08  PV:97 / ユニーク:31 / 参加:9");
  expect(days[1].getAttribute("aria-pressed")).toBe("true");

  fireEvent.click(days[2]);
  expect(selectedLine().textContent).toBe("2026-10-09  PV:25 / ユニーク:12 / 参加:0");
  expect(days[1].getAttribute("aria-pressed")).toBe("false");
});

it("closes the shown day when the same day is tapped again", () => {
  render(<DailyChart daily={daily} />);
  const day = screen.getAllByRole("button")[0];
  fireEvent.click(day);
  expect(selectedLine().textContent).toContain("PV:52");
  fireEvent.click(day);
  expect(selectedLine().textContent).toBe("棒をタップすると、その日の数が出ます");
});

it("gives each day a keyboard-focusable button named with its counts", () => {
  render(<DailyChart daily={daily} />);
  const day = screen.getByRole("button", { name: /^2026-10-07\s+PV:52 \/ ユニーク:20 \/ 参加:6$/ });
  day.focus();
  expect(document.activeElement).toBe(day);
});

const axisTicks = (side: "left" | "right") =>
  Array.from(screen.getByTestId(`daily-chart-axis-${side}`).querySelectorAll("p")).map(
    (el) => el.textContent,
  );
const barHeights = () =>
  screen.getAllByTestId("daily-chart-bar").map((el) => getComputedStyle(el).height);

it("puts the PV scale on the left and the join scale on the right, matching the bar heights", () => {
  render(<DailyChart daily={daily} />);
  // PV の最大 97 → 0〜100、参加の最大 9 → 0〜20（どちらも4等分）
  expect(axisTicks("left")).toEqual(["0", "25", "50", "75", "100"]);
  expect(axisTicks("right")).toEqual(["0", "5", "10", "15", "20"]);
  expect(screen.getAllByTestId("daily-chart-gridline")).toHaveLength(5);
  // 棒の高さ（棒の領域は110px）= 値 / その軸の上限
  // 10-07: PV 52/100, 参加 6/20 / 10-08: 97/100, 9/20 / 10-09: 25/100, 0
  expect(barHeights()).toEqual([
    `${0.52 * 110}px`,
    `${0.3 * 110}px`,
    `${0.97 * 110}px`,
    `${0.45 * 110}px`,
    `${0.25 * 110}px`,
    "0px",
  ]);
});

it("shows only a 0 tick for an all-zero series and draws no bars without NaN", () => {
  render(
    <DailyChart
      daily={[
        { day: "2026-10-07", views: 0, uniques: 0, joins: 0 },
        { day: "2026-10-08", views: 0, uniques: 0, joins: 0 },
      ]}
    />,
  );
  expect(axisTicks("left")).toEqual(["0"]);
  expect(axisTicks("right")).toEqual(["0"]);
  expect(barHeights().every((h) => h === "0px")).toBe(true);
});
