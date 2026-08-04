/**
 * チャット本文のURL検出・分割 (#241)。
 * リンク化する対象は http(s) スキームのみ。javascript: 等の他スキームは
 * 正規表現の時点でマッチしないため絶対にリンク化されない。
 */

/** URLとして許可する文字（RFC 3986 のASCII範囲）。日本語等の非ASCIIは
 * URLに含めない＝日本語文がURL直後に続いてもそこでURLが終わる */
const URL_RE = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/gi;

/** URL末尾に食い込みがちな句読点・閉じ括弧を切り落とす。
 * `)` `]` はURL内で対応する開き括弧が足りないときだけ除去
 * （Wikipedia の `...(foo)` 型URLを壊さない） */
function trimTrailingPunct(url: string): string {
  let u = url;
  for (;;) {
    const last = u.charAt(u.length - 1);
    if (/[.,;:!?'"]/.test(last)) {
      u = u.slice(0, -1);
      continue;
    }
    if (last === ")" || last === "]") {
      const open = last === ")" ? "(" : "[";
      let balance = 0;
      for (const ch of u) {
        if (ch === open) balance++;
        else if (ch === last) balance--;
      }
      // 閉じの方が多い＝文側の括弧が食い込んでいる
      if (balance < 0) {
        u = u.slice(0, -1);
        continue;
      }
    }
    break;
  }
  return u;
}

export interface ChatToken {
  type: "text" | "url";
  value: string;
}

/** 本文をテキストとURLのトークン列に分割する。切り落とした末尾句読点は
 * 後続のテキストトークンに戻す */
export function splitByUrls(text: string): ChatToken[] {
  const tokens: ChatToken[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    const url = trimTrailingPunct(m[0]);
    if (!url) continue;
    if (start > last) tokens.push({ type: "text", value: text.slice(last, start) });
    tokens.push({ type: "url", value: url });
    last = start + url.length;
  }
  if (last < text.length) tokens.push({ type: "text", value: text.slice(last) });
  return tokens;
}

/** 本文にリンク化対象のURLが含まれるか（送信ガードと描画で共用） */
export function containsUrl(text: string): boolean {
  return splitByUrls(text).some((t) => t.type === "url");
}

/** 画像としてインライン表示するURLか（拡張子判定・クエリ付き許容） */
export function detectImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return /\.(png|jpe?g|gif|webp|avif)$/i.test(u.pathname);
  } catch {
    return false;
  }
}
