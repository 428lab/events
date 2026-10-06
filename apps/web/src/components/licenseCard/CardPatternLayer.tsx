import { memo } from "react";
import { BuiltinBackgroundLayer } from "./BuiltinBackgroundLayer.js";
import { cardPatternNodes, type ResolvedCardPattern } from "./cardPattern.js";

/** A name card's pattern background. idPrefix keeps the paper gradient ids unique per card on a sheet.
 * Memoised on the pattern so a re-render never regenerates or re-diffs the lines. */
export const CardPatternLayer = memo(function CardPatternLayer({ pattern, idPrefix }: { pattern: ResolvedCardPattern; idPrefix: string }) {
  return <g data-card-pattern={`${pattern.key}-${pattern.palette}`} data-card-pattern-strength={pattern.strength} data-card-pattern-paper={pattern.paper}>
    <BuiltinBackgroundLayer nodes={cardPatternNodes(pattern, idPrefix)} />
  </g>;
}, (a, b) => a.idPrefix === b.idPrefix && a.pattern.key === b.pattern.key && a.pattern.palette === b.pattern.palette
  && a.pattern.strength === b.pattern.strength && a.pattern.paper === b.pattern.paper);
