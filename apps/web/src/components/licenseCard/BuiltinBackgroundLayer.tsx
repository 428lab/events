import { createElement, type ReactNode } from "react";
import type { BgNode } from "./builtinBackgrounds.js";

/** builtinBackgrounds の要素木を React の SVG 要素に起こす（stroke-width → strokeWidth） */
const camel = (name: string) => name.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
function toReact(node: BgNode, key: number): ReactNode {
  const props: Record<string, string | number> = { key };
  for (const [name, value] of Object.entries(node.attrs)) props[camel(name)] = value;
  return createElement(node.tag, props, ...(node.children ?? []).map(toReact));
}
export function BuiltinBackgroundLayer({ nodes }: { nodes: BgNode[] }) {
  return <g data-builtin-background="">{nodes.map(toReact)}</g>;
}
