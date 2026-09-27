import { createExecutionContext, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/worker.js";
import { convertDeckImport, parseDeckImport } from "@eventer/shared";
import sample from "../../web/public/deck-import/v2/sample-events-lab-intro.json";
import source from "../../web/public/deck-import/v2/sample-events-lab-intro.json?raw";

const path = "/deck-import/v2/sample-events-lab-intro.json";
const production = "https://events.kojira.io";
const staging = "https://eventer-staging.kojiran.workers.dev";
const names = ["journey", "publish", "calendar", "crew", "checkin", "stage", "awards", "stream"];
const raw = source;
const asset = (body = raw) => ({ fetch: async () => new Response(body, { headers: { "Content-Type": "application/json", ETag: "old", "Content-Length": `${body.length}` } }) });
async function request(url: string, environment: string, body = raw, cookie?: string) {
  return worker.fetch(new Request(url, { headers: cookie ? { cookie } : {} }), {
    ...env, ASSETS: asset(body), ENVIRONMENT: environment,
    APP_BASE_URL: environment === "staging" ? staging : production,
  } as typeof env, createExecutionContext());
}
async function session() {
  const id = crypto.randomUUID(), sid = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, NULL, NULL, ?)").bind(id, `s:${id}`, `s_${id.slice(0, 8)}`, Date.now()).run();
  await env.DB.prepare("INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)").bind(sid, id, Date.now() + 86400000).run();
  return `eventer_session=${sid}`;
}
const urls = (deck: typeof sample) => deck.slides.flatMap(s => s.elements.flatMap(el => "src" in el ? [el.src] : []));

describe("the exact bundled introduction sample", () => {
  it("parses and converts the actual ten-page source, preserving ten images and one editable empty frame", () => {
    const parsed = parseDeckImport(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const deck = convertDeckImport(parsed.value, (kind, si, ei) => `${kind}-${si}-${ei ?? 0}`);
    expect(deck.content.slides).toHaveLength(10);
    expect(deck.content.slides.flatMap(s => s.elements).filter(e => e.type === "image" && e.src)).toHaveLength(10);
    expect(deck.content.slides[9].elements.filter(e => e.type === "image" && !e.src)).toHaveLength(1);
  });
  it("rewrites only eight known image URLs after the staging gate; production retains source bytes semantically", async () => {
    const cookie = await session();
    expect((await request(production + path, "staging")).status).toBe(403);
    const stage = await request(staging + path + "?selected=1", "staging", raw, cookie);
    expect(stage.status).toBe(200);
    expect(stage.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(stage.headers.get("cache-control")).toBe("no-store");
    expect(stage.headers.get("etag")).toBeNull();
    expect(stage.headers.get("content-length")).toBeNull();
    const deck = await stage.json() as typeof sample;
    expect(deck.slides).toHaveLength(10);
    expect(urls(deck)).toEqual([`${production}/og-default.png`, ...names.map(n => `${staging}/deck-import/v2/intro-${n}.png`), `${production}/icon-512.png`]);
    expect(deck.slides.filter(s => s.elements.some(e => e.type === "image-placeholder"))).toHaveLength(1);
    const prod = await request(production + path, "production");
    expect(prod.status).toBe(200);
    expect(prod.headers.get("cache-control")).toBe("no-store");
    expect(await prod.json()).toEqual(sample);
  });
  it("fails closed on a changed bundled image rather than rewriting an unknown src", async () => {
    for (const broken of [raw.replace("intro-crew.png", "intro-crew.png?other=1"), raw.replace("その思いつきに、入口を。", "別の原稿")]) {
      const res = await request(production + path, "production", broken);
      expect(res.status).toBe(503);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });
  it("does not alter unrelated paths, methods, or user-supplied JSON", async () => {
    const cookie = await session();
    for (const url of [staging + path + "/", staging + "/deck-import/v1/sample-title.json"]) {
      const res = await request(url, "staging", raw, cookie);
      expect(res.headers.get("cache-control")).not.toBe("no-store");
      expect(await res.text()).toBe(raw);
    }
    const other = await worker.fetch(new Request(staging + path, { method: "POST", headers: { cookie } }), {
      ...env, ASSETS: asset(), ENVIRONMENT: "staging", APP_BASE_URL: staging,
    } as typeof env, createExecutionContext());
    expect(other.headers.get("cache-control")).not.toBe("no-store");
  });
});
