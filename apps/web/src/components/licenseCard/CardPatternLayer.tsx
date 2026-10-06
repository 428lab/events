import { memo } from "react";
import { BuiltinBackgroundLayer } from "./BuiltinBackgroundLayer.js";
import { cardPatternNodes, type ResolvedCardPattern } from "./cardPattern.js";

/** A name card's pattern background, on white. Memoised on the pattern triple so a re-render never regenerates or re-diffs the lines. */
export const CardPatternLayer = memo(function CardPatternLayer({ pattern }: { pattern: ResolvedCardPattern }) {
  return <g data-card-pattern={`${pattern.key}-${pattern.palette}`} data-card-pattern-strength={pattern.strength}>
    <BuiltinBackgroundLayer nodes={cardPatternNodes(pattern)} />
  </g>;
}, (a, b) => a.pattern.key === b.pattern.key && a.pattern.palette === b.pattern.palette && a.pattern.strength === b.pattern.strength);
