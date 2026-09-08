import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

const BASE = "https://example.com";

/**
 * ホーム画面に追加してアプリのように使う (#490)。
 *
 * manifest は静的アセットなので、見るのは「**ワーカーのルートに食われずに
 * ASSETS まで届くこと**」。`run_worker_first = true` で配信しているため、
 * 将来 `app.get("/:slug")` のような広いルートが増えると、ここが黙って
 * index.html（SPA）を返すようになり、ホーム画面追加が壊れる。
 * 壊れ方が「アイコンが変わらない」程度で気づきにくいので、ここで固定する。
 */
describe("web app manifest (#490)", () => {
  it("/manifest.webmanifest が JSON として返る（SPA の index.html に食われない）", async () => {
    const res = await SELF.fetch(`${BASE}/manifest.webmanifest`);
    expect(res.status).toBe(200);
    const body = await res.text();
    // index.html が返っていたらここで落ちる
    expect(body).not.toContain("<!doctype html>");
    const manifest = JSON.parse(body) as Record<string, unknown>;
    expect(manifest.name).toBe("events lab");
    expect(manifest.start_url).toBe("/");
  });

  it("ホーム画面から単独ウィンドウで開く指定になっている", async () => {
    const res = await SELF.fetch(`${BASE}/manifest.webmanifest`);
    const manifest = (await res.json()) as { display: string; scope: string };
    // browser / minimal-ui だとブラウザのタブとして開き、アプリらしくならない
    expect(manifest.display).toBe("standalone");
    // scope を絞るとアプリ内リンクが外部ブラウザに逃げる
    expect(manifest.scope).toBe("/");
  });
});
