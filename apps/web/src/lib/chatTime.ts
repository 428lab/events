/**
 * チャットの時刻表示。イベントチャット (#199) とスタッフチャット (#382) が
 * 同じ書式で出す（両方に逐語コピーがあったので1か所に寄せた #335）。
 */

/** メッセージ時刻の表示（HH:mm:ss）。Nostr の created_at は**秒** */
export function formatChatTime(createdAtSec: number): string {
  const d = new Date(createdAtSec * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
