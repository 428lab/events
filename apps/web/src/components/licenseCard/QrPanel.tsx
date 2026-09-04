/** カード右下のQRパネル (#178)。
 *
 * カードのレイアウトとは独立した、QR符号化とモジュール格子の幾何。
 * 置き場所 (`QR`) だけをカードの座標系と共有する (#466)。 */
import { useMemo } from "react";
import QRCode from "qrcode";
import { QR } from "./cardLayout.js";
import { INK } from "./cardTheme.js";

/** QRコードパネル。モックアップと同じ 170x170・白パネル・静穏帯2モジュールで、
 * モジュール矩形の比率（6.3/6.8）とファインダーの描き方（枠線＋中央塗り）も踏襲する */
export function QrPanel({ url }: { url: string }) {
  const qr = useMemo(() => {
    try {
      return QRCode.create(url, { errorCorrectionLevel: "M" });
    } catch {
      return null;
    }
  }, [url]);
  if (!qr) return null;

  const size = qr.modules.size;
  const data = qr.modules.data;
  /** 静穏帯（2モジュール）込みのグリッド幅 */
  const grid = QR.size / (size + 4);
  /** モジュール矩形（僅かな隙間を空けるモックの比率） */
  const cell = grid * (6.3 / 6.8);
  const off = grid * 2;
  /** ファインダーパターン（3隅の7x7）は個別に枠＋中央塗りで描くので除外 */
  const inFinder = (r: number, c: number) =>
    (r < 7 && c < 7) || (r < 7 && c >= size - 7) || (r >= size - 7 && c < 7);

  const modules: JSX.Element[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!data[r * size + c] || inFinder(r, c)) continue;
      modules.push(
        <rect
          key={`${r}-${c}`}
          x={off + c * grid}
          y={off + r * grid}
          width={cell}
          height={cell}
          fill={INK}
        />,
      );
    }
  }
  const finders = [
    [0, 0],
    [size - 7, 0],
    [0, size - 7],
  ].map(([r, c], i) => (
    <g key={i}>
      {/* リング＝外周1モジュール分を正確に塗る（6×6枠＋stroke=1モジュール。
          中心線ストロークだと走査比が崩れて実機デコード不能になる） */}
      <rect
        x={off + (c + 0.5) * grid}
        y={off + (r + 0.5) * grid}
        width={6 * grid}
        height={6 * grid}
        fill="none"
        stroke={INK}
        strokeWidth={grid}
      />
      <rect
        x={off + (c + 2) * grid}
        y={off + (r + 2) * grid}
        width={3 * grid}
        height={3 * grid}
        fill={INK}
      />
    </g>
  ));

  return (
    <g transform={`translate(${QR.x},${QR.y})`}>
      <rect
        width={QR.size}
        height={QR.size}
        rx={10}
        fill="#FFFFFF"
        stroke="#B9C2E2"
      />
      {modules}
      {finders}
    </g>
  );
}
