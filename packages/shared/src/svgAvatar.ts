/** SVG のユーザーアイコン (#576)。
 *
 * 中身は**サニタイズしない**（保存も配信もアップロードされたバイト列のまま）。
 * 安全はここではなく表示側と配信側で担保する:
 * - アプリ内では `<img>` か自前SVGカードの `<image href>` でしか表示しない
 *   （画像として読み込まれたSVGはスクリプトを実行しない）
 * - 配信 (routes/avatarImages.ts) は CSP `sandbox` と nosniff を付け、
 *   URLを直接開かれてもスクリプトが動かないようにする
 *
 * ここで見るのは「SVG文書として成り立っているか」の最小限だけ。
 * サーバーの受け入れ判定と、Webの切り抜き（ルート要素の属性だけを書き換える）
 * で同じ判定を使うため shared に置いている。 */

export const AVATAR_SVG = {
  maxBytes: 200 * 1024, // 200KB
  mime: "image/svg+xml",
} as const;

const SVG_NS = "http://www.w3.org/2000/svg";

/** 開始タグ（属性値に `<` を含めないのは XML の規則どおり） */
const START_TAG =
  /<([A-Za-z_][\w.:-]*)((?:\s+[^\s=/>"'<]+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>/y;
const END_TAG = /<\/([A-Za-z_][\w.:-]*)\s*>/y;
const ATTRIBUTE = /([^\s=/>"'<]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export interface SvgRootTag {
  /** 文書中でのルート開始タグの位置 [start, end) */
  start: number;
  end: number;
  name: string;
  attributes: Array<[name: string, value: string]>;
  selfClosing: boolean;
}

function parseAttributes(source: string): Array<[string, string]> {
  return [...source.matchAll(ATTRIBUTE)].map(m => [m[1]!, m[2] ?? m[3] ?? ""]);
}

/** ルート要素が SVG 名前空間の `svg` か（接頭辞付き `x:svg` も可） */
function isSvgRoot(name: string, attributes: Array<[string, string]>): boolean {
  const colon = name.indexOf(":");
  const local = colon < 0 ? name : name.slice(colon + 1);
  const nsAttribute = colon < 0 ? "xmlns" : `xmlns:${name.slice(0, colon)}`;
  return local === "svg" && attributes.some(([n, v]) => n === nsAttribute && v === SVG_NS);
}

/** DOCTYPE（内部サブセット `[...]` と引用符を考慮）の終わりの次の位置。閉じていなければ -1 */
function skipDoctype(text: string, from: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "[") depth++;
    else if (ch === "]") depth--;
    else if (ch === ">" && depth <= 0) return i + 1;
  }
  return -1;
}

/** SVG文書として最小限成り立っているかを見て、ルート開始タグを返す。
 * - ルート要素が1つだけで、SVG 名前空間の `svg` であること
 * - 開始/終了タグが対応していること、ルートの外にテキストが無いこと
 * - コメント・処理命令・CDATA・DOCTYPE が閉じていること
 * 完全な XML パーサではない（実体参照や属性の重複は見ない）。
 * 成り立っていなければ null */
export function parseSvgAvatar(text: string): SvgRootTag | null {
  const stack: string[] = [];
  let root: SvgRootTag | null = null;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (i < text.length) {
    if (text[i] !== "<") {
      const next = text.indexOf("<", i);
      const end = next < 0 ? text.length : next;
      if (stack.length === 0 && text.slice(i, end).trim() !== "") return null;
      i = end;
      continue;
    }
    if (text.startsWith("<!--", i)) {
      const e = text.indexOf("-->", i + 4);
      if (e < 0) return null;
      i = e + 3;
    } else if (text.startsWith("<?", i)) {
      const e = text.indexOf("?>", i + 2);
      if (e < 0) return null;
      i = e + 2;
    } else if (text.startsWith("<![CDATA[", i)) {
      const e = text.indexOf("]]>", i + 9);
      if (stack.length === 0 || e < 0) return null;
      i = e + 3;
    } else if (text.startsWith("<!DOCTYPE", i)) {
      if (root) return null;
      i = skipDoctype(text, i + 9);
      if (i < 0) return null;
    } else if (text[i + 1] === "/") {
      END_TAG.lastIndex = i;
      const m = END_TAG.exec(text);
      if (!m || stack.pop() !== m[1]) return null;
      i = END_TAG.lastIndex;
    } else {
      START_TAG.lastIndex = i;
      const m = START_TAG.exec(text);
      if (!m) return null;
      if (stack.length === 0) {
        if (root) return null; // ルート要素が2つ
        const attributes = parseAttributes(m[2]!);
        if (!isSvgRoot(m[1]!, attributes)) return null;
        root = { start: i, end: START_TAG.lastIndex, name: m[1]!, attributes, selfClosing: m[3] === "/" };
      }
      if (m[3] !== "/") stack.push(m[1]!);
      i = START_TAG.lastIndex;
    }
  }
  return root && stack.length === 0 ? root : null;
}

/** gzip 圧縮した SVG (SVGZ) の先頭2バイト。アイコンとしては受け付けない */
export function isGzip(head: Uint8Array): boolean {
  return head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b;
}

/** バイト列が SVG アイコンとして受け付けられるか（UTF-8・非gzip・上限内・SVG文書） */
export function isSvgAvatarBytes(bytes: Uint8Array): boolean {
  if (bytes.byteLength === 0 || bytes.byteLength > AVATAR_SVG.maxBytes || isGzip(bytes)) return false;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return false;
  }
  return parseSvgAvatar(text) !== null;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** ルート開始タグの属性だけを差し替えた文書を返す。中身（子要素以降）は1バイトも触らない。
 * `set` に挙げた属性は既存のものを消してから末尾に付け直す */
export function rewriteSvgRootAttributes(text: string, root: SvgRootTag, set: Record<string, string>): string {
  const kept = root.attributes.filter(([n]) => !(n in set));
  const attributes = [...kept, ...Object.entries(set)]
    .map(([n, v]) => ` ${n}="${escapeAttribute(v)}"`).join("");
  const tag = `<${root.name}${attributes}${root.selfClosing ? "/" : ""}>`;
  return text.slice(0, root.start) + tag + text.slice(root.end);
}

export interface SvgBox { x: number; y: number; width: number; height: number }

/** px か単位なしの長さだけを数値にする（% や mm は表示サイズを決められないので null） */
function pixelLength(value: string | undefined): number | null {
  const m = value?.trim().match(/^(\d+(?:\.\d+)?|\.\d+)(px)?$/);
  const n = m ? Number(m[1]) : NaN;
  return n > 0 ? n : null;
}

/** ルートが描く範囲（ユーザー座標）。viewBox があればそれ、無ければ px の width/height。
 * どちらも無いと切り抜き位置を決められないので null */
export function svgRootBox(root: SvgRootTag): SvgBox | null {
  const attr = (name: string) => root.attributes.find(([n]) => n === name)?.[1];
  const vb = attr("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (vb && vb.length === 4 && vb.every(Number.isFinite) && vb[2]! > 0 && vb[3]! > 0) {
    return { x: vb[0]!, y: vb[1]!, width: vb[2]!, height: vb[3]! };
  }
  const width = pixelLength(attr("width")), height = pixelLength(attr("height"));
  return width && height ? { x: 0, y: 0, width, height } : null;
}
