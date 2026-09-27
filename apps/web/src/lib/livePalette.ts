const safe = new Set(["#FB923C", "#2DD4BF", "#FBBF24", "#7DD3FC"]);
export function livePalette(colors: string[], property: "color" | "background-color") {
  if (colors.length < 2 || colors.length > 4 || colors.some(c => !safe.has(c))) return null;
  const name = `live-cycle-${property.replace("-", "")}-${colors.map(c => c.slice(1)).join("-")}`;
  const stops = [...colors, colors[0]].map((color, i) => `${i * 100 / colors.length}% { ${property}: ${color}; }`).join(" ");
  return { name, css: `@keyframes ${name} { ${stops} }` };
}
