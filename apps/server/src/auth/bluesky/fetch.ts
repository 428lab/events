/**
 * `redirect: 'error'` の回避策 その1（設計 8.1）。**上流バグの回避策である。**
 *
 * `@atproto/oauth-client` とその依存は、リダイレクトを拒否するために
 * `redirect: 'error'` を使う。workerd はこの値を **`new Request()` の構築時点で**
 * 拒否して TypeError を投げる:
 *
 *   TypeError: Invalid redirect value, must be one of "follow" or "manual"
 *   ("error" won't be implemented since it does not make sense at the edge;
 *    use "manual" and check the response status code).
 *
 * このラッパが効くのは、注入した fetch が `(url, init)` の形で**直接**呼ばれる
 * 経路だけ（`@atproto-labs/handle-resolver` の well-known 解決）。
 * `bindFetch()` を通る経路（DID 解決）は、注入した fetch を呼ぶ前に Request を
 * 組んでしまうのでここでは直せない。そちらは didResolver.ts で経路ごと外している。
 *
 * **消せる条件**: workerd が `redirect: 'error'` を受け付けるようになったら、
 * このファイルと didResolver.ts の両方を消して、素の `fetch` と
 * ライブラリ既定の DID 解決に戻す。判定は `wrangler dev` で
 * `new Request("https://example.com", { redirect: "error" })` が投げないことを
 * 確かめるだけでよい。
 *
 * 依存の版が変わったら `redirect: 'error'` の該当箇所を grep し直すこと
 * （pnpm の minimumReleaseAge で入る版が動く）。
 */

/** 3xx を「拒否」に読み替えたことを呼び出し側に伝える例外 */
export class RedirectNotAllowedError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
  ) {
    super(`Unexpected redirect (${status}) for ${url}`);
    this.name = "RedirectNotAllowedError";
  }
}

/**
 * `redirect: 'error'` を `'manual'` に読み替えてから fetch し、
 * **3xx が返ったら自分で例外にする**。ここを省くと「リダイレクトを拒否する」
 * という元の安全性が黙って失われる（黙って追従はしない）。
 * `'follow'` や未指定はそのまま素の fetch に渡す。
 */
export async function blueskyFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  if (init?.redirect !== "error") {
    return globalThis.fetch(input as RequestInfo, init);
  }
  const res = await globalThis.fetch(input as RequestInfo, {
    ...init,
    redirect: "manual",
  });
  if (res.status >= 300 && res.status < 400) {
    // 本文を読み捨てておく（Node 系ランタイムでは放置すると警告が出る）
    void res.body?.cancel?.().catch(() => {});
    const url = input instanceof Request ? input.url : String(input);
    throw new RedirectNotAllowedError(url, res.status);
  }
  return res;
}
