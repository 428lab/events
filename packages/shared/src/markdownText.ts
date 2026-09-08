/**
 * Markdown をざっくりプレーンテキスト化する（抜粋用）。
 *
 * メールの説明冒頭 (#126) と Google カレンダーの本文 (#487) で同じものを使う。
 * どちらも「レンダラの無い場所に流し込む」用途で、`##` や `**` が
 * そのまま見えると読みにくい。厳密な Markdown パーサではない。
 * リンクはテキストだけ残し、画像・記号マーカーは除去、空白は1つに畳む。
 */
export function stripMarkdown(src: string): string {
  return src
    .replace(/```[\s\S]*?```/g, " ") // コードブロック
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // 画像
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // リンク → テキストのみ
    .replace(/^#{1,6}\s+/gm, "") // 見出しマーカー
    .replace(/^\s{0,3}>\s?/gm, "") // 引用マーカー
    .replace(/^\s*[-*+]\s+/gm, "") // 箇条書きマーカー
    .replace(/[*_~`]/g, "") // 強調・コード記号
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * コードポイント単位で切り詰める。`String.prototype.slice` は UTF-16 単位なので、
 * 絵文字やサロゲートペアの漢字を境目で割ると U+FFFD が末尾に混ざる
 */
export function truncateCodePoints(s: string, max: number): string {
  const cps = Array.from(s);
  return cps.length <= max ? s : cps.slice(0, max).join("");
}
