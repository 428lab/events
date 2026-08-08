/** 外向き fetch（OGサムネイル取得 #149・アイコン取り込み #312）で共有する
 * SSRF ガード。取得先URLをユーザーが指定できる経路が複数あるため、判定は
 * ここ1箇所に置く（片方だけ緩い、という状態を作らない）。 */

/** IPv4 のプライベート/ループバック/リンクローカル帯か（数値4組で判定） */
function isPrivateIpv4(a: number, b: number): boolean {
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

/** SSRF の安価なガード：明らかにローカル/プライベートを指すホスト名を弾く。
 * DNS 解決まではしない（Workers の fetch は内部アドレスに届かない前提の追加防御）。
 * 10進/8進/16進IPやuserinfo偽装は WHATWG URL の正規化後に評価されるため素通りしない */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".local") || h === "") return true;
  // IPv6 リテラル（":" を含む場合のみ。fc2.com 等の通常ホスト名を誤検知しない）
  if (h.includes(":")) {
    if (h === "::1") return true;
    // リンクローカル fe80::/10（fe80〜febf）・ULA fc00::/7（fc/fd 始まり）
    if (/^fe[89ab][0-9a-f]?:/.test(h) || /^f[cd][0-9a-f]{2}:/.test(h)) return true;
    // IPv4射影（::ffff:127.0.0.1 → ::ffff:7f00:1 に正規化される）を v4 として再評価
    const mapped = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mapped) {
      const hi = parseInt(mapped[1], 16);
      const lo = parseInt(mapped[2], 16);
      return isPrivateIpv4(hi >> 8, hi & 0xff) || Number.isNaN(lo);
    }
    // 判定できない IPv6 リテラルは安全側で拒否（公開サイトのv6直指定はまず無い）
    return true;
  }
  // IPv4 リテラル
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) return isPrivateIpv4(Number(m[1]), Number(m[2]));
  return false;
}

/** リダイレクトの最大追跡数（各ホップでプライベートホストを再検証する） */
export const MAX_REDIRECTS = 3;
