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
import { discardState } from "./stateStore.js";

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

/**
 * ハンドルの解決に許す時間。**未認証で叩ける入口**（設計 13.4）なので、
 * 遅い相手に張り付かせない。実測の happy path は 2.1〜2.4 秒（設計 4.2 の S5）。
 *
 * ライブラリはこの signal を**識別子の解決**（ハンドル → DID → PDS →
 * 認可サーバーの metadata）にだけ渡す。PAR は解決済みの認可サーバー相手なので
 * 対象外だが、**攻撃者が指定したホストへ出ていくのは解決の段だけ**なので、
 * 抑えたい経路はこれで覆える。
 */
export const BLUESKY_RESOLVE_TIMEOUT_MS = 10_000;

/** 認可開始。返した URL へ 302 する（PAR 済みなので state は URL に出ない） */
export async function startLogin(handle: string, appState: string): Promise<URL> {
  // 認可開始が途中で失敗したときに消すため、書かれた state を覚えておく。
  // state 行は PAR の**前**に書かれるので、PAR で落ちると秘密鍵入りの行が
  // TTL(10分)＋掃除の猶予まで残ってしまう
  const written: string[] = [];
  const client = createBlueskyClient({
    onStateWritten: (state) => written.push(state),
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), BLUESKY_RESOLVE_TIMEOUT_MS);
  try {
    return await client.authorize(handle, {
      state: appState,
      signal: ctrl.signal,
    });
  } catch (e) {
    for (const state of written) {
      // 消せなくてもログインの失敗は失敗。掃除が後で拾う
      await discardState(state).catch((err) =>
        console.warn("[bluesky] 失敗した認可開始の state を消せなかった", err),
      );
    }
    throw normalizeStartError(e);
  } finally {
    clearTimeout(timer);
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

/**
 * 接続そのものの失敗か。**例外の `cause` を辿る**。
 *
 * `OAuthClient.callback()` は途中の例外をすべて `OAuthCallbackError` に包み直し、
 * 元の例外を `cause` に入れる（0.8.2 の `oauth-callback-error.js` の
 * `OAuthCallbackError.from`）。包んだ外側だけを見ていると、**接続障害でも
 * 「ログインできませんでした」になり**、設計12が意図した「Bluesky に接続
 * できませんでした」が出ない。
 */
function isConnectionFailure(e: unknown, depth = 0): boolean {
  if (!e || depth > 5) return false;
  // fetch は接続不能・DNS 失敗を TypeError で投げる
  if (e instanceof TypeError) return true;
  // 中断（我々のタイムアウト・上流の signal）。DOMException は環境により
  // Error を継承しないので名前で見る
  const name = (e as { name?: unknown }).name;
  if (name === "AbortError" || name === "TimeoutError") return true;
  return isConnectionFailure((e as { cause?: unknown }).cause, depth + 1);
}

/**
 * ライブラリの例外を、画面に出せるコードへ寄せる（原因はログに残す）。
 *
 * **上流の例外メッセージの文字列に依存している**（`Failed to resolve identity`、
 * `Unknown authorization session`、`Missing "state"`）。ライブラリは
 * これらをコードで区別できる形にしていないため、いまはこうするしかない。
 * **依存の版が変わったら、該当の文言を上流の dist で grep して確かめ直すこと**
 * （fetch.ts の先頭にある注意書きと同じ扱い。pnpm の minimumReleaseAge で
 * 版は勝手には上がらないので、上げたときだけ見ればよい）。
 * 取りこぼしても既定の「ログインできませんでした」に落ちるだけで、
 * **穴にはならない**（`invalid_state` は 400 のまま扱われる方が安全側）。
 */
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
  // 接続不能・タイムアウト。PAR の段で落ちるとここに来る（包まれていない）
  if (isConnectionFailure(e)) {
    return new BlueskyLoginError("unavailable", String(e), { cause: e });
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
  }
  // 包まれた中身まで見る。ここを外側だけで判定すると、コールバック中の
  // 接続障害が全部「ログインできませんでした」になる
  if (isConnectionFailure(e)) {
    return new BlueskyLoginError("unavailable", String(e), { cause: e });
  }
  return new BlueskyLoginError("failed", String(e), { cause: e });
}
