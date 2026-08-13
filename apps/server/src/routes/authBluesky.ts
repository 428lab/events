import { Hono } from "hono";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "../types.js";
import { env } from "../env.js";
import { usersRepo } from "../db/repositories/users.js";
import { deriveHandle } from "../lib/handle.js";
import { finishIdentityLogin } from "../auth/accountLink.js";
import { currentUser } from "../auth/session.js";
import type { BlueskyFlowErrorCode } from "../auth/bluesky/index.js";

/**
 * Bluesky ログイン・連携 (#381) のルート。**配線だけ**を持つ。
 * フローの知識は auth/bluesky/ に、引き取りの判断は auth/accountLink.ts にある。
 *
 * `/api/auth/` 配下に置くのは、staging ゲートがこの接頭辞を無条件で通すため。
 * 認可サーバーは未認証で client-metadata.json を取りに来るので、ここを外すと
 * staging でだけ動かなくなる（設計 6.1）。
 *
 * **`auth/bluesky/index.js` は動的 import で読む。** `@atproto/oauth-client` は
 * core-js を含む大きな依存を引くため、静的に繋ぐと Bluesky を使わない
 * リクエストでも評価されて起動 CPU を食う。型だけの import は消えるので静的でよい。
 */

/** 認可開始とコールバックを同じブラウザで結ぶための札 (設計 7.3)。
 * ライブラリの state は PAR のせいで認可 URL に出ないので、これが代わりになる */
const TAG_COOKIE = "eventer_bluesky_tag";

/** 認可開始時に渡し、コールバックで返ってくる付随情報 */
interface AppState {
  tag: string;
  next?: string;
}

/** Bluesky の実装一式（重い依存はこの先にしか無い） */
function bluesky() {
  return import("../auth/bluesky/index.js");
}

export const blueskyAuthRoutes = new Hono<AppEnv>();

/** 自分の client metadata。**認可サーバーが未認証で取りに来る** */
blueskyAuthRoutes.get("/client-metadata.json", async (c) => {
  const { clientMetadata } = await bluesky();
  return c.body(JSON.stringify(clientMetadata()), 200, {
    // 3xx や 200 以外は不可。content-type も application/json でなければならない
    "content-type": "application/json",
    // キャッシュされてよい（public client なので鍵を載せていない）
    "cache-control": "public, max-age=300",
  });
});

/** 認可開始。素のフォーム GET で来る（トップレベル遷移でないと認可画面へ飛べない） */
blueskyAuthRoutes.get("/login", async (c) => {
  const { normalizeBlueskyHandle, startLogin, blueskyErrorCode } =
    await bluesky();
  const handle = normalizeBlueskyHandle(c.req.query("handle"));
  // 形が不正なものは**外部へ出る前に**弾く
  if (!handle) return c.json({ error: "invalid_handle" }, 400);

  const tag = crypto.randomUUID();
  const appState: AppState = { tag, next: safeNext(c.req.query("next")) };
  let url: URL;
  try {
    url = await startLogin(handle, JSON.stringify(appState));
  } catch (e) {
    return await errorRedirect(c, blueskyErrorCode(e));
  }
  setCookie(c, TAG_COOKIE, tag, {
    httpOnly: true,
    sameSite: "Lax",
    secure: env.isProd,
    path: "/",
    maxAge: 600,
  });
  return c.redirect(url.toString());
});

/** 認可サーバーからの戻り。ログイン or 連携（分岐は「セッションがあるか」だけ） */
blueskyAuthRoutes.get("/callback", async (c) => {
  const params = new URL(c.req.url).searchParams;
  const state = params.get("state");
  if (!state) return c.json({ error: "invalid_oauth_state" }, 400);

  const { peekState, discardState, finishLogin, blueskyErrorCode } =
    await bluesky();

  // 交換の前にブラウザとの紐付けを確かめる。後回しにすると、CSRF や期限切れの
  // ために外部と1往復してしまう
  const pending = await peekState(state);
  if (!pending) {
    // 我々が発行していない state か、既に使われた state（リプレイ）
    return c.json({ error: "invalid_oauth_state" }, 400);
  }
  const tag = getCookie(c, TAG_COOKIE);
  deleteCookie(c, TAG_COOKIE, { path: "/" });
  if (pending.expired) {
    await discardState(state);
    return await errorRedirect(c, "expired");
  }
  const appState = parseAppState(pending.appState);
  if (!tag || appState?.tag !== tag) {
    await discardState(state);
    return c.json({ error: "invalid_oauth_state" }, 400);
  }

  // 連携中かどうかは finishIdentityLogin も見るが、失敗時の戻り先の判断に要る
  const before = await currentUser(c);
  let login;
  try {
    login = await finishLogin(params);
  } catch (e) {
    return await errorRedirect(c, blueskyErrorCode(e));
  }

  // 識別子は DID。ハンドルは表示と初期値の材料にしか使わない（ハンドルは変わる）
  const shortHandle =
    login.profile.handle?.replace(/\.bsky\.social$/, "") ?? null;
  const result = await finishIdentityLogin(c, {
    provider: "bluesky",
    providerUserId: login.did,
    profile: {
      username: deriveHandle(
        shortHandle ?? `bsky_${login.did.replace(/[^a-z0-9]/gi, "").slice(-8)}`,
        null,
      ),
      globalName: login.profile.displayName,
      avatarUrl: login.profile.avatarUrl,
      // この scope ではメールアドレスは取れない
      email: null,
    },
  });

  if (result.kind === "link_error") {
    return c.redirect(`${env.appBaseUrl}/account?link_error=${result.code}`);
  }
  if (result.kind === "linked") {
    // 表示名・アイコンは**空のときだけ**埋める。既に設定済みの表示を
    // 勝手に書き換えない（Nostr のプロフィール反映と同じ扱い）
    if (before) {
      await usersRepo.fillProfile(
        before.id,
        login.profile.displayName,
        login.profile.avatarUrl,
      );
    }
    return c.redirect(`${env.appBaseUrl}/account`);
  }
  // next は自分で書いた state 行から来るが、戻り先はもう一度確かめる
  // （オープンリダイレクタにしないための門は1つに保つ）
  return c.redirect(
    env.appBaseUrl +
      (result.pendingDeletion ? "/restore" : (safeNext(appState.next) ?? "/me")),
  );
});

/** 認可後の戻り先。オープンリダイレクタにしないため、自サイト内の絶対パスだけ通す */
function safeNext(next: string | undefined): string | undefined {
  if (!next) return undefined;
  if (!next.startsWith("/") || next.startsWith("//")) return undefined;
  return next;
}

function parseAppState(raw: string | null): AppState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AppState;
    return typeof parsed?.tag === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * フローの失敗を画面へ返す。**引き取りの失敗 (`link_error`) とは別のクエリにする**
 * ——`linkErrorMessage()` は未知のコードを `already_linked` の文言に倒すため、
 * 混ぜると誤った説明が出る（設計 12）。
 *
 * 断られた (`denied`) だけはエラー扱いにせず、画面に戻すだけにする。
 */
async function errorRedirect(c: Context, code: BlueskyFlowErrorCode) {
  // CSRF・リプレイ・壊れた戻りは画面に出さない
  if (code === "invalid_state") {
    return c.json({ error: "invalid_oauth_state" }, 400);
  }
  // 連携中なら設定画面へ、未ログインならログイン画面へ
  const base = (await currentUser(c)) ? "/account" : "/login";
  const query = code === "denied" ? "" : `?bluesky_error=${code}`;
  return c.redirect(`${env.appBaseUrl}${base}${query}`);
}
