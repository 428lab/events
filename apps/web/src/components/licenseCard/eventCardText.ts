import { textUnits } from "./cardText.js";

/** Keep glyph proportions. Prefer wrapping over squeezing a long name horizontally. */
export function fitCardText(text: string, width: number, height: number, preferred: number, measure = textUnits) {
  const paragraphs = text.split("\n");
  let best = { lines: paragraphs, size: 0 };
  const longest = Math.max(1, ...paragraphs.map(measure));
  for (let count = 1; count <= 4; count++) {
    const limit = longest / count;
    const lines: string[] = [];
    for (const paragraph of paragraphs) {
      let line = "";
      for (const char of paragraph) {
        if (line && measure(line + char) > limit) {
          // Prefer a word boundary when it doesn't produce a nearly empty line.
          const space = line.lastIndexOf(" ");
          if (space > line.length / 2) { lines.push(line.slice(0, space)); line = line.slice(space + 1); }
          else { lines.push(line); line = ""; }
        }
        line += char;
      }
      lines.push(line);
    }
    const size = Math.min(preferred, height / (Math.max(1, lines.length) * 1.25),
      width / Math.max(1, ...lines.map(measure)));
    if (size > best.size) best = { lines, size };
  }
  return best;
}
