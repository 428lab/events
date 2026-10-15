import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { AdminStats } from "@eventer/shared";
import { TrendChart } from "./AdminStatsPage.js";

/** サイト全体のアクセス統計の日別の推移も、棒をタップした日の実数を上に出す */
const daily: AdminStats["daily"] = [
  { day: "2026-10-07", views: 812, joins: 41 },
  { day: "2026-10-08", views: 1290, joins: 63 },
];

const renderChart = (showJoins = true) =>
  render(
    <TrendChart
      daily={daily}
      showViews
      showJoins={showJoins}
      onToggleViews={() => undefined}
      onToggleJoins={() => undefined}
    />,
  );
const dayButtons = () => screen.getAllByRole("button");
const selectedLine = () => screen.getByTestId("daily-chart-selected");

it("shows the tapped day's site-wide counts and closes on a second tap", () => {
  renderChart();
  expect(dayButtons()).toHaveLength(2);
  fireEvent.click(dayButtons()[1]);
  expect(selectedLine().textContent).toBe("2026-10-08  PV:1290 / 参加:63");
  fireEvent.click(dayButtons()[0]);
  expect(selectedLine().textContent).toBe("2026-10-07  PV:812 / 参加:41");
  fireEvent.click(dayButtons()[0]);
  expect(selectedLine().textContent).toBe("棒をタップすると、その日の数が出ます");
});

it("still shows both real counts when a series is hidden by its switch", () => {
  renderChart(false);
  fireEvent.click(dayButtons()[0]);
  expect(selectedLine().textContent).toBe("2026-10-07  PV:812 / 参加:41");
});

const axis = (side: "left" | "right") => screen.queryByTestId(`daily-chart-axis-${side}`);
const axisTicks = (side: "left" | "right") =>
  Array.from(axis(side)!.querySelectorAll("p")).map((el) => el.textContent);

it("shows the PV scale on the left and the join scale on the right", () => {
  renderChart();
  expect(axisTicks("left")).toEqual(["0", "500", "1k", "1.5k", "2k"]);
  expect(axisTicks("right")).toEqual(["0", "20", "40", "60", "80"]);
});

it("hides the join axis and its bars when the join series is switched off", () => {
  renderChart(false);
  expect(axisTicks("left")).toEqual(["0", "500", "1k", "1.5k", "2k"]);
  expect(axis("right")).toBeNull();
  // 1日に PV の棒だけ（2日分で2本）。1290/2000 の高さ
  const bars = screen.getAllByTestId("daily-chart-bar");
  expect(bars).toHaveLength(2);
  expect(getComputedStyle(bars[1]).height).toBe(`${(1290 / 2000) * 110}px`);
});
