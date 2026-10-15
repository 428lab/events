/** 日別の棒グラフの縦軸を何等分するか。左右の軸で同じ数にして、補助線を共有する */
export const AXIS_DIVISIONS = 4;

export interface ChartAxis {
  /** 棒の高さは value / scaleMax で決める。いちばん上の目盛りと同じ値 */
  scaleMax: number;
  /** 下から順の目盛りの値。すべて整数 */
  ticks: number[];
}

/**
 * 系列の最大値から縦軸を決める。目盛りの間隔は 1/2/2.5/5 × 10^n のうち整数になるもの
 * （1, 2, 5, 10, 20, 25, 50, 100, 200, 250, ...）から、AXIS_DIVISIONS 個で最大値に届く
 * いちばん小さいものを選ぶ。例: 97 → 0/25/50/75/100。
 * 全部 0 の系列は目盛りを 0 だけにする（棒はどれも高さ 0 なので scaleMax は割り算用の 1）。
 */
export function niceAxis(max: number): ChartAxis {
  if (!(max > 0)) return { scaleMax: 1, ticks: [0] };
  for (let pow = 1; ; pow *= 10) {
    for (const m of [1, 2, 2.5, 5]) {
      const step = m * pow;
      if (Number.isInteger(step) && step * AXIS_DIVISIONS >= max) {
        const ticks = Array.from({ length: AXIS_DIVISIONS + 1 }, (_, i) => i * step);
        return { scaleMax: step * AXIS_DIVISIONS, ticks };
      }
    }
  }
}

/** 縦軸の目盛りの文字。軸の幅を一定に保つため 1000 以上は k で縮める（1250 → 1.25k） */
export function formatAxisTick(v: number): string {
  if (v < 1000) return String(v);
  return `${Number((v / 1000).toFixed(2))}k`;
}
