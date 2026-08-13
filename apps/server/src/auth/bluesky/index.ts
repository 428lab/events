import { OAuthCallbackError, OAuthResolverError } from "@atproto/oauth-client";
import { asNormalizedHandle } from "@atproto-labs/identity-resolver";
import { createBlueskyClient } from "./client.js";
import { fetchPublicProfile, type BlueskyPublicProfile } from "./profile.js";

/**
 * Bluesky ログイン (#381) の外向きの窓口。
 *
 * ルート (routes/authBluesky.ts) は配線だけを持ち、フローの知識はここに閉じる。
 * ライブラリの例外をそのまま外に出さないのも役割のひとつで、
 * **画面に出すのは正規化したコードだけ**（原因はサーバーのログに残す）。
 *
 * **このモジュールはルートから動的 import で読む。** `@atproto/oauth-client` は
 * core-js を含む大きな依存を引くので、静的に繋ぐと Bluesky を使わない
 * リクエストでも評価され、Worker の起動 CPU を無駄に使う。
 * そのため Bluesky の入口はこのファイル1つに揃えてある（境界を増やさない）。
 */

// ルートが必要とするものはここから出す（動的 import の窓口を1つに保つ）
export { clientMetadata } from "./client.js";
export { discardState, peekState } from "./stateStore.js";

/** 画面に出す（PR4）エラーコード。設計 12 の表と1対1 */
export type BlueskyErrorCode =
  | "handle_not_found"
  | "unavailable"
  | "denied"
  | "expired"
  | "failed";

/** `invalid_state` だけは画面に出さない。CSRF・リプレイ・壊れた戻りなので 400 で返す */
export type BlueskyFlowErrorCode = BlueskyErrorCode | "invalid_state";

export class BlueskyLoginError extends Error {
  constructor(
    readonly code: BlueskyFlowErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "BlueskyLoginError";
  }
}

/**
 * 入力されたハンドルを正規化する。**外部へ出る前に形を確かめるため**の関数で、
 * 不正なら null（＝ルートは 400）。
 *
 * 先頭の `@` を落とし、前後の空白を落とし、小文字化する。妥当性の判定は
 * ライブラリの `asNormalizedHandle`（＝実際に解決に使われる規則）に任せる。
 * ここで独自の正規表現を書くと、通す/通さないの契約が2か所になる。
 */
export function normalizeBlueskyHandle(
  input: string | null | undefined,
): string | null {
  if (!input) return null;
  const trimmed = input.trim().replace(/^@+/, "");
  if (!trimmed) return null;
  return asNormalizedHandle(trimmed) ?? null;
}

/** ログイン試行の結果。**識別子は DID。ハンドルは表示にしか使わない** */
export interface BlueskyLoginResult {
  did: string;
  profile: BlueskyPublicProfile;
  /** authorize() に渡した appState（tag と戻り先）。無ければ null */
  appState: string | null;
}

/** 認可開始。返した URL へ 302 する（PAR 済みなので state は URL に出ない） */
export async function startLogin(handle: string, appState: string): Promise<URL> {
  const client = createBlueskyClient();
  try {
    return await client.authorize(handle, { state: appState });
  } catch (e) {
    throw normalizeStartError(e);
  }
}

/** コールバック。トークンは受け取った直後に捨てる */
export async function finishLogin(
  params: URLSearchParams,
): Promise<BlueskyLoginResult> {
  const client = createBlueskyClient();
  let did: string;
  let appState: string | null;
  try {
    const { session, state } = await client.callback(params);
    did = session.did;
    appState = state;
    // 我々はトークンを保存しない。破棄は「やってみるだけ」で、
    // 認可サーバー側が失敗してもログインは成功として扱う
    // （手元には何も残っていない）
    try {
      await session.signOut();
    } catch (e) {
      console.warn("[bluesky] トークンの破棄に失敗（無視して続行）", e);
    }
  } catch (e) {
    throw normalizeCallbackError(e);
  }
  // 表示名・アイコンは認証不要の公開 API から。失敗しても null で続ける
  const profile = await fetchPublicProfile(did);
  return { did, profile, appState };
}

/** 例外からコードだけを取り出す。ルートが `BlueskyLoginError` を
 * 静的に知らずに済むようにするための窓口（動的 import の境界を薄く保つ） */
export function blueskyErrorCode(e: unknown): BlueskyFlowErrorCode {
  return e instanceof BlueskyLoginError ? e.code : "failed";
}

/** ライブラリの例外を、画面に出せるコードへ寄せる（原因はログに残す） */
function normalizeStartError(e: unknown): BlueskyLoginError {
  console.warn("[bluesky] 認可開始に失敗", e);
  if (e instanceof OAuthResolverError) {
    // ハンドル/DID が解決できない ＝ 入力の誤りか、そのアカウントが無い
    if (e.message.startsWith("Failed to resolve identity")) {
      return new BlueskyLoginError("handle_not_found", e.message, { cause: e });
    }
    // 解決はできたが接続先（PDS・認可サーバー）が応答しない
    return new BlueskyLoginError("unavailable", e.message, { cause: e });
  }
  if (e instanceof TypeError) {
    // fetch が投げる（接続不能・DNS 失敗など）
    return new BlueskyLoginError("unavailable", e.message, { cause: e });
  }
  return new BlueskyLoginError("failed", String(e), { cause: e });
}

function normalizeCallbackError(e: unknown): BlueskyLoginError {
  console.warn("[bluesky] コールバックの処理に失敗", e);
  if (e instanceof OAuthCallbackError) {
    // 利用者が認可画面で断った。エラー扱いにせず画面に戻す
    if (e.params.get("error") === "access_denied") {
      return new BlueskyLoginError("denied", e.message, { cause: e });
    }
    // state 行が無い＝リプレイか、我々が発行していない戻り。画面に出さず 400
    if (
      e.message.startsWith("Unknown authorization session") ||
      e.message.startsWith('Missing "state"')
    ) {
      return new BlueskyLoginError("invalid_state", e.message, { cause: e });
    }
    return new BlueskyLoginError("failed", e.message, { cause: e });
  }
  if (e instanceof TypeError) {
    return new BlueskyLoginError("unavailable", e.message, { cause: e });
  }
  return new BlueskyLoginError("failed", String(e), { cause: e });
}
