import { z } from "zod";

/**
 * 発表のページめくり（docs/contest-organizer-ux.md「発表のページめくり」）。
 *
 * 運営が発表スライドを選び、ページめくりを発表中のエントリー（個人・チームのメンバー全員）へ渡す。
 * めくった人のブラウザがページ番号を Nostr のエフェメラルイベントで送り、見ている画面がそれに合わせる。
 * サーバーは世代ごとの署名鍵を作り、めくれる人にだけ秘密鍵を返す。見ている側は公開鍵で確かめる。
 */

/** ページ番号を送る Nostr のエフェメラルイベントの kind。合図（20078）・同時編集（21078）とは別 */
export const PRESENT_PAGE_KIND = 21080;

/** 発表画面で出すスライドの見つけ方。資料URLが events lab のスライド閲覧（`/d/:slug`）を指していれば
 * その slug、それ以外（外部サイト・空）は null。web の表示とサーバーの検証で同じ規則を使う。
 * 外部URLは取りに行かない（埋め込みも取得もしない） */
const OWN_HOSTS = new Set(["events.kojira.io", "eventer-staging.kojiran.workers.dev"]);
const SLUG = /^[A-Za-z0-9_-]{1,64}$/;

export function deckSlugFromUrl(url: string | null | undefined, origin: string): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim(), origin);
  } catch {
    return null;
  }
  const own = parsed.origin === new URL(origin).origin
    || (parsed.protocol === "https:" && OWN_HOSTS.has(parsed.hostname) && !parsed.port);
  if (!own) return null;
  const m = /^\/d\/([^/]+)\/?$/.exec(parsed.pathname);
  return m && SLUG.test(m[1]) ? m[1] : null;
}

export type PresentControlMode = "staff" | "presenter";

/** `GET /:id/state` に付く、ページめくりの設定。閲覧できる人なら誰でも受け取る。
 * `secret` は、その世代でめくれる人（運営に戻っているなら運営、渡しているなら発表中のエントリーの
 * メンバー）にだけ付く。サービス鍵が無い環境では null（手元だけでめくる今の動作） */
export interface PresentControlConfig {
  kind: typeof PRESENT_PAGE_KIND;
  relays: string[];
  /** 不透明な hex。世代ごとに変わる。絞り込みの目印で、権限ではない */
  topic: string;
  version: number;
  /** この世代の署名鍵の公開鍵。これ以外の署名は受け付けない */
  pubkey: string;
  control: PresentControlMode;
  /** 運営が選んだスライド。null なら成果物の資料URLから引く */
  deckSlug: string | null;
  /** めくれる人にだけ付く秘密鍵 hex */
  secret?: string;
}

/** 送り合う中身（平文。スライドは URL を知る人が見られるもので、ページ番号も秘密ではない） */
export interface PresentPagePayload {
  slug: string;
  /** 0 始まりのページ番号 */
  page: number;
  /** 送った時刻（ミリ秒）。秒単位の created_at では並ばない連打の順番に使う */
  at: number;
}

/** 運営の操作。`deckUrl` は `/d/:slug`（同じサイトの絶対URLも可）か null（成果物から引く） */
export const setPresentControlInput = z.object({
  control: z.enum(["staff", "presenter"]).optional(),
  deckUrl: z.string().max(500).nullable().optional(),
});
export type SetPresentControlInput = z.infer<typeof setPresentControlInput>;


/** 秘密鍵を除いたページめくりの設定。見るだけの画面（配信画面など）に渡す */
export type PresentPageViewConfig = Omit<PresentControlConfig, "secret">;

/** 配信がコンテストの発表に連動しているときに配信状態へ付く情報（docs/contest-organizer-ux.md「配信との連動」）。
 * スライドは運営が選んだもの、なければ発表中のエントリーの資料URLの /d/:slug。
 * `present` は秘密鍵を含まない（配信画面は見るだけ） */
export interface LiveContestDeck {
  entryId: string | null;
  entryName: string | null;
  deckId: string | null;
  slug: string | null;
  present: PresentPageViewConfig | null;
}
