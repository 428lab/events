import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * 保存される既定の文言は、作る人の言語で書く (#364)。オーナー決定（2026-08-13 の画像の決定を
 * 保存データ全体に当てはめた。2026-11-19）。日本語は以前の直書きと同じ綴り。
 */

const BASE = "https://example.com/api";
const sql = (q: string, ...v: unknown[]) => env.DB.prepare(q).bind(...v).run();

async function user(language: string | null = null) {
  const id = crypto.randomUUID(), sid = crypto.randomUUID();
  await sql("INSERT INTO user(id,discord_id,username,created_at,language) VALUES(?,?,?,?,?)", id, id, `u_${id.slice(0, 8)}`, Date.now(), language);
  await sql("INSERT INTO session(id,user_id,expires_at) VALUES(?,?,?)", sid, id, Date.now() + 86400000);
  return { id, cookie: `eventer_session=${sid}` };
}
type Actor = Awaited<ReturnType<typeof user>>;
const call = (path: string, actor: Actor, method = "GET", body?: unknown) =>
  SELF.fetch(BASE + path, {
    method,
    headers: { cookie: actor.cookie, "content-type": "application/json", origin: "https://example.com" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
type LiveSetBody = { name: string; content: { scenes: { name: string; elements: { text?: string }[] }[] } };
const texts = (s: LiveSetBody) => s.content.scenes.flatMap((scene) => [scene.name, ...scene.elements.map((e) => e.text ?? "")]).filter(Boolean);

describe("保存される既定の文言 (#364)", () => {
  it("配信セットの既定のシーンと名前は作る人の言語（?lang=）。日本語は以前の綴りのまま", async () => {
    const owner = await user();
    const en = (await (await call("/live-sets?lang=en", owner, "POST", {})).json()) as LiveSetBody;
    expect(en.name).toBe("Broadcast set");
    expect(texts(en)).toEqual(expect.arrayContaining(["Waiting to start", "Starting soon", "Please wait a moment", "Thank you for watching!"]));
    expect(texts(en).join(" ")).not.toMatch(/[぀-ヿ一-鿿]/);

    const ja = (await (await call("/live-sets?lang=ja", owner, "POST", {})).json()) as LiveSetBody;
    expect(ja.name).toBe("配信セット");
    expect(texts(ja)).toEqual(expect.arrayContaining(["開始前待機", "まもなく開始します", "しばらくお待ちください", "ご視聴ありがとうございました！"]));

    const glow = (await (await call("/live-sets?lang=en", owner, "POST", { templateId: "glow", name: "G" })).json()) as LiveSetBody;
    expect(texts(glow)).toEqual(expect.arrayContaining(["Opening", "Talk", "Thank you for watching"]));
  });

  it("?lang= が無ければ本人の user.language。ビルトインの既定セットも見ている人の言語", async () => {
    const en = await user("en");
    const created = (await (await call("/live-sets", en, "POST", {})).json()) as LiveSetBody;
    expect(created.content.scenes[0]!.name).toBe("Waiting to start");

    const eventRes = await call("/events?lang=en", en, "POST", {
      title: "Night", startsAt: Date.now() + 86400000, endsAt: Date.now() + 90000000, venueType: "online",
    });
    const { event } = (await eventRes.json()) as { event: { id: string } };
    const builtin = (await (await call(`/events/${event.id}/live-set-content`, en)).json()) as LiveSetBody;
    expect(builtin.name).toBe("Default");
    const builtinJa = (await (await call(`/events/${event.id}/live-set-content?lang=ja`, en)).json()) as LiveSetBody;
    expect(builtinJa.name).toBe("デフォルト");
  });

  it("イベントを作ると既定の採点項目、複製すると題名が作る人の言語", async () => {
    const host = await user();
    const res = await call("/events?lang=en", host, "POST", {
      title: "Hack Night", startsAt: Date.now() + 86400000, endsAt: Date.now() + 90000000, venueType: "online",
    });
    const { event } = (await res.json()) as { event: { id: string } };
    const criteria = (await env.DB.prepare("SELECT name FROM scoring_criterion WHERE event_id=? ORDER BY sort_order")
      .bind(event.id).all<{ name: string }>()).results.map((r) => r.name);
    expect(criteria).toEqual(["Technical skill", "Originality", "Completeness", "Presentation"]);

    const copy = (await (await call(`/events/${event.id}/duplicate?lang=en`, host, "POST")).json()) as { event: { title: string } };
    expect(copy.event.title).toBe("Copy of Hack Night");
    const copyJa = (await (await call(`/events/${event.id}/duplicate?lang=ja`, host, "POST")).json()) as { event: { title: string } };
    expect(copyJa.event.title).toBe("Hack Nightのコピー");
  });
});
