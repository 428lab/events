interface Axis {
  label: string;
  value: number;
}

/** 依存なしの軽量レーダーチャート（SVG） */
export function RadarChart({
  axes,
  size = 280,
  color = "#14B8A6",
}: {
  axes: Axis[];
  size?: number;
  color?: string;
}) {
  const n = axes.length;
  if (n < 3) {
    // 3軸未満はレーダーにできないので数値表示
    return (
      <div style={{ fontSize: 14 }}>
        {axes.map((a) => (
          <div key={a.label}>
            {a.label}: {a.value}
          </div>
        ))}
      </div>
    );
  }
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 40;
  const max = Math.max(1, ...axes.map((a) => a.value));

  const pt = (i: number, radius: number) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  };

  const gridLevels = [0.25, 0.5, 0.75, 1];
  const valuePoints = axes
    .map((a, i) => pt(i, (a.value / max) * r))
    .map(([x, y]) => `${x},${y}`)
    .join(" ");

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {gridLevels.map((lv) => (
        <polygon
          key={lv}
          points={axes
            .map((_a, i) => pt(i, r * lv))
            .map(([x, y]) => `${x},${y}`)
            .join(" ")}
          fill="none"
          stroke="#ddd"
          strokeWidth={1}
        />
      ))}
      {axes.map((_a, i) => {
        const [x, y] = pt(i, r);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#ddd" />;
      })}
      <polygon
        points={valuePoints}
        fill={color}
        fillOpacity={0.35}
        stroke={color}
        strokeWidth={2}
      />
      {axes.map((a, i) => {
        const [x, y] = pt(i, r + 18);
        return (
          <text
            key={a.label}
            x={x}
            y={y}
            fontSize={12}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#444"
          >
            {a.label}
          </text>
        );
      })}
    </svg>
  );
}
