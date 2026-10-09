/**
 * チャットの時刻表示。イベントチャット (#199) とスタッフチャット (#382) が
 * 同じ書式で出す（両方に逐語コピーがあったので1か所に寄せた #335）。
 */

/** メッセージ日時の表示（YYYY/MM/DD HH:mm:ss、端末の時刻帯）。
 * 日をまたいだ過去の発言も区別できるよう年月日を付ける。Nostr の created_at は**秒** */
export function formatChatTime(createdAtSec: number): string {
  const d = new Date(createdAtSec * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
