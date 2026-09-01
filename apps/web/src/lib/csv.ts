/**
 * CSV 生成とダウンロード (#447)。
 *
 * - エスケープは RFC 4180: カンマ・ダブルクォート・改行を含むフィールドを
 *   ダブルクォートで囲み、中のダブルクォートは2つ重ねる
 * - **UTF-8 BOM 付き**で出す（Excel が BOM 無し UTF-8 を文字化けさせるため）
 * - 生成はクライアント側（表ビューと同じデータから作る。サーバーに
 *   新しい配信経路を作らない）
 */

/** 1フィールドをエスケープする。
 * RFC 4180 に加えて、**数式インジェクション対策**として先頭が = + - @ TAB CR の
 * セルに ' を前置する（表計算ソフトが式として実行するのを防ぐ。回答は
 * 見知らぬ人の自由入力なので必須） */
export function escapeCsvField(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded)
    ? `"${guarded.replace(/"/g, '""')}"`
    : guarded;
}

/** 行列 → CSV 文字列（CRLF 区切り。RFC 4180 の既定） */
export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCsvField).join(",")).join("\r\n");
}

/** UTF-8 BOM。Blob の先頭に付ける（文字列比較のテストでも使う） */
export const CSV_BOM = "\uFEFF";

/** CSV をファイルとしてダウンロードさせる。
 * DOM に追加してから click し、revoke は次のティックへ（追加せずに click すると
 * 一部ブラウザで発火せず、即 revoke だと保存前に URL が死ぬ——定石の形） */
export function downloadCsv(filename: string, rows: string[][]): void {
  const blob = new Blob([CSV_BOM + toCsv(rows)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
