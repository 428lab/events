import { AVATAR_IMAGE } from "@eventer/shared";
import { deferBackground, getBucket } from "../runtime.js";
import { normalizeImageMime } from "./imageMime.js";
import { MAX_REDIRECTS, isPrivateHost } from "./urlGuard.js";
import { usersRepo } from "../db/repositories/users.js";

/** アイコン本体の R2 キー。1ユーザー1枚（更新は上書き） (#312)。
 * 世代を分けないのは、退会時の後始末 (purgeDeleted.ts) を1キーで済ませるため。
 * 「古い画像を掴み続ける」問題は配信URLの ?v= と ETag（更新時刻）で解いている */
export const avatarKey = (userId: string) => `avatars/${userId}`;

/** 自ドメインの配信URL。相対パスなのは、環境（本番/staging/ローカル）や
 * 将来のドメイン変更で DB に焼き付いた絶対URLが古くなるのを避けるため。
 * Web は同一オリジンで /api を叩いており、名札PNGの書き出しも fetch で解決できる */
export const avatarUrlFor = (userId: string, updatedAt: number) =>
  `/api/users/${userId}/avatar?v=${updatedAt}`;

/** 取得のタイムアウト。連携先が無反応でも取り込みを引きずらない */
const FETCH_TIMEOUT_MS = 5000;

/** 取得元に名乗る UA。連携先のログで用途が分かるようにする */
const USER_AGENT = "eventer-avatar-fetcher";

/** 本人が取得元URLを自由に書ける経路 (#313) 向けの最小取り込み間隔。
 * ハッシュ比較は「同じ画像なら書き込まない」ためのもので、外向きの取得までは
 * 止められない（毎回違うバイト列を返せば R2 put と D1 update も走る）。
 * 1MB のダウンロードを無制限に踏ませないよう、間隔そのものを制限する。
 * 判定は avatar_sync_attempted_at（＝試みた時刻）で行う */
export const AVATAR_SYNC_MIN_INTERVAL_MS = 10 * 60 * 1000;

/** 取り込みを見送った理由を1行だけ残す。連携先が 403/404 を返す・許可外の
 * Content-Type・サイズ超過は実際に起きるので、無音だと調べようがない。
 * URL 全体やメールアドレスは出さず、ホスト名までに留める */
function skip(userId: string, reason: string, detail = ""): false {
  console.warn(`[avatar] skip user=${userId} reason=${reason}${detail}`);
  return false;
}

/** 連携先が返した値をログに載せる前に丸める。長さ無制限・改行入りの値を
 * そのまま出すと、ログの行を偽装されたりログが肥大したりする */
function logSafe(v: string | undefined): string {
  if (!v) return "(none)";
  return v.slice(0, 64).replace(/[\r\n]/g, " ");
}

/** ログに出してよい範囲のホスト名（URL全体は出さない） */
function hostOf(url: URL | string): string {
  try {
    return typeof url === "string" ? new URL(url).hostname : url.hostname;
  } catch {
    return "?";
  }
}

/** 読まないレスポンスの本文は明示的に捨てる（コネクションを掴んだままにしない） */
function discard(res: Response): void {
  void res.body?.cancel().catch(() => {});
}

/** 上限バイト数まで読み、超えたら null を返す。
 * arrayBuffer() で一気に読むと Content-Length を詐称された巨大レスポンスを
 * そのままメモリに載せてしまうため、チャンク単位で積算して打ち切る */
async function readCapped(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) return null;
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** バイト列の [from, to) を ASCII として読む（シグネチャ判定用） */
function ascii(b: Uint8Array, from: number, to: number): string {
  if (b.byteLength < to) return "";
  let s = "";
  for (let i = from; i < to; i++) s += String.fromCharCode(b[i]!);
  return s;
}

/** AVIF の ftyp ブランド。avif 単体のほか、連番(avis)や汎用(mif1/miaf)も
 * 実際に配信されているので受け入れる（いずれも ISOBMFF の ftyp を必須にしている） */
const AVIF_BRANDS = new Set(["avif", "avis", "mif1", "miaf"]);

/** 宣言された MIME と実バイト列の先頭シグネチャが一致するか。
 * Content-Type だけを信じると、自ドメインの配信URLで任意のバイト列を
 * ホストできてしまう（許可リスト MIME ＋ nosniff で XSS には至らないが、
 * 「自分のドメインで何でも配れる」状態は塞いでおく） */
function matchesSignature(mime: string, b: Uint8Array): boolean {
  switch (mime) {
    case "image/png":
      return b[0] === 0x89 && ascii(b, 1, 4) === "PNG";
    case "image/jpeg":
      return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case "image/gif":
      return ascii(b, 0, 4) === "GIF8";
    case "image/webp":
      return ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP";
    case "image/avif":
      return ascii(b, 4, 8) === "ftyp" && AVIF_BRANDS.has(ascii(b, 8, 12));
    default:
      return false;
  }
}

/** リダイレクトを手動追跡してアイコン本体を取りに行く。
 * ホップごとに https 判定と isPrivateHost 判定をやり直すのが要点で、
 * 「公開ホスト → 302 → http://169.254.169.254/」のような迂回を許さない
 * （取得元URLは本人が自由に書ける (#313)）。取れなければ null */
async function fetchAvatar(
  userId: string,
  start: URL,
  signal: AbortSignal,
): Promise<Response | null> {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // http はサイトが https である以上どのみちブラウザがブロックするので、
    // 取得先は https に限ってよい
    if (current.protocol !== "https:") {
      skip(userId, "scheme", ` scheme=${current.protocol}`);
      return null;
    }
    if (isPrivateHost(current.hostname)) {
      skip(userId, "private-host", ` host=${hostOf(current)}`);
      return null;
    }
    const res = await fetch(current.toString(), {
      redirect: "manual",
      signal,
      headers: { accept: "image/*", "User-Agent": USER_AGENT },
    });
    if (res.status < 300 || res.status >= 400) return res;
    discard(res);
    const loc = res.headers.get("location");
    if (!loc || hop === MAX_REDIRECTS) {
      skip(userId, "redirect", ` host=${hostOf(current)}`);
      return null;
    }
    try {
      current = new URL(loc, current);
    } catch {
      skip(userId, "bad-redirect", ` host=${hostOf(current)}`);
      return null;
    }
  }
  return null;
}

/** 連携先のアイコンURLを取り込んで R2 へ保管し、user.avatar_url を自ドメインの
 * URLへ差し替える (#312)。ログインのたびに呼ぶ。
 *
 * **失敗しても投げない**。連携先が落ちている・URLが既に404・大きすぎる・
 * 画像でない、のいずれでもログインは成功させ、既存の avatar_url を残す
 * （新規ユーザーなら連携先のURLがそのまま残る＝これまでと同じ見え方）。
 *
 * 中身が前回と同じなら R2 も D1 も書かない。毎ログインで ?v= が変わると
 * 同じ画像を毎回ダウンロードさせることになるため。
 *
 * 連携先でアイコンを**削除**した場合は、取得が失敗するので自前保管したものが
 * 残り続ける（意図的。「連携先を消したらこちらも消える」より、表示が欠けない
 * ほうを優先している。こちらで消したいときはプロフィール編集から行う）。
 *
 * @param sourceUrl 連携先のアイコンURL（null/空なら何もしない）
 * @param opts.minIntervalMs 直近この時間内に取り込み済みならスキップする (#313)
 * @returns 保管して差し替えたら true */
export async function syncAvatarFromSource(
  userId: string,
  sourceUrl: string | null | undefined,
  opts: { minIntervalMs?: number } = {},
): Promise<boolean> {
  if (!sourceUrl) return false;
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return skip(userId, "bad-url");
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    // 現在の状態は最初に1回だけ引く（スロットル判定・ハッシュ比較・取得元URLの
    // 比較で共用）
    const state = await usersRepo.findAvatarSyncState(userId);
    const minInterval = opts.minIntervalMs ?? 0;
    if (minInterval > 0) {
      const now = Date.now();
      // 基準は「試みた時刻」であって「更新した時刻」ではない。後者は中身が
      // 変わったときだけ進むため、毎回同じバイト列を返すURLを指定されると
      // 永久に発火せず、外向きの取得（1MB × 無制限）を抑止できない
      if (state?.attemptedAt && now - state.attemptedAt < minInterval) {
        return skip(userId, "throttled");
      }
      // 取得の前に記録する。成否に関わらずここで刻んでおかないと、
      // 失敗し続けるURLを指定して連打されたときに抑止できない
      await usersRepo.touchAvatarSyncAttempt(userId, now);
    }
    const current =
      state && state.updatedAt !== null
        ? { updatedAt: state.updatedAt, mime: state.mime, hash: state.hash }
        : null;

    const res = await fetchAvatar(userId, url, ctrl.signal);
    if (!res) return false;
    if (!res.ok || !res.body) {
      discard(res);
      return skip(userId, "status", ` status=${res.status} host=${hostOf(url)}`);
    }

    // 連携先が返す MIME をそのまま信用せず、アップロードと同じ許可リストに通す
    // （SVG は script を持てるため配信対象にしない）
    const ct = res.headers.get("content-type") ?? undefined;
    const mime = normalizeImageMime(ct);
    if (!mime) {
      discard(res);
      return skip(userId, "mime", ` ct=${logSafe(ct)}`);
    }

    // Content-Length は見ない（詐称されうるし、読みながら打ち切るので上限は守れる）
    const bytes = await readCapped(res.body, AVATAR_IMAGE.maxBytes);
    if (!bytes) return skip(userId, "too-large", ` host=${hostOf(url)}`);
    if (bytes.byteLength === 0) return skip(userId, "empty", ` host=${hostOf(url)}`);
    // ヘッダだけでなく中身も画像であること
    if (!matchesSignature(mime, bytes)) {
      return skip(userId, "signature", ` mime=${mime} host=${hostOf(url)}`);
    }

    const hash = toHex(await crypto.subtle.digest("SHA-256", bytes));
    if (current && current.hash === hash && current.mime === mime) {
      // 中身が同じでもURLだけ変わることがある（連携先CDNのURLローテーション）。
      // ?v= は進めない（同じ画像を再ダウンロードさせない）が、切り戻し用に
      // 控えているURLが既に404のものになっていると復元できないので追随させる
      if (state?.sourceUrl !== url.toString()) {
        await usersRepo.setAvatarSourceUrl(userId, url.toString());
      }
      return false;
    }

    const updatedAt = Date.now();
    await getBucket().put(avatarKey(userId), bytes, {
      httpMetadata: { contentType: mime },
    });
    // R2 に入れてから D1 を更新する。逆にすると、間で失敗したときに
    // 「URL は自ドメインを指すのに実体が無い」＝アイコンが消えた状態になる
    await usersRepo.setAvatarImage(
      userId,
      avatarUrlFor(userId, updatedAt),
      updatedAt,
      mime,
      hash,
      // 取得元URLも残す。avatar_url は自ドメインのURLで上書きしてしまうため、
      // ここに控えておかないと元の連携先URLがどこにも残らない (#313)
      url.toString(),
    );
    return true;
  } catch (e) {
    console.warn(`[avatar] sync failed for user=${userId}`, e);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** アイコンの取り込み (#312) をレスポンスの外へ逃がす (#313)。
 * 同期で待つと、連携先CDNが遅いときに全ユーザーのログインが取得タイムアウト
 * ぶん（最大5秒）待たされる。取り込みは「次の表示までに終わっていればよい」
 * 性質のものなので waitUntil に載せる。失敗はログだけ残してログインは通す。
 *
 * **ログイン方法を増やすたびに書き写さないこと。** 元は routes/auth.ts の
 * 私有関数だったが、Bluesky (#381) が2つ目の呼び手になったのでここへ移した
 * （取り込みの契約を1か所に保つ）。 */
export async function syncAvatarInBackground(
  userId: string,
  sourceUrl: string | null | undefined,
  opts: { minIntervalMs?: number } = {},
): Promise<void> {
  try {
    await deferBackground(syncAvatarFromSource(userId, sourceUrl, opts));
  } catch (e) {
    // waitUntil を受け付けない ExecutionContext だった場合など
    console.warn("[avatar] バックグラウンド実行に失敗", e);
  }
}
