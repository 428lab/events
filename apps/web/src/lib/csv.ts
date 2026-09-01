/**
 * CSV 生成とダウンロード (#447)。
 *
 * - エスケープは RFC 4180: カンマ・ダブルクォート・改行を含むフィールドを
 *   ダブルクォートで囲み、中のダブルクォートは2つ重ねる
 * - **UTF-8 BOM 付き**で出す（Excel が BOM 無し UTF-8 を文字化けさせるため）
 * - 生成はクライアント側（表ビューと同じデータから作る。サーバーに
 *   新しい配信経路を作らない）
 */

/** 1フィールドを RFC 4180 でエスケープする */
export function escapeCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** 行列 → CSV 文字列（CRLF 区切り。RFC 4180 の既定） */
export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCsvField).join(",")).join("\r\n");
}

/** UTF-8 BOM。Blob の先頭に付ける（文字列比較のテストでも使う） */
export const CSV_BOM = "\uFEFF";

/** CSV をファイルとしてダウンロードさせる */
export function downloadCsv(filename: string, rows: string[][]): void {
  const blob = new Blob([CSV_BOM + toCsv(rows)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
