import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import type { EventTodosPayload } from "@eventer/shared";
import { bindEnv, type Env } from "../src/runtime.js";
import { buildEventExtraHtml } from "../src/lib/email.js";
import { usersRepo } from "../src/db/repositories/users.js";

/**
 * スタッフ向けの準備 TODO (#393)。
 *
 * 主眼は2つ。
 *
 * 1. **参加者に1件も漏れないこと。** 漏れても誰も報告してくれない
 *    （参加者は「そういうものか」と読む）ので、経路を1つずつ押さえる
 * 2. **担当者が外れたときに名前が残らないこと。** とくに退会申請 (#250) は
 *    `event_member` の staff 行が残るので、メンバー行だけを見る実装だと
 *    退会した人の名前がスタッフの画面に出続ける
 *
 * この表を触る SQL が1か所に閉じていることは `staff-todo-sql-audit.test.ts`、
 * アカウント統合の登録漏れは `merge-user-columns.test.ts` が見張る。
 */

const BASE = "https://example.com";
const HOUR = 3600_000;

beforeAll(() => {
  bindEnv(env as unknown as Env);
});

interface TestUser {
  userId: string;
  cookie: string;
  username: string;
}

/** アプリ運営管理者ではない一般ユーザー（どのイベントのメンバーでもない） */
async function makeUser(): Promise<TestUser> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  const username = `u_${uid.slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(uid, `nostr:${uid}`, username, `担当${username}`, Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + 24 * HOUR)
    .run();
  return { userId: uid, cookie: `eventer_session=${sid}`, username };
}

type Role = "participant" | "staff" | "judge" | "observer";

async function makeMember(
  eventId: string,
  role: Role,
  status = "confirmed",
): Promise<TestUser> {
  const u = await makeUser();
  await env.DB.prepare(
    `INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at)
     VALUES (?, ?, ?, ?, NULL, ?, 0, ?)`,
  )
    .bind(crypto.randomUUID(), eventId, u.userId, role, status, Date.now())
    .run();
  return u;
}

/** 開発用ログイン。**この利用者はアプリ運営管理者**なので、
 * 「そのイベントの staff だから通った」ことの証拠には使えない */
async function loginDev(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/dev-login`, { method: "POST" });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

async function setupEvent(
  cookie: string,
  startsAt = Date.now() + 24 * HOUR,
): Promise<string> {
  const create = await SELF.fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      title: `準備TODOのE2E_${crypto.randomUUID().slice(0, 6)}`,
      venueType: "offline",
      startsAt,
      endsAt: startsAt + 8 * HOUR,
    }),
  });
  expect(create.status).toBe(201);
  const { event } = (await create.json()) as { event: { id: string } };
  const patch = await SELF.fetch(`${BASE}/api/events/${event.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ status: "published" }),
  });
  expect(patch.status).toBe(200);
  return event.id;
}

async function createTodo(
  eventId: string,
  cookie: string,
  body: Record<string, unknown>,
): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/todos`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function getTodos(
  eventId: string,
  cookie: string,
): Promise<EventTodosPayload> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/todos`, {
    headers: { cookie },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as EventTodosPayload;
}

/** 依存を足して、返ってきたエラーコード（成功なら null）を返す */
async function addDep(
  eventId: string,
  cookie: string,
  todoId: string,
  dependsOnId: string,
): Promise<{ status: number; error: string | null }> {
  const res = await SELF.fetch(
    `${BASE}/api/events/${eventId}/todos/${todoId}/deps`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ dependsOnId }),
    },
  );
  const body = (await res.json()) as { error?: string };
  return { status: res.status, error: body.error ?? null };
}

/* ===== 9.1 参加者に漏れない（最重要）===== */

describe("スタッフ以外は準備 TODO に触れない (#393 9.1)", () => {
  /** 役割ごとに**1本ずつ**書く。まとめない。
   * #383 では「4か所のうち1か所だけ直っていた」事故が実際に起きている */
  for (const role of ["participant", "judge", "observer"] as const) {
    it(`${role} は一覧を取れない`, async () => {
      const cookie = await loginDev();
      const eventId = await setupEvent(cookie);
      await createTodo(eventId, cookie, { title: "会場を押さえるヒミツ" });
      const other = await makeMember(eventId, role);
      const res = await SELF.fetch(`${BASE}/api/events/${eventId}/todos`, {
        headers: { cookie: other.cookie },
      });
      expect(res.status).toBe(403);
    });
  }

  it("そのイベントのメンバーでない利用者は一覧を取れない", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const stranger = await makeUser();
    const res = await SELF.fetch(`${BASE}/api/events/${eventId}/todos`, {
      headers: { cookie: stranger.cookie },
    });
    expect(res.status).toBe(403);
  });

  it("未ログインは 401", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const res = await SELF.fetch(`${BASE}/api/events/${eventId}/todos`);
    expect(res.status).toBe(401);
  });

  it("そのイベントの staff には全部返る（絞りすぎていない）", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    await createTodo(eventId, cookie, { title: "会場を押さえるヒミツ" });
    await createTodo(eventId, cookie, { title: "告知を出すヒミツ" });
    // **アプリ運営管理者ではない**、そのイベントの staff で確かめる
    const staff = await makeMember(eventId, "staff");
    const seen = await getTodos(eventId, staff.cookie);
    expect(seen.todos.map((t) => t.title)).toEqual([
      "会場を押さえるヒミツ",
      "告知を出すヒミツ",
    ]);
  });

  /** **書き込み6本すべて**を1本ずつ。1つにまとめない */
  it("participant は書き込み6本すべてが 403", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const a = await createTodo(eventId, cookie, { title: "会場を押さえるヒミツ" });
    const b = await createTodo(eventId, cookie, { title: "告知を出すヒミツ" });
    const p = await makeMember(eventId, "participant");
    const json = { "content-type": "application/json", cookie: p.cookie };
    const writes: Array<[name: string, res: Promise<Response>]> = [
      [
        "POST /todos",
        SELF.fetch(`${BASE}/api/events/${eventId}/todos`, {
          method: "POST",
          headers: json,
          body: JSON.stringify({ title: "勝手に足す" }),
        }),
      ],
      [
        "PATCH /todos/:id",
        SELF.fetch(`${BASE}/api/events/${eventId}/todos/${a}`, {
          method: "PATCH",
          headers: json,
          body: JSON.stringify({ status: "done" }),
        }),
      ],
      [
        "DELETE /todos/:id",
        SELF.fetch(`${BASE}/api/events/${eventId}/todos/${a}`, {
          method: "DELETE",
          headers: { cookie: p.cookie },
        }),
      ],
      [
        "PUT /todos/order",
        SELF.fetch(`${BASE}/api/events/${eventId}/todos/order`, {
          method: "PUT",
          headers: json,
          body: JSON.stringify({ ids: [b, a] }),
        }),
      ],
      [
        "POST /todos/:id/deps",
        SELF.fetch(`${BASE}/api/events/${eventId}/todos/${b}/deps`, {
          method: "POST",
          headers: json,
          body: JSON.stringify({ dependsOnId: a }),
        }),
      ],
      [
        "DELETE /todos/:id/deps/:dep",
        SELF.fetch(`${BASE}/api/events/${eventId}/todos/${b}/deps/${a}`, {
          method: "DELETE",
          headers: { cookie: p.cookie },
        }),
      ],
    ];
    for (const [name, promise] of writes) {
      expect((await promise).status, `${name} が 403 でない`).toBe(403);
    }

    // 実際に何も起きていないこと（403 を返しつつ書いていた、を防ぐ）
    const seen = await getTodos(eventId, cookie);
    expect(seen.todos).toHaveLength(2);
    expect(seen.todos.every((t) => t.status === "open")).toBe(true);
    expect(seen.deps).toEqual([]);
  });
});

/* ===== 9.2 参加者向けの既存レスポンスに混ざらない ===== */

describe("参加者向けの経路に TODO が1件も出ない (#393 9.2)", () => {
  it("6経路すべてに題名の文字列が現れない", async () => {
    const cookie = await loginDev();
    // メールは JST の時刻を出すので開催日時は固定値にする
    const eventId = await setupEvent(cookie, Date.UTC(2026, 8, 12, 1, 0));
    const secret = `備品を買うヒミツ_${crypto.randomUUID().slice(0, 6)}`;
    await createTodo(eventId, cookie, {
      title: secret,
      note: "同じくヒミツの補足",
      startsOn: "2026-09-01",
      dueOn: "2026-09-05",
    });
    const member = await makeMember(eventId, "participant");

    // **id ではなく題名の文字列で照合する。**
    // id だけだと「id は返すが中身は伏せる」形にしたとき通ってしまう (#383 9.1)
    const routes: Array<[name: string, res: Promise<Response>]> = [
      [
        "イベント詳細",
        SELF.fetch(`${BASE}/api/events/${eventId}`, {
          headers: { cookie: member.cookie },
        }),
      ],
      [
        "タイムテーブル",
        SELF.fetch(`${BASE}/api/events/${eventId}/timetable`, {
          headers: { cookie: member.cookie },
        }),
      ],
      [
        "出席CSV",
        SELF.fetch(`${BASE}/api/events/${eventId}/attendance.csv`, {
          headers: { cookie },
        }),
      ],
      ["フィード(RSS)", SELF.fetch(`${BASE}/feed/events.rss`)],
      ["フィード(ICS)", SELF.fetch(`${BASE}/feed/events.ics`)],
      ["公開イベント一覧", SELF.fetch(`${BASE}/api/public/events`)],
    ];
    for (const [name, promise] of routes) {
      const text = await (await promise).text();
      expect(text.includes(secret), `${name} に TODO の題名が出ている`).toBe(false);
      expect(text.includes("同じくヒミツの補足")).toBe(false);
    }

    // 前日リマインダーのメール本文
    const html = await buildEventExtraHtml(`/events/${eventId}`, true);
    expect(html).not.toContain(secret);
  });
});

/* ===== 9.4 循環 ===== */

describe("依存の循環を書かせない (#393 9.4)", () => {
  it("自分自身への依存は 400", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const a = await createTodo(eventId, cookie, { title: "A" });
    const r = await addDep(eventId, cookie, a, a);
    expect(r.status).toBe(400);
    expect(r.error).toBe("todo_dep_self");
  });

  it("A→B があるとき B→A は 400", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const a = await createTodo(eventId, cookie, { title: "A" });
    const b = await createTodo(eventId, cookie, { title: "B" });
    expect((await addDep(eventId, cookie, a, b)).status).toBe(201);
    const r = await addDep(eventId, cookie, b, a);
    expect(r.status).toBe(400);
    expect(r.error).toBe("todo_dep_cycle");
  });

  it("A→B→C があるとき C→A は 400（推移的な循環）", async () => {
    // **1段だけの実装はここで落ちる**
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const a = await createTodo(eventId, cookie, { title: "A" });
    const b = await createTodo(eventId, cookie, { title: "B" });
    const c = await createTodo(eventId, cookie, { title: "C" });
    expect((await addDep(eventId, cookie, a, b)).status).toBe(201);
    expect((await addDep(eventId, cookie, b, c)).status).toBe(201);
    const r = await addDep(eventId, cookie, c, a);
    expect(r.status).toBe(400);
    expect(r.error).toBe("todo_dep_cycle");
  });

  it("分岐と合流は循環ではない（絞りすぎていない）", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const a = await createTodo(eventId, cookie, { title: "A" });
    const b = await createTodo(eventId, cookie, { title: "B" });
    const c = await createTodo(eventId, cookie, { title: "C" });
    const d = await createTodo(eventId, cookie, { title: "D" });
    // 分岐: A が B と C の両方を待つ
    expect((await addDep(eventId, cookie, a, b)).status).toBe(201);
    expect((await addDep(eventId, cookie, a, c)).status).toBe(201);
    // 合流: B と C の両方が D を待つ
    expect((await addDep(eventId, cookie, b, d)).status).toBe(201);
    expect((await addDep(eventId, cookie, c, d)).status).toBe(201);
    const seen = await getTodos(eventId, cookie);
    expect(seen.deps).toHaveLength(4);
  });

  it("1項目あたりの依存の本数に上限がある", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const target = await createTodo(eventId, cookie, { title: "待つ側" });
    for (let i = 0; i < 10; i++) {
      const dep = await createTodo(eventId, cookie, { title: `先${i}` });
      expect((await addDep(eventId, cookie, target, dep)).status).toBe(201);
    }
    const extra = await createTodo(eventId, cookie, { title: "11本目" });
    const r = await addDep(eventId, cookie, target, extra);
    expect(r.status).toBe(400);
    expect(r.error).toBe("todo_dep_limit");
  });

  it("別イベントの項目を依存先に指定すると 404（403 ではない）", async () => {
    const cookie = await loginDev();
    const one = await setupEvent(cookie);
    const two = await setupEvent(cookie);
    const here = await createTodo(one, cookie, { title: "こちら" });
    const there = await createTodo(two, cookie, { title: "よそ" });
    // **他イベントの id の存在を教えない**
    const r = await addDep(one, cookie, here, there);
    expect(r.status).toBe(404);
    expect(r.error).toBe("not_found");
    // 逆向き（待つ側が他イベント）も同じ
    const r2 = await addDep(one, cookie, there, here);
    expect(r2.status).toBe(404);
  });

  it("循環がデータに入っていても取得が有限時間で返る", async () => {
    // リポジトリを通さず直接 INSERT で A→B→A を作る。
    // 書き込みの検査は競合で抜けうるので、**読み側が単独で終わる**ことを確かめる
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const a = await createTodo(eventId, cookie, { title: "循環A" });
    const b = await createTodo(eventId, cookie, { title: "循環B" });
    for (const [x, y] of [
      [a, b],
      [b, a],
    ]) {
      await env.DB.prepare(
        "INSERT INTO event_todo_dep (todo_id, depends_on_id, created_at) VALUES (?, ?, ?)",
      )
        .bind(x, y, Date.now())
        .run();
    }
    const seen = await getTodos(eventId, cookie);
    // **黙って隠さない。** 壊れた辺も返す（印を出すのは画面側の仕事）
    expect(seen.deps).toHaveLength(2);
    expect(seen.todos).toHaveLength(2);

    // 循環が入った後でも、新しい辺を足そうとする判定が返ってくる
    const c = await createTodo(eventId, cookie, { title: "循環C" });
    const r = await addDep(eventId, cookie, c, a);
    expect(r.status).toBe(201);
  });
});

/* ===== 9.5 担当者（2.3 の4通りを1つずつ）===== */

describe("担当者が外れたとき (#393 9.5)", () => {
  /** 担当つきの TODO を1件持つイベントを作る */
  async function setupWithAssignee(): Promise<{
    cookie: string;
    eventId: string;
    staff: TestUser;
    todoId: string;
  }> {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const staff = await makeMember(eventId, "staff");
    const todoId = await createTodo(eventId, cookie, {
      title: "会場を押さえるヒミツ",
      assigneeUserId: staff.userId,
    });
    const seen = await getTodos(eventId, cookie);
    expect(seen.todos[0]!.assigneeState).toBe("active");
    expect(seen.todos[0]!.assignee!.username).toBe(staff.username);
    return { cookie, eventId, staff, todoId };
  }

  it("そのイベントの staff でない人は担当に指定できない", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const participant = await makeMember(eventId, "participant");
    const res = await SELF.fetch(`${BASE}/api/events/${eventId}/todos`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        title: "だめな割り当て",
        assigneeUserId: participant.userId,
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({
      error: "todo_assignee_not_staff",
    });
  });

  it("除名（メンバー行を消す）", async () => {
    const { cookie, eventId, staff } = await setupWithAssignee();
    await env.DB.prepare(
      "DELETE FROM event_member WHERE event_id = ? AND user_id = ?",
    )
      .bind(eventId, staff.userId)
      .run();
    const seen = await getTodos(eventId, cookie);
    expect(seen.todos).toHaveLength(1); // TODO は消えない
    expect(seen.todos[0]!.assigneeState).toBe("left");
    expect(seen.todos[0]!.assignee).toBeNull();
  });

  it("降格（staff → participant）", async () => {
    const { cookie, eventId, staff } = await setupWithAssignee();
    await env.DB.prepare(
      "UPDATE event_member SET role = 'participant' WHERE event_id = ? AND user_id = ?",
    )
      .bind(eventId, staff.userId)
      .run();
    const seen = await getTodos(eventId, cookie);
    expect(seen.todos[0]!.assigneeState).toBe("left");
    expect(seen.todos[0]!.assignee).toBeNull();
  });

  it("退会申請（メンバー行は残る）— ここが最も落ちやすい", async () => {
    // `event_member` だけを見る実装は、**ここで "active" のまま名前を出す**。
    // #250 の目的（他の利用者から見えなくなる）が果たされない
    const { cookie, eventId, staff } = await setupWithAssignee();
    await usersRepo.requestDeletion(staff.userId, Date.now());
    const member = await env.DB.prepare(
      "SELECT role FROM event_member WHERE event_id = ? AND user_id = ?",
    )
      .bind(eventId, staff.userId)
      .first<{ role: string }>();
    expect(member?.role, "退会申請ではメンバー行が残るのが前提").toBe("staff");

    const res = await SELF.fetch(`${BASE}/api/events/${eventId}/todos`, {
      headers: { cookie },
    });
    const text = await res.text();
    const seen = JSON.parse(text) as EventTodosPayload;
    expect(seen.todos[0]!.assigneeState).toBe("left");
    expect(seen.todos[0]!.assignee).toBeNull();
    // 表示名・ハンドルが本文のどこにも出ないこと
    expect(text).not.toContain(staff.username);
    // 選択肢にも並ばない
    expect(seen.assignable.map((a) => a.id)).not.toContain(staff.userId);
  });

  it("完全削除（user 行を消す）— TODO は残り、担当だけ NULL に落ちる", async () => {
    const { cookie, eventId, staff } = await setupWithAssignee();
    await env.DB.prepare("DELETE FROM user WHERE id = ?").bind(staff.userId).run();
    const seen = await getTodos(eventId, cookie);
    // CASCADE にしていたらここで TODO ごと消える。SET NULL の証拠
    expect(seen.todos).toHaveLength(1);
    expect(seen.todos[0]!.title).toBe("会場を押さえるヒミツ");
    expect(seen.todos[0]!.assigneeState).toBe("unassigned");
    expect(seen.todos[0]!.assignee).toBeNull();
  });

  it("担当の選択肢に、退会申請中・未確定・participant が入らない", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const ok = await makeMember(eventId, "staff");
    const pending = await makeMember(eventId, "staff", "applied");
    const participant = await makeMember(eventId, "participant");
    const leaving = await makeMember(eventId, "staff");
    await usersRepo.requestDeletion(leaving.userId, Date.now());

    const seen = await getTodos(eventId, cookie);
    const ids = seen.assignable.map((a) => a.id);
    expect(ids).toContain(ok.userId);
    expect(ids).not.toContain(pending.userId);
    expect(ids).not.toContain(participant.userId);
    // **`deleted_at` を落とすと退会者がここに並ぶ**
    expect(ids).not.toContain(leaving.userId);
  });

  it("アカウント統合の後、担当が勝ち側に付いている", async () => {
    // `mergeUsers` の `simple` に足し忘れると、負け側の user 行を消した瞬間に
    // ON DELETE SET NULL が発火して**担当が黙って未割り当てになる**
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const loser = await makeMember(eventId, "staff");
    const winner = await makeMember(eventId, "staff");
    await createTodo(eventId, cookie, {
      title: "統合されるヒミツ",
      assigneeUserId: loser.userId,
    });

    await usersRepo.mergeUsers(winner.userId, loser.userId);

    const seen = await getTodos(eventId, cookie);
    expect(seen.todos[0]!.assigneeState).toBe("active");
    expect(seen.todos[0]!.assignee!.id).toBe(winner.userId);
  });
});

/* ===== 9.7 応答の形（待ち・遅れを保存していないことの担保）===== */

describe("待ちと遅れは保存しない (#393 3.7)", () => {
  it("応答に blocked / overdue の列が無い", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const a = await createTodo(eventId, cookie, {
      title: "とっくに過ぎた仕事",
      dueOn: "2020-01-01",
    });
    const b = await createTodo(eventId, cookie, { title: "待たされる仕事" });
    expect((await addDep(eventId, cookie, b, a)).status).toBe(201);

    const seen = await getTodos(eventId, cookie);
    for (const todo of seen.todos) {
      expect(Object.keys(todo)).not.toContain("blocked");
      expect(Object.keys(todo)).not.toContain("overdue");
    }
    // 列にしていないので、状態は 2 値しか取らない
    expect(new Set(seen.todos.map((t) => t.status))).toEqual(new Set(["open"]));
  });

  it("送ったキーだけが変わる（省略は「いまの値を保つ」）", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const staff = await makeMember(eventId, "staff");
    const id = await createTodo(eventId, cookie, {
      title: "元の題名",
      note: "元の補足",
      startsOn: "2026-09-01",
      dueOn: "2026-09-05",
      assigneeUserId: staff.userId,
    });

    // チェックを付けるだけ。**担当も日付も消えてはいけない**
    const done = await SELF.fetch(`${BASE}/api/events/${eventId}/todos/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ status: "done" }),
    });
    expect(done.status).toBe(200);
    let todo = (await getTodos(eventId, cookie)).todos[0]!;
    expect(todo.status).toBe("done");
    expect(todo.doneAt).not.toBeNull();
    expect(todo.title).toBe("元の題名");
    expect(todo.note).toBe("元の補足");
    expect(todo.startsOn).toBe("2026-09-01");
    expect(todo.assignee!.id).toBe(staff.userId);

    // `null` を**明示**したときだけ消える
    const clear = await SELF.fetch(`${BASE}/api/events/${eventId}/todos/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ assigneeUserId: null, dueOn: null, status: "open" }),
    });
    expect(clear.status).toBe(200);
    todo = (await getTodos(eventId, cookie)).todos[0]!;
    expect(todo.assigneeState).toBe("unassigned");
    expect(todo.dueOn).toBeNull();
    expect(todo.startsOn).toBe("2026-09-01"); // 送っていない側は残る
    expect(todo.doneAt).toBeNull(); // open に戻したら完了時刻も消える
  });

  it("逆さまの期間は作れない（部分更新でも現在値と突き合わせる）", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const id = await createTodo(eventId, cookie, {
      title: "期間",
      startsOn: "2026-09-10",
      dueOn: "2026-09-20",
    });
    // 送っていない startsOn（2026-09-10）と突き合わせて弾く
    const res = await SELF.fetch(`${BASE}/api/events/${eventId}/todos/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ dueOn: "2026-09-01" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({
      error: "todo_bad_range",
    });
  });

  it("実在しない日付は受け付けない", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const res = await SELF.fetch(`${BASE}/api/events/${eventId}/todos`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ title: "2月31日", dueOn: "2026-02-31" }),
    });
    expect(res.status).toBe(400);
  });
});
