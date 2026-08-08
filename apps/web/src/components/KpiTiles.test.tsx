import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { addDays } from "@eventer/shared";
import { TrendChart } from "./KpiTiles.js";

/** from から to まで（両端を含む）の日次の点。values は日ごとに作る */
function daysBetween(
  from: string,
  to: string,
  values: (day: string, i: number) => Record<string, number | null>,
) {
  const out: { day: string; values: Record<string, number | null> }[] = [];
  let i = 0;
  for (let day = from; day <= to; day = addDays(day, 1)) {
    out.push({ day, values: values(day, i) });
    i += 1;
  }
  return out;
}

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

/** 粒度の切り替えと月別表示 (#292)。
 * 長い期間を週別で並べると52本になって形が読めないので月別に落とす。 */
describe("TrendChart の粒度", () => {
  const series = [{ key: "v", label: "値", color: "#1976d2" }];
  const flat = (from: string, to: string) =>
    daysBetween(from, to, () => ({ v: 1 }));

  it("60日までは日別", () => {
    render(
      <TrendChart
        title="登録数"
        points={flat("2026-01-01", "2026-02-01")}
        series={series}
      />,
    );
    expect(screen.getByText("登録数（日別）")).toBeInTheDocument();
    // 日別の軸ラベルは「月-日」
    expect(screen.getByText("01-05")).toBeInTheDocument();
  });

  it("90日は週別（月曜始まり・欠けた週は出さない）", () => {
    render(
      <TrendChart
        title="登録数"
        // 2026-01-05 は月曜。90日ぶん
        points={flat("2026-01-05", "2026-04-04")}
        series={series}
      />,
    );
    expect(screen.getByText("登録数（週別）")).toBeInTheDocument();
    expect(
      screen.getByText(
        "月曜始まりの週ごとの集計です。期間の端にある欠けた週は出していません。",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("01-05")).toBeInTheDocument();
  });

  it("半年を超えると月別になり、ラベルが年月になる", () => {
    render(
      <TrendChart
        title="登録数"
        points={flat("2026-01-01", "2026-07-31")}
        series={series}
      />,
    );
    expect(screen.getByText("登録数（月別）")).toBeInTheDocument();
    expect(
      screen.getByText(
        "暦月ごとの集計です。期間の端にある欠けた月は出していません。",
      ),
    ).toBeInTheDocument();
    // 月別で「01-01」と出ると日別と見分けが付かない
    expect(screen.getByText("2026-01")).toBeInTheDocument();
    expect(screen.getByText("2026-07")).toBeInTheDocument();
    expect(screen.queryByText("01-01")).not.toBeInTheDocument();
  });

  it("月別は端の欠けた月を出さない", () => {
    render(
      <TrendChart
        title="登録数"
        // 1月は20日始まり・8月は10日で切れる → 2〜7月だけ出る
        points={flat("2026-01-20", "2026-08-10")}
        series={series}
      />,
    );
    expect(screen.queryByText("2026-01")).not.toBeInTheDocument();
    expect(screen.getByText("2026-02")).toBeInTheDocument();
    expect(screen.getByText("2026-07")).toBeInTheDocument();
    expect(screen.queryByText("2026-08")).not.toBeInTheDocument();
  });

  it("月別の畳み方は指標ごとに変わる（合計・平均・期末）", () => {
    render(
      <TrendChart
        title="アクセス"
        points={daysBetween("2026-01-01", "2026-07-31", (_d, i) => ({
          joins: 1,
          dau: 10,
          mau: 100 + i,
        }))}
        series={[
          { key: "joins", label: "登録", color: "#1976d2" },
          { key: "dau", label: "DAU", color: "#9c27b0", rollup: "average" },
          { key: "mau", label: "MAU", color: "#2e7d32", rollup: "last" },
        ]}
      />,
    );
    // 1月: 登録は31日ぶんの合計、DAU は平均（合計 310 ではない）、
    // MAU は月末 01-31 の値（i:30 → 130。月初 100 でも合計でもない）
    expect(
      screen.getByTitle("2026年1月 登録:31 / DAU:10 / MAU:130"),
    ).toBeInTheDocument();
  });
});

/** 「値が0」と「まだ計測していない」の区別 (#292)。
 * DAU/MAU は計測を始めた日より前が無い。軸だけのグラフを出すと
 * 「ずっと0人だった」に読めてしまう。 */
describe("TrendChart の計測開始の見せ方", () => {
  const series = [{ key: "dau", label: "DAU", color: "#1976d2" }];

  it("期間に計測前が含まれるとき、いつから計測しているかを出す", () => {
    render(
      <TrendChart
        title="DAU の推移"
        points={daysBetween("2026-08-01", "2026-08-30", (day) => ({
          dau: day >= "2026-08-20" ? 3 : null,
        }))}
        measuredFrom="2026-08-20"
        series={series}
      />,
    );
    expect(
      screen.getByText(
        "2026年8月20日から計測しています。それより前は棒を出していません（0ではなく、計測していません）。",
      ),
    ).toBeInTheDocument();
    // 計測済みのぶんはグラフを出す
    expect(screen.getByTitle("2026-08-20 DAU:3")).toBeInTheDocument();
  });

  it("計測開始が期間より前ならその注記は出さない", () => {
    render(
      <TrendChart
        title="DAU の推移"
        points={daysBetween("2026-08-01", "2026-08-30", () => ({ dau: 3 }))}
        measuredFrom="2026-07-01"
        series={series}
      />,
    );
    expect(screen.queryByText(/から計測しています/)).not.toBeInTheDocument();
  });

  it("計測データが1件も無い期間では空のグラフを出さない", () => {
    render(
      <TrendChart
        title="DAU の推移"
        points={daysBetween("2026-06-01", "2026-06-30", () => ({ dau: null }))}
        measuredFrom="2026-08-20"
        series={series}
      />,
    );
    expect(
      screen.getByText(
        "2026年8月20日から計測しています。選んだ期間には計測したデータがまだありません。",
      ),
    ).toBeInTheDocument();
    // 軸（0 の目盛り）も棒も出さない。「全部0」に見えるのを避ける
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.queryByText("06-15")).not.toBeInTheDocument();
  });

  it("一度も計測していないとき（measuredFrom が null）もその旨を出す", () => {
    render(
      <TrendChart
        title="DAU の推移"
        points={daysBetween("2026-06-01", "2026-06-30", () => ({ dau: null }))}
        measuredFrom={null}
        series={series}
      />,
    );
    expect(
      screen.getByText("この期間に計測したデータはありません。"),
    ).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("計測を始めたばかりで完全な週がまだ無いときは、その理由を出す", () => {
    // 週別になる長さ。値があるのは最後の2日だけで、その週は途中なので落ちる。
    // 「データが無い」ではなく「まとまった週がまだ無い」ことを言う (#292)
    render(
      <TrendChart
        title="DAU の推移"
        points={daysBetween("2026-01-05", "2026-04-01", (day) => ({
          dau: day >= "2026-03-31" ? 4 : null,
        }))}
        measuredFrom="2026-03-31"
        series={series}
      />,
    );
    expect(
      screen.getByText(
        "計測できているのは期間の一部だけで、まるまる1週間そろった週がまだありません。短い期間を選ぶと日別で見られます。",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("月別でも同じ理由を月の言い方で出す", () => {
    render(
      <TrendChart
        title="DAU の推移"
        // 8月は10日で切れるので落ちる。値があるのはその8月ぶんだけ
        points={daysBetween("2026-01-01", "2026-08-10", (day) => ({
          dau: day >= "2026-08-01" ? 4 : null,
        }))}
        measuredFrom="2026-08-01"
        series={series}
      />,
    );
    expect(
      screen.getByText(
        "計測できているのは期間の一部だけで、まるまる1か月そろった月がまだありません。短い期間を選ぶと日別で見られます。",
      ),
    ).toBeInTheDocument();
  });

  it("値がすべて 0 の期間はグラフを出す（計測していないのとは違う）", () => {
    render(
      <TrendChart
        title="DAU の推移"
        points={daysBetween("2026-08-01", "2026-08-30", () => ({ dau: 0 }))}
        measuredFrom="2026-07-01"
        series={series}
      />,
    );
    expect(screen.queryByText(/計測したデータ/)).not.toBeInTheDocument();
    expect(screen.getByTitle("2026-08-15 DAU:0")).toBeInTheDocument();
  });
});
