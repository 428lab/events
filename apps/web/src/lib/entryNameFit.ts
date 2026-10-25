/**
 * 大きく出すエントリー名（個人名・チーム名）の文字サイズ。発表画面と表彰式のカードで使う。
 *
 * 見出しの幅（コンテナクエリの 100cqi）を名前の「幅の目安」で割り、最大〜最小の間に収める。
 * 「チーム・いぬ」くらいの名前は1行に収まるまで縮み、最小まで縮んでも入らない長い名前だけが
 * 折り返す（ENTRY_NAME_WRAP_SX）。描画後に測らないので、ちらつきも再計算もない。
 */

/** 全角（かな・漢字・全角記号）は1文字＝1em、それ以外（英数字・半角記号・空白）は約0.6em。
 * 太字の和文は字幅がほぼ1em、欧文の平均字幅は0.55〜0.6em程度 */
function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    code >= 0x1f300
  );
}

/** 名前の幅の目安（em）。少し余裕（4%）を持たせて、字詰めの誤差で折り返さないようにする */
export function entryNameWidthEm(name: string): number {
  let em = 0;
  for (const ch of name) em += isWide(ch.codePointAt(0)!) ? 1 : 0.6;
  return Math.max(em, 1) * 1.04;
}

/** 見出しの fontSize。親（または自身の祖先）に containerType: "inline-size" が要る。
 * reservePx は同じ行に並ぶアイコンなど、名前以外が使う幅 */
export function entryNameFontSize(
  name: string,
  { minPx, maxPx, reservePx = 0 }: { minPx: number; maxPx: number; reservePx?: number },
): string {
  const em = Number(entryNameWidthEm(name).toFixed(2));
  const available = reservePx > 0 ? `(100cqi - ${reservePx}px)` : "100cqi";
  return `clamp(${minPx}px, calc(${available} / ${em}), ${maxPx}px)`;
}

/** 最小まで縮んでも入らない名前の折り返し。日本語は文節（auto-phrase 非対応なら語の途中で
 * 割らない keep-all）で、それでも入らなければどこでも折る。1〜2文字ずつの折り返しやはみ出しを防ぐ */
export const ENTRY_NAME_WRAP_SX = {
  wordBreak: "keep-all",
  overflowWrap: "anywhere",
  "@supports (word-break: auto-phrase)": { wordBreak: "auto-phrase" },
} as const;
