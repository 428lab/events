import { eventScheduleRepo } from "../db/repositories/eventSchedule.js";

/** 1回の実行で取得する最大件数（サブリクエスト上限・実行時間の安全弁） */
const MAX_ITEMS_PER_RUN = 20;
/** レスポンス本文の読み取り上限（OG メタは先頭にあるので十分） */
const MAX_BODY_BYTES = 200 * 1024;
/** 取得タイムアウト（ms） */
const FETCH_TIMEOUT_MS = 5000;
/** キャッシュする OG 画像 URL の最大長 */
const MAX_OG_IMAGE_LEN = 600;

/** SSRF の安価なガード：明らかにローカル/プライベートを指すホスト名を弾く。
 * DNS 解決まではしない（Workers の fetch は内部アドレスに届かない前提の追加防御） */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".local") || h === "") return true;
  // IPv6 ループバック等
  if (h === "::1" || h.startsWith("fe80:") || h.startsWith("fd") || h.startsWith("fc")) {
    return true;
  }
  // IPv4 リテラルのプライベート/ループバック/リンクローカル帯
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
}

/** HTML から og:image（無ければ og:image:secure_url）の URL を抜き出す。
 * meta タグの属性順（property→content / content→property）両対応。無ければ null */
export function parseOgImage(html: string): string | null {
  for (const prop of ["og:image", "og:image:secure_url"]) {
    // <meta property="og:image" content="..."> 形式
    const re1 = new RegExp(
      `<meta[^>]*\\bproperty=["']${prop}["'][^>]*\\bcontent=["']([^"']+)["']`,
      "i",
    );
    // <meta content="..." property="og:image"> 形式（属性順が逆）
    const re2 = new RegExp(
      `<meta[^>]*\\bcontent=["']([^"']+)["'][^>]*\\bproperty=["']${prop}["']`,
      "i",
    );
    const found = re1.exec(html)?.[1] ?? re2.exec(html)?.[1];
    if (found) return found;
  }
  return null;
}

/** URL を GET して本文先頭を読み、og:image の URL を返す（見つからなければ ""） */
async function fetchOgImage(url: string): Promise<string> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
  if (isPrivateHost(parsed.hostname)) return "";

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": "eventer-og-fetcher" },
    });
    if (!res.ok || !res.body) return "";
    // 本文は先頭 MAX_BODY_BYTES だけ読む（巨大ページ対策）
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < MAX_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
    await reader.cancel().catch(() => {});
    const merged = new Uint8Array(Math.min(total, MAX_BODY_BYTES));
    let offset = 0;
    for (const c of chunks) {
      const take = Math.min(c.byteLength, merged.length - offset);
      merged.set(c.subarray(0, take), offset);
      offset += take;
      if (offset >= merged.length) break;
    }
    const html = new TextDecoder("utf-8").decode(merged);
    const image = parseOgImage(html);
    // <img src> に使うので https のみ許可。長すぎる URL はキャッシュしない
    if (image && image.startsWith("https://") && image.length <= MAX_OG_IMAGE_LEN) {
      return image;
    }
    return "";
  } finally {
    clearTimeout(timer);
  }
}

/** イベントの資料URLの OG 画像をバックグラウンドで取得してキャッシュする (#149)。
 * material_og_url !== material_url の項目だけが対象。失敗しても og_url を埋めて
 * 同じ URL を永久に再取得し続けないようにする。 */
export async function refreshMaterialMeta(eventId: string): Promise<void> {
  const targets = await eventScheduleRepo.listNeedingOgRefresh(
    eventId,
    MAX_ITEMS_PER_RUN,
  );
  for (const t of targets) {
    let image = "";
    try {
      image = await fetchOgImage(t.materialUrl);
    } catch {
      // 取得失敗（タイムアウト・不正URL等）は画像なしとしてキャッシュする
    }
    try {
      await eventScheduleRepo.setOgMeta(t.id, image, t.materialUrl);
    } catch {
      // DB 書き込み失敗は次回の保存時に再試行される
    }
  }
}
