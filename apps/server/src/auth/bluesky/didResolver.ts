import {
  type Did,
  type DidDocument,
  didDocumentValidator,
  didWebToUrl,
  isDidPlc,
  isDidWeb,
} from "@atproto/did";
import type {
  AtprotoIdentityDidMethods,
  DidResolver,
  ResolveDidOptions,
} from "@atproto-labs/did-resolver";

/**
 * `redirect: 'error'` の回避策 その2（設計 8.2）。**上流バグの回避策である。**
 *
 * `@atproto-labs/did-resolver` の `methods/plc.js` と `methods/web.js` は
 * `bindFetch()` を使う。`bindFetch()` は**注入した fetch を呼ぶ前に**
 * `new Request(url, { redirect: 'error' })` を組むため、workerd では
 * fetch ラッパ (fetch.ts) が呼ばれる前に TypeError で落ちる。
 * DID 解決は必須の経路（失敗すると即ログイン不能）なので、
 * `OAuthClient` の `didResolver` オプションにこの実装を渡して**経路ごと外す**。
 *
 * グローバル (`globalThis.Request`) は書き換えない。アイソレート全体に影響し、
 * Bluesky と無関係な既存ルートまで巻き込むため（設計 4.2 の案B、却下）。
 *
 * **ライブラリ側の検証は落とさない。** `didDocumentValidator` で DID ドキュメントを
 * 検証し、`doc.id` が要求した DID と一致することを確かめる。ここを緩めると
 * 別人の DID を受け入れる穴になる。
 *
 * **消せる条件**は fetch.ts の先頭に書いたものと同じ。両方まとめて消す。
 */

/** did:plc の解決先。仕様どおりの既定値（テストでだけ差し替える） */
export const PLC_DIRECTORY_URL = "https://plc.directory/";

const DID_DOCUMENT_MIME = /^application\/(did\+ld\+)?json$/;

/** DID ドキュメントの取得先 URL。ライブラリの組み立てと同じ規則にする */
export function didDocumentUrl(
  did: string,
  plcDirectoryUrl: string = PLC_DIRECTORY_URL,
): URL {
  if (isDidPlc(did)) {
    return new URL(`/${encodeURIComponent(did)}`, plcDirectoryUrl);
  }
  if (isDidWeb(did)) {
    const url = didWebToUrl(did);
    // DID は `:` で終われない＝パスが `/` で終わることは無い。
    // パスが無いときだけ URL コンストラクタが pathname を "/" にする
    return url.pathname === "/"
      ? new URL("/.well-known/did.json", url)
      : new URL(`${url.pathname}/did.json`, url);
  }
  // atproto が認めるのは did:plc と did:web だけ
  throw new Error(`Unsupported DID method: ${did}`);
}

export interface BlueskyDidResolverOptions {
  fetch?: typeof globalThis.fetch;
  plcDirectoryUrl?: string;
}

export function createBlueskyDidResolver(
  options: BlueskyDidResolverOptions = {},
): DidResolver<AtprotoIdentityDidMethods> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const plcDirectoryUrl = options.plcDirectoryUrl ?? PLC_DIRECTORY_URL;

  async function resolve(
    did: Did,
    resolveOptions?: ResolveDidOptions,
  ): Promise<DidDocument> {
    const url = didDocumentUrl(did, plcDirectoryUrl);
    // 'manual' なのは workerd が 'error' を受け付けないから。
    // 追従はしない（3xx は下で例外にする）＝元の意図はそのまま
    const res = await doFetch(url, {
      redirect: "manual",
      headers: { accept: "application/did+ld+json,application/json" },
      signal: resolveOptions?.signal,
    });
    if (res.status >= 300 && res.status < 400) {
      throw new Error(`Unexpected redirect (${res.status}) resolving ${did}`);
    }
    if (!res.ok) {
      throw new Error(`Failed to resolve ${did}: HTTP ${res.status}`);
    }
    const mime = res.headers.get("content-type")?.split(";")[0].trim();
    if (!mime || !DID_DOCUMENT_MIME.test(mime)) {
      throw new Error(`Invalid DID document content type: ${mime}`);
    }
    const doc = didDocumentValidator.parse(await res.json());
    // 取りに行った DID と、返ってきた文書の主語が一致すること。
    // ここを見ないと、リダイレクトや取り違えで別人の DID を受け入れうる
    if (doc.id !== did) {
      throw new Error(`DID document id mismatch: requested ${did}, got ${doc.id}`);
    }
    return doc;
  }

  // ライブラリの型は `resolve<D extends Did>(did: D) => Promise<ResolvedDocument<D, M>>`
  // という条件型で、実装側で表現しきれない。契約（doc.id === did）は上で満たしている
  return { resolve } as unknown as DidResolver<AtprotoIdentityDidMethods>;
}
