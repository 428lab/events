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
