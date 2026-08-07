import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrendChart } from "./KpiTiles.js";

/** 推移グラフの縦軸 (#290)。
 * 棒の高さだけでは値が読めず、ツールチップはタッチ端末で開けないので、
 * 目盛りが出ていること自体をテストで固定する。 */
describe("TrendChart の縦軸", () => {
  const series = [{ key: "v", label: "値", color: "#1976d2" }];
  const points = (values: number[]) =>
    values.map((v, i) => ({
      day: `2026-08-${String(i + 1).padStart(2, "0")}`,
      values: { v },
    }));

  it("目盛り（0・中間・上限）が出る", () => {
    render(
      <TrendChart title="登録数" points={points([2, 8, 5])} series={series} />,
    );
    // 上限は実データの最大値(8)ではなく、きりのいい 10 に切り上がる
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("値が小さいときも目盛りが潰れない", () => {
    render(
      <TrendChart title="登録数" points={points([0, 1, 2])} series={series} />,
    );
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("中間の目盛りが整数になる（半端な数を出さない）", () => {
    render(
      <TrendChart title="登録数" points={points([3, 1])} series={series} />,
    );
    // 上限は 4 に切り上がり、中間は 2
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("桁が大きいときは短く出す（軸の幅が破綻しない）", () => {
    render(
      <TrendChart
        title="閲覧数"
        points={points([12000, 3000, 8000])}
        series={series}
      />,
    );
    expect(screen.getByText("20k")).toBeInTheDocument();
    expect(screen.getByText("10k")).toBeInTheDocument();
  });

  it("データが無いときは目盛りを出さない", () => {
    render(<TrendChart title="登録数" points={[]} series={series} />);
    expect(screen.getByText("データなし")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
