import { WebcryptoKey } from "@atproto/jwk-webcrypto";
import {
  OAuthClient,
  type DpopNonceCache,
  type OAuthClientMetadataInput,
  type RuntimeImplementation,
  type SessionStore,
} from "@atproto/oauth-client";
import { AtprotoDohHandleResolver } from "@atproto-labs/handle-resolver";
import { env } from "../../runtime.js";
import { createBlueskyDidResolver } from "./didResolver.js";
import { blueskyFetch } from "./fetch.js";
import { createStateStore } from "./stateStore.js";

/**
 * Bluesky ログイン (#381) の `OAuthClient` 組み立て。
 * **環境ごとの `client_id` / `redirect_uri` の分岐はこのファイルだけ。**
 *
 * public client（`token_endpoint_auth_method: 'none'`）なので鍵もシークレットも無い。
 * トークンは保存しないため sessionStore は呼び出しごとの使い捨て（下記）。
 */

/** 認可開始・コールバックのパス（client_id と redirect_uri の組み立てに使う） */
const CLIENT_METADATA_PATH = "/api/auth/bluesky/client-metadata.json";
const CALLBACK_PATH = "/api/auth/bluesky/callback";

/** ハンドル解決の DoH エンドポイント。単一ベンダーの XRPC に寄せない（設計 2.4） */
const DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";

/**
 * DPoP nonce のキャッシュ。**モジュールスコープに置く**（設計 4.2 の S5）。
 *
 * 認可サーバーは PAR の1回目に必ず 400 `use_dpop_nonce` を返し、nonce を貼り直した
 * 2回目で 201 になる。このキャッシュを `OAuthClient` と同じ寿命にすると、
 * リクエストのたびに余計な1往復（実測で認可開始が 2.1〜2.4 秒）が入る。
 * origin ごとに1つしか持たず、古くなればライブラリが応答の `DPoP-Nonce` で
 * 貼り直すので、TTL を持たなくても壊れない。
 * ただし Workers のアイソレートは短命なので、**「毎回1往復増える」前提で見積もる**。
 */
const dpopNonces = new Map<string, string>();
/** 相手の origin ぶんしか増えないが、際限なく持つ理由も無いので上限を置く */
const DPOP_NONCE_MAX = 50;

const dpopNonceCache: DpopNonceCache = {
  get: (origin) => dpopNonces.get(origin),
  set: (origin, nonce) => {
    if (dpopNonces.size >= DPOP_NONCE_MAX && !dpopNonces.has(origin)) {
      dpopNonces.clear();
    }
    dpopNonces.set(origin, nonce);
  },
  del: (origin) => {
    dpopNonces.delete(origin);
  },
};

/** WebCrypto だけで足りる（Node 依存を持ち込まない） */
const runtimeImplementation: RuntimeImplementation = {
  // extractable: true を渡さないと privateJwk が取れず、state に鍵を保存できない
  // （スパイク S4）。認可開始とコールバックは別リクエストなので必須
  createKey: (algs) =>
    WebcryptoKey.generate(algs, undefined, { extractable: true }),
  getRandomValues: (length) => crypto.getRandomValues(new Uint8Array(length)),
  digest: async (data, alg) => {
    const name = { sha256: "SHA-256", sha384: "SHA-384", sha512: "SHA-512" }[
      alg.name
    ];
    return new Uint8Array(await crypto.subtle.digest(name, data));
  },
};

/** 末尾の `/` を落とした APP_BASE_URL */
function baseUrl(appBaseUrl: string): string {
  return appBaseUrl.replace(/\/+$/, "");
}

/**
 * client metadata を組み立てる（純関数。テストしやすいようにここだけ切り出す）。
 *
 * https の base では通常の discoverable client（`client_id` は自分自身の URL）。
 * http の base は **localhost 例外**（設計 9）:
 * - `client_id` は `http://localhost?redirect_uri=...&scope=atproto`（**ポート無し・パス空**）
 * - `redirect_uri` は **`127.0.0.1`**（ループバックは `localhost` ではなく IP を使う: RFC 8252）
 */
export function buildClientMetadata(
  appBaseUrl: string,
): OAuthClientMetadataInput {
  const base = baseUrl(appBaseUrl);
  const url = new URL(base);
  const loopback = url.protocol === "http:";
  const redirectUri = loopback
    ? `http://127.0.0.1${url.port ? `:${url.port}` : ""}${CALLBACK_PATH}`
    : `${base}${CALLBACK_PATH}`;
  const clientId = loopback
    ? `http://localhost?redirect_uri=${encodeURIComponent(redirectUri)}&scope=atproto`
    : `${base}${CLIENT_METADATA_PATH}`;
  return {
    client_id: clientId,
    client_name: "events lab",
    client_uri: base,
    redirect_uris: [redirectUri],
    scope: "atproto",
    // refresh_token は宣言しない。トークンを保存しない設計を metadata でも表明する
    grant_types: ["authorization_code"],
    response_types: ["code"],
    application_type: "web",
    dpop_bound_access_tokens: true,
    token_endpoint_auth_method: "none",
  };
}

/** いまの環境の client metadata（`GET /client-metadata.json` が返すもの） */
export function clientMetadata(): OAuthClientMetadataInput {
  return buildClientMetadata(env.appBaseUrl);
}

/** トークンを保存しない (#381) ので、セッションの置き場は呼び出しごとの使い捨て。
 * ライブラリは交換直後に一度書いてから読むだけで、我々はその後すぐ捨てる */
function createThrowawaySessionStore(): SessionStore {
  const map = new Map<string, Parameters<SessionStore["set"]>[1]>();
  return {
    get: (sub) => map.get(sub),
    set: (sub, session) => {
      map.set(sub, session);
    },
    del: (sub) => {
      map.delete(sub);
    },
  };
}

/**
 * `OAuthClient` を1回のログイン試行ぶん組み立てる。
 *
 * クライアント自体は呼び出しごとに作る（sessionStore を跨いで持ち回さないため）が、
 * 余計な PAR 往復の原因になる `dpopNonceCache` はモジュールスコープなので、
 * 同じアイソレート内なら nonce は使い回される。
 */
export function createBlueskyClient(
  options: {
    /** state 行を書いた直後に呼ぶ。認可開始が失敗したときに消すために使う */
    onStateWritten?: (state: string) => void;
  } = {},
): OAuthClient {
  return new OAuthClient({
    clientMetadata: clientMetadata(),
    responseMode: "query",
    runtimeImplementation,
    stateStore: createStateStore(Date.now, options.onStateWritten),
    sessionStore: createThrowawaySessionStore(),
    dpopNonceCache,
    // 回避策2枚（設計 8）。fetch ラッパはハンドルの .well-known 解決に効き、
    // DID 解決は bindFetch を通らない自前実装に差し替える
    fetch: blueskyFetch,
    didResolver: createBlueskyDidResolver(),
    handleResolver: new AtprotoDohHandleResolver({
      dohEndpoint: DOH_ENDPOINT,
      fetch: blueskyFetch,
    }),
  });
}
