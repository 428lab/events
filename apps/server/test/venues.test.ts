import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

const BASE = "https://example.com";

async function makeUser(): Promise<{ userId: string; cookie: string }> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(uid, `nostr:${uid}`, `u_${uid.slice(0, 8)}`, "テスト", Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + 86400000)
    .run();
  return { userId: uid, cookie: `eventer_session=${sid}` };
}

async function createVenue(
  cookie: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/venues`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      name: `テスト会場_${crypto.randomUUID().slice(0, 6)}`,
      area: "東京都渋谷区",
      address: "道玄坂1-2-3 テストビル4F",
      contact: "X: @secret_contact",
      ...extra,
    }),
  });
  expect(res.status).toBe(201);
  const { venue } = (await res.json()) as { venue: { id: string } };
  return venue.id;
}

describe("会場マッチング (#53 PR1)", () => {
  it("登録→公開一覧・詳細に出る。連絡先・非公開住所は他人に漏れない", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const id = await createVenue(owner.cookie);

    // 公開一覧（未ログイン）
    const list = await SELF.fetch(`${BASE}/api/public/venues`);
    expect(list.status).toBe(200);
    const { venues } = (await list.json()) as {
      venues: { id: string; address: string }[];
    };
    const inList = venues.find((v) => v.id === id);
    expect(inList).toBeTruthy();
    // 非公開住所は一覧にも出ない
    expect(inList!.address).toBe("");
    expect(JSON.stringify(venues)).not.toContain("secret_contact");

    // 詳細（他人）: 連絡先・非公開住所なし
    const detail = await SELF.fetch(`${BASE}/api/public/venues/${id}`, {
      headers: { cookie: stranger.cookie },
    });
    const body = (await detail.json()) as {
      venue: Record<string, unknown>;
      isOwner: boolean;
    };
    expect(body.isOwner).toBe(false);
    expect(body.venue.address).toBe("");
    expect(JSON.stringify(body)).not.toContain("secret_contact");
    expect(JSON.stringify(body)).not.toContain("道玄坂");

    // 詳細（オーナー本人）: 連絡先・住所込み
    const mine = await SELF.fetch(`${BASE}/api/public/venues/${id}`, {
      headers: { cookie: owner.cookie },
    });
    const mineBody = (await mine.json()) as {
      venue: { address: string; contact: string };
      isOwner: boolean;
    };
    expect(mineBody.isOwner).toBe(true);
    expect(mineBody.venue.address).toContain("道玄坂");
    expect(mineBody.venue.contact).toContain("secret_contact");
  });

  it("住所公開設定ONなら詳細住所が公開される", async () => {
    const owner = await makeUser();
    const id = await createVenue(owner.cookie, { addressPublic: true });
    const detail = await SELF.fetch(`${BASE}/api/public/venues/${id}`);
    const body = (await detail.json()) as { venue: { address: string } };
    expect(body.venue.address).toContain("道玄坂");
  });

  it("他人は編集・削除できない(403)。オーナーは編集でき、closedで一覧から消える", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const id = await createVenue(owner.cookie);

    const deniedPatch = await SELF.fetch(`${BASE}/api/venues/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: stranger.cookie },
      body: JSON.stringify({ name: "乗っ取り" }),
    });
    expect(deniedPatch.status).toBe(403);
    const deniedDel = await SELF.fetch(`${BASE}/api/venues/${id}`, {
      method: "DELETE",
      headers: { cookie: stranger.cookie },
    });
    expect(deniedDel.status).toBe(403);

    // オーナーが受付停止に
    const patch = await SELF.fetch(`${BASE}/api/venues/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({ status: "closed" }),
    });
    expect(patch.status).toBe(200);
    const list = await SELF.fetch(`${BASE}/api/public/venues`);
    const { venues } = (await list.json()) as { venues: { id: string }[] };
    expect(venues.some((v) => v.id === id)).toBe(false);

    // /mine には停止中も出る
    const mineList = await SELF.fetch(`${BASE}/api/venues/mine`, {
      headers: { cookie: owner.cookie },
    });
    const mineBody = (await mineList.json()) as { venues: { id: string }[] };
    expect(mineBody.venues.some((v) => v.id === id)).toBe(true);
  });

  it("カバー画像のアップロードと配信", async () => {
    const owner = await makeUser();
    const id = await createVenue(owner.cookie);
    const png = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
      ),
      (c) => c.charCodeAt(0),
    );
    const up = await SELF.fetch(`${BASE}/api/venues/${id}/image`, {
      method: "PUT",
      headers: { "content-type": "image/png", cookie: owner.cookie },
      body: png,
    });
    expect(up.status).toBe(200);
    const img = await SELF.fetch(`${BASE}/api/venues/${id}/image`);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toContain("image/png");
    // R2ストリームを消費してハンドルを閉じる（isolated storage の解放に必要）
    const bytes = await img.arrayBuffer();
    expect(bytes.byteLength).toBe(png.byteLength);
  });

  it("未ログインは登録できない(401)", async () => {
    const res = await SELF.fetch(`${BASE}/api/venues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x", area: "y" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("会場オファー (#53 PR2)", () => {
  async function makePublishedEvent(
    cookie: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const create = await SELF.fetch(`${BASE}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        title: `会場募集イベント_${crypto.randomUUID().slice(0, 6)}`,
        venueType: "offline",
        startsAt: Date.now() + 3600_000,
        endsAt: Date.now() + 7200_000,
        venueWanted: true,
        ...extra,
      }),
    });
    const { event } = (await create.json()) as { event: { id: string } };
    await SELF.fetch(`${BASE}/api/events/${event.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ status: "published" }),
    });
    return event.id;
  }

  it("会場→イベント: オファー→主催者承諾で連絡先が相互開示される", async () => {
    const organizer = await makeUser();
    const venueOwner = await makeUser();
    const eventId = await makePublishedEvent(organizer.cookie);
    const venueId = await createVenue(venueOwner.cookie);

    // 会場オーナーが提供オファー
    const offer = await SELF.fetch(`${BASE}/api/venue-offers`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: venueOwner.cookie },
      body: JSON.stringify({ venueId, eventId }),
    });
    expect(offer.status).toBe(201);
    const { offer: o } = (await offer.json()) as { offer: { id: string } };

    // 主催者に通知
    const notifs = await SELF.fetch(`${BASE}/api/notifications`, {
      headers: { cookie: organizer.cookie },
    });
    const nbody = (await notifs.json()) as { notifications: { type: string }[] };
    expect(nbody.notifications.some((n) => n.type === "venue_offer")).toBe(true);

    // 第三者は respond できない
    const stranger = await makeUser();
    const deniedResp = await SELF.fetch(
      `${BASE}/api/venue-offers/${o.id}/respond`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: stranger.cookie },
        body: JSON.stringify({ action: "accept" }),
      },
    );
    expect(deniedResp.status).toBe(403);

    // 承諾前: 主催者側一覧に会場連絡先は出ない
    const before = await SELF.fetch(
      `${BASE}/api/venue-offers/for-event/${eventId}`,
      { headers: { cookie: organizer.cookie } },
    );
    const beforeBody = (await before.json()) as {
      offers: { venueContact: string; venueAddress: string }[];
    };
    expect(beforeBody.offers[0].venueContact).toBe("");
    expect(beforeBody.offers[0].venueAddress).toBe("");

    // 主催者が承諾（連絡先つき）
    const accept = await SELF.fetch(`${BASE}/api/venue-offers/${o.id}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: organizer.cookie },
      body: JSON.stringify({ action: "accept", contact: "X: @organizer" }),
    });
    expect(accept.status).toBe(200);

    // 主催者側: 会場の連絡先・住所が開示
    const after = await SELF.fetch(
      `${BASE}/api/venue-offers/for-event/${eventId}`,
      { headers: { cookie: organizer.cookie } },
    );
    const afterBody = (await after.json()) as {
      offers: { venueContact: string; venueAddress: string; organizerContact: string }[];
    };
    expect(afterBody.offers[0].venueContact).toContain("secret_contact");
    expect(afterBody.offers[0].venueAddress).toContain("道玄坂");
    // 主催者側ビューに organizerContact は返さない（自分のものだが会場側専用フィールド）
    expect(afterBody.offers[0].organizerContact).toBe("");

    // 会場側: 主催者の連絡先が開示
    const venueSide = await SELF.fetch(
      `${BASE}/api/venue-offers/for-venue/${venueId}`,
      { headers: { cookie: venueOwner.cookie } },
    );
    const venueSideBody = (await venueSide.json()) as {
      offers: { organizerContact: string; venueContact: string }[];
    };
    expect(venueSideBody.offers[0].organizerContact).toBe("X: @organizer");
    expect(venueSideBody.offers[0].venueContact).toBe("");

    // 会場オーナーへ結果通知
    const ownerNotifs = await SELF.fetch(`${BASE}/api/notifications`, {
      headers: { cookie: venueOwner.cookie },
    });
    const on = (await ownerNotifs.json()) as { notifications: { type: string }[] };
    expect(on.notifications.some((n) => n.type === "venue_offer_result")).toBe(true);
  });

  it("イベント→会場: 主催者の利用申込を会場オーナーが承諾", async () => {
    const organizer = await makeUser();
    const venueOwner = await makeUser();
    const eventId = await makePublishedEvent(organizer.cookie, {
      venueWanted: false,
    });
    const venueId = await createVenue(venueOwner.cookie);

    const offer = await SELF.fetch(`${BASE}/api/venue-offers`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: organizer.cookie },
      body: JSON.stringify({ venueId, eventId, contact: "Discord: org#1" }),
    });
    expect(offer.status).toBe(201);
    const { offer: o } = (await offer.json()) as { offer: { id: string } };

    // 重複オファーは409
    const dup = await SELF.fetch(`${BASE}/api/venue-offers`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: organizer.cookie },
      body: JSON.stringify({ venueId, eventId }),
    });
    expect(dup.status).toBe(409);

    // 会場オーナーが承諾
    const accept = await SELF.fetch(`${BASE}/api/venue-offers/${o.id}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: venueOwner.cookie },
      body: JSON.stringify({ action: "accept" }),
    });
    expect(accept.status).toBe(200);

    const venueSide = await SELF.fetch(
      `${BASE}/api/venue-offers/for-venue/${venueId}`,
      { headers: { cookie: venueOwner.cookie } },
    );
    const vs = (await venueSide.json()) as {
      offers: { organizerContact: string }[];
    };
    expect(vs.offers[0].organizerContact).toBe("Discord: org#1");
  });

  it("会場募集していないイベントへの提供オファーは409。無関係ユーザーのオファーは403", async () => {
    const organizer = await makeUser();
    const venueOwner = await makeUser();
    const stranger = await makeUser();
    const eventId = await makePublishedEvent(organizer.cookie, {
      venueWanted: false,
    });
    const venueId = await createVenue(venueOwner.cookie);

    const notWanted = await SELF.fetch(`${BASE}/api/venue-offers`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: venueOwner.cookie },
      body: JSON.stringify({ venueId, eventId }),
    });
    expect(notWanted.status).toBe(409);

    // 会場オーナーでも主催者でもない人は403
    const denied = await SELF.fetch(`${BASE}/api/venue-offers`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: stranger.cookie },
      body: JSON.stringify({ venueId, eventId }),
    });
    expect(denied.status).toBe(403);
  });

  it("会場募集中の一覧に venueWanted のイベントが出る", async () => {
    const organizer = await makeUser();
    const eventId = await makePublishedEvent(organizer.cookie);
    const res = await SELF.fetch(`${BASE}/api/public/venues/wanted`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: { id: string }[] };
    expect(body.events.some((e) => e.id === eventId)).toBe(true);
  });
});
