import { SELF, env } from "cloudflare:test";
import { expect, it, vi } from "vitest";
import { eventMembersRepo } from "../src/db/repositories/eventMembers.js";
import { bindEnv } from "../src/runtime.js";
const base = "https://example.com";
const day = 86400000;

it("two canceled-row reads cannot demote a concurrent successful rejoin", async () => {
  const s = await setup(),
    a = await user(),
    slot = crypto.randomUUID();
  bindEnv(env as never);
  await sql(
    "INSERT INTO participation_slot(id,event_id,name,capacity,created_at) VALUES(?,?,'一般',1,?)",
    slot,
    s.eventId,
    Date.now(),
  );
  await sql(
    "INSERT INTO event_member(id,event_id,user_id,role,status,created_at) VALUES(?,?,?,'participant','canceled',?)",
    crypto.randomUUID(),
    s.eventId,
    a.id,
    Date.now(),
  );
  const stale = await eventMembersRepo.findIncludingCanceled(s.eventId, a.id);
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reads = 0;
  const staleRead = async () => {
    if (++reads === 2) release();
    await barrier;
    return stale;
  };
  const spy = vi
    .spyOn(eventMembersRepo, "findIncludingCanceled")
    .mockImplementationOnce(staleRead)
    .mockImplementationOnce(staleRead);
  try {
    const rows = await Promise.all([
      eventMembersRepo.add(
        s.eventId,
        a.id,
        "participant",
        slot,
        "confirmed",
        true,
      ),
      eventMembersRepo.add(
        s.eventId,
        a.id,
        "participant",
        slot,
        "confirmed",
        true,
      ),
    ]);
    expect(rows.map((r) => r.status)).toEqual(["confirmed", "confirmed"]);
    expect((await members(s.eventId))[0].status).toBe("confirmed");
  } finally {
    spy.mockRestore();
  }
});

it("promotes existing waiters before the response-ordered automatic cohort", async () => {
  const s = await setup(),
    old = await user(),
    slot = crypto.randomUUID();
  // Deliberately reverse PK order: an unordered receipt scan must not
  // accidentally satisfy the expected response order.
  const [late, second, first] = [await user(), await user(), await user()].sort((a,b) => a.id.localeCompare(b.id));
  bindEnv(env as never);
  await sql(
    "INSERT INTO participation_slot(id,event_id,name,capacity,created_at) VALUES(?,?,'一般',1,?)",
    slot,
    s.eventId,
    Date.now(),
  );
  await sql(
    "INSERT INTO event_member(id,event_id,user_id,role,status,slot_id,created_at) VALUES(?,?,?,'participant','waitlist',?,?)",
    crypto.randomUUID(),
    s.eventId,
    old.id,
    slot,
    Date.now() - 1000,
  );
  for (const [u, time] of [
    [late, 30],
    [first, 10],
    [second, 20],
  ] as const) {
    await vote(s.eventId, s.optionId, u);
    await sql(
      "UPDATE event_date_vote SET created_at=? WHERE option_id=? AND user_id=?",
      time,
      s.optionId,
      u.id,
    );
  }
  expect((await finish(s)).status).toBe(200);
  expect(
    (await eventMembersRepo.membersBySlotStatus(slot, "waitlist")).map(
      (r) => r.userId,
    ),
  ).toEqual([old.id, second.id, late.id]);
  expect(
    (await req(`/events/${s.eventId}/join`, first.cookie, "DELETE")).status,
  ).toBe(200);
  expect(
    (await members(s.eventId)).find((r) => r.user_id === old.id)?.status,
  ).toBe("confirmed");
});
const req = (path: string, cookie: string, method = "GET", body?: unknown) =>
  SELF.fetch(base + "/api" + path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const sql = (query: string, ...args: unknown[]) =>
  env.DB.prepare(query)
    .bind(...args)
    .run();
async function user() {
  const id = crypto.randomUUID(),
    sid = crypto.randomUUID();
  await sql(
    "INSERT INTO user(id,discord_id,username,created_at) VALUES(?,?,?,?)",
    id,
    id,
    id,
    Date.now(),
  );
  await sql(
    "INSERT INTO session(id,user_id,expires_at) VALUES(?,?,?)",
    sid,
    id,
    Date.now() + day,
  );
  return { id, cookie: `eventer_session=${sid}` };
}
async function setup() {
  const login = await req("/auth/dev-login", "", "POST");
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const r = await req("/events", cookie, "POST", {
    title: "自動参加",
    venueType: "offline",
    scheduling: true,
    startsAt: Date.now() + day,
    endsAt: Date.now() + day * 2,
  });
  expect(r.status).toBe(201);
  const { event } = (await r.json()) as { event: { id: string } };
  await req(`/events/${event.id}`, cookie, "PATCH", { status: "published" });
  const o = await req(`/events/${event.id}/date-options`, cookie, "POST", {
    startsAt: Date.now() + day * 3,
    endsAt: Date.now() + day * 4,
  });
  expect(o.status).toBe(201);
  const { id: optionId } = (await o.json()) as { id: string };
  return { eventId: event.id, cookie, optionId };
}
async function vote(
  eventId: string,
  optionId: string,
  u: Awaited<ReturnType<typeof user>>,
  choice = "yes",
) {
  expect(
    (
      await req(
        `/events/${eventId}/date-options/${optionId}/vote`,
        u.cookie,
        "PUT",
        { choice },
      )
    ).status,
  ).toBe(200);
}
const finish = (s: Awaited<ReturnType<typeof setup>>) =>
  req(`/events/${s.eventId}/finalize-date`, s.cookie, "POST", {
    optionId: s.optionId,
  });
async function members(id: string) {
  return (
    await env.DB.prepare(
      "SELECT user_id,status FROM event_member WHERE event_id=? AND role='participant'",
    )
      .bind(id)
      .all<{ user_id: string; status: string }>()
  ).results;
}

it("registers only selected yes/maybe, preserves existing and canceled, authorizes results, retries without restoring cancellation", async () => {
  const s = await setup();
  const yes = await user(),
    maybe = await user(),
    no = await user(),
    cancel = await user(),
    existing = await user(),
    other = await user();
  await sql(
    "INSERT INTO event_member(id,event_id,user_id,role,status,created_at) VALUES(?,?,?,'participant','applied',?)",
    crypto.randomUUID(),
    s.eventId,
    existing.id,
    Date.now(),
  );
  await vote(s.eventId, s.optionId, existing);
  const otherOption = await req(
    `/events/${s.eventId}/date-options`,
    s.cookie,
    "POST",
    { startsAt: Date.now() + day * 6, endsAt: Date.now() + day * 7 },
  );
  await vote(
    s.eventId,
    ((await otherOption.json()) as { id: string }).id,
    other,
  );
  await vote(s.eventId, s.optionId, yes);
  await vote(s.eventId, s.optionId, maybe, "maybe");
  await vote(s.eventId, s.optionId, no, "no");
  await vote(s.eventId, s.optionId, cancel);
  await sql(
    "INSERT INTO event_member(id,event_id,user_id,role,status,created_at) VALUES(?,?,?,'participant','canceled',?)",
    crypto.randomUUID(),
    s.eventId,
    cancel.id,
    Date.now(),
  );
  expect(
    (
      await req(`/events/${s.eventId}/finalize-date`, yes.cookie, "POST", {
        optionId: s.optionId,
      })
    ).status,
  ).toBe(403);
  const res = await finish(s);
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    results: Array<{ userId: string; outcome: string; reason: string }>;
  };
  expect(body.results.find((r) => r.userId === existing.id)?.outcome).toBe(
    "existing",
  );
  expect(body.results.some((r) => r.userId === other.id)).toBe(false);
  expect(body.results.find((r) => r.userId === cancel.id)?.reason).toBe(
    "canceled",
  );
  expect(
    (await members(s.eventId))
      .filter((m) => m.status === "confirmed")
      .map((m) => m.user_id)
      .sort(),
  ).toEqual([yes.id, maybe.id].sort());
  expect(
    (await req(`/events/${s.eventId}/schedule-registration`, no.cookie)).status,
  ).toBe(403);
  const entries = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM entry WHERE event_id=? AND kind='individual'",
  )
    .bind(s.eventId)
    .first<{ n: number }>();
  expect(entries?.n).toBe(2);
  expect(
    (await req(`/events/${s.eventId}/join`, yes.cookie, "DELETE")).status,
  ).toBe(200);
  expect((await finish(s)).status).toBe(200);
  expect(
    (await members(s.eventId)).find((m) => m.user_id === yes.id)?.status,
  ).toBe("canceled");
  const n = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM notification WHERE user_id=? AND type='schedule_finalized'",
  )
    .bind(yes.id)
    .first<{ n: number }>();
  expect(n?.n).toBe(1);
});
it.each(["first_come", "lottery"])(
  "honors a single %s slot without overbooking",
  async (type) => {
    const s = await setup(),
      a = await user(),
      b = await user();
    const slot = crypto.randomUUID();
    await sql(
      "INSERT INTO participation_slot(id,event_id,name,capacity,selection_type,created_at) VALUES(?,?,'一般',1,?,?)",
      slot,
      s.eventId,
      type,
      Date.now(),
    );
    await vote(s.eventId, s.optionId, a);
    await vote(s.eventId, s.optionId, b, "maybe");
    expect((await finish(s)).status).toBe(200);
    expect((await members(s.eventId)).map((m) => m.status).sort()).toEqual(
      type === "lottery" ? ["applied", "applied"] : ["confirmed", "waitlist"],
    );
    const late = await user();
    const joined = await req(`/events/${s.eventId}/join`, late.cookie, "POST", {
      slotId: slot,
    });
    expect(joined.status).toBe(201);
    expect(((await joined.json()) as { status: string }).status).toBe(
      type === "lottery" ? "applied" : "waitlist",
    );
  },
);
it.each([
  "survey_required",
  "slot_required",
  "event_ended",
  "registration_closed",
])("reports %s instead of bypassing it", async (reason) => {
  const s = await setup(),
    a = await user();
  await vote(s.eventId, s.optionId, a);
  if (reason === "survey_required")
    await sql(
      "INSERT INTO event_survey_question(id,event_id,question,required,sort_order,created_at) VALUES(?,?,'必須',1,0,?)",
      crypto.randomUUID(),
      s.eventId,
      Date.now(),
    );
  if (reason === "slot_required")
    for (let i = 0; i < 2; i++)
      await sql(
        "INSERT INTO participation_slot(id,event_id,name,capacity,created_at) VALUES(?,?,'枠',5,?)",
        crypto.randomUUID(),
        s.eventId,
        Date.now(),
      );
  if (reason === "event_ended")
    await sql(
      "UPDATE event_date_option SET starts_at=?,ends_at=? WHERE id=?",
      Date.now() - day * 2,
      Date.now() - day,
      s.optionId,
    );
  if (reason === "registration_closed")
    await sql(
      "UPDATE event SET registration_deadline=? WHERE id=?",
      Date.now() - 1000,
      s.eventId,
    );
  const r = await finish(s);
  expect(r.status).toBe(200);
  expect(
    ((await r.json()) as { results: Array<{ reason: string }> }).results[0]
      .reason,
  ).toBe(reason);
  expect(await members(s.eventId)).toHaveLength(0);
});
it("rolls back date, memberships, entries and receipts if notification write fails; competing finalizations commit once", async () => {
  const s = await setup(),
    a = await user();
  await vote(s.eventId, s.optionId, a);
  await sql(
    "CREATE TRIGGER fail_schedule_notice BEFORE INSERT ON notification WHEN NEW.type='schedule_finalized' BEGIN SELECT RAISE(ABORT,'test failure'); END",
  );
  try {
    expect((await finish(s)).status).toBe(500);
    expect(await members(s.eventId)).toHaveLength(0);
    expect(
      (
        await env.DB.prepare("SELECT scheduling FROM event WHERE id=?")
          .bind(s.eventId)
          .first<{ scheduling: number }>()
      )?.scheduling,
    ).toBe(1);
  } finally {
    await sql("DROP TRIGGER fail_schedule_notice");
  }
  const results = await Promise.all([finish(s), finish(s)]);
  expect(results.map((r) => r.status)).toEqual([200, 200]);
  expect(await members(s.eventId)).toHaveLength(1);
});
