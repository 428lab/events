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

describe("会場オファーの追加ケース (#53 PR2 レビュー対応)", () => {
  it("メンバー限定たまごへのオファーは404（存在秘匿）。公開たまごへの提供→承諾は成立", async () => {
    const creator = await makeUser();
    const venueOwner = await makeUser();
    const venueId = await createVenue(venueOwner.cookie);

    // メンバー限定たまご（コミュニティ直作成）
    const cid = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO community (id, slug, name, owner_id, created_at) VALUES (?, ?, 'c', ?, ?)",
    )
      .bind(cid, `c${cid.slice(0, 8)}`, creator.userId, Date.now())
      .run();
    await env.DB.prepare(
      "INSERT INTO community_member (id, community_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)",
    )
      .bind(crypto.randomUUID(), cid, creator.userId, Date.now())
      .run();
    const secretReq = await SELF.fetch(`${BASE}/api/event-requests`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: creator.cookie },
      body: JSON.stringify({
        title: "限定たまご会場募集",
        communityId: cid,
        membersOnly: true,
        venueWanted: true,
      }),
    });
    const { request: secret } = (await secretReq.json()) as {
      request: { id: string };
    };
    const denied = await SELF.fetch(`${BASE}/api/venue-offers`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: venueOwner.cookie },
      body: JSON.stringify({ venueId, requestId: secret.id }),
    });
    expect(denied.status).toBe(404);

    // 公開たまご（会場募集中）への提供→投稿者が承諾
    const openReq = await SELF.fetch(`${BASE}/api/event-requests`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: creator.cookie },
      body: JSON.stringify({ title: "公開たまご会場募集", venueWanted: true }),
    });
    const { request: openR } = (await openReq.json()) as {
      request: { id: string };
    };
    const offer = await SELF.fetch(`${BASE}/api/venue-offers`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: venueOwner.cookie },
      body: JSON.stringify({ venueId, requestId: openR.id }),
    });
    expect(offer.status).toBe(201);
    const { offer: o } = (await offer.json()) as { offer: { id: string } };
    const accept = await SELF.fetch(`${BASE}/api/venue-offers/${o.id}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: creator.cookie },
      body: JSON.stringify({ action: "accept", contact: "X: @egg_creator" }),
    });
    expect(accept.status).toBe(200);

    // 投稿者側: 会場連絡先が開示
    const mine = await SELF.fetch(
      `${BASE}/api/venue-offers/for-request/${openR.id}`,
      { headers: { cookie: creator.cookie } },
    );
    const mb = (await mine.json()) as { offers: { venueContact: string }[] };
    expect(mb.offers[0].venueContact).toContain("secret_contact");

    // 第三者は for-request を見られない
    const stranger = await makeUser();
    const deniedList = await SELF.fetch(
      `${BASE}/api/venue-offers/for-request/${openR.id}`,
      { headers: { cookie: stranger.cookie } },
    );
    expect(deniedList.status).toBe(403);
  });
});

describe("会場ギャラリー写真 (#63)", () => {
  const png = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
    ),
    (c) => c.charCodeAt(0),
  );

  it("オーナーが投稿→公開一覧・画像取得。他人は投稿/削除403。上限10点で409", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const venueId = await createVenue(owner.cookie);

    // 他人は投稿できない
    const denied = await SELF.fetch(`${BASE}/api/venues/${venueId}/photos`, {
      method: "POST",
      headers: { "content-type": "image/png", cookie: stranger.cookie },
      body: png,
    });
    expect(denied.status).toBe(403);

    // オーナーが10点投稿
    let lastId = "";
    for (let i = 0; i < 10; i++) {
      const up = await SELF.fetch(`${BASE}/api/venues/${venueId}/photos`, {
        method: "POST",
        headers: { "content-type": "image/png", cookie: owner.cookie },
        body: png,
      });
      expect(up.status).toBe(201);
      lastId = ((await up.json()) as { photo: { id: string } }).photo.id;
    }
    // 11点目は409
    const over = await SELF.fetch(`${BASE}/api/venues/${venueId}/photos`, {
      method: "POST",
      headers: { "content-type": "image/png", cookie: owner.cookie },
      body: png,
    });
    expect(over.status).toBe(409);

    // 未ログインで一覧・画像が見える
    const list = await SELF.fetch(`${BASE}/api/venues/${venueId}/photos`);
    expect(list.status).toBe(200);
    const { photos } = (await list.json()) as { photos: { id: string }[] };
    expect(photos.length).toBe(10);
    const img = await SELF.fetch(
      `${BASE}/api/venues/${venueId}/photos/${lastId}/image`,
    );
    expect(img.status).toBe(200);
    const bytes = await img.arrayBuffer();
    expect(bytes.byteLength).toBe(png.byteLength);

    // 他人は削除できない・オーナーは削除できる
    const delDenied = await SELF.fetch(
      `${BASE}/api/venues/${venueId}/photos/${lastId}`,
      { method: "DELETE", headers: { cookie: stranger.cookie } },
    );
    expect(delDenied.status).toBe(403);
    const del = await SELF.fetch(
      `${BASE}/api/venues/${venueId}/photos/${lastId}`,
      { method: "DELETE", headers: { cookie: owner.cookie } },
    );
    expect(del.status).toBe(200);
    const after = await SELF.fetch(`${BASE}/api/venues/${venueId}/photos`);
    expect(((await after.json()) as { photos: unknown[] }).photos.length).toBe(9);
  });

  it("許可外MIMEは400", async () => {
    const owner = await makeUser();
    const venueId = await createVenue(owner.cookie);
    const bad = await SELF.fetch(`${BASE}/api/venues/${venueId}/photos`, {
      method: "POST",
      headers: { "content-type": "image/svg+xml", cookie: owner.cookie },
      body: "<svg/>",
    });
    expect(bad.status).toBe(400);
  });
});

describe("会場写真の参加者投稿と承認フロー (#65)", () => {
  const png2 = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
    ),
    (c) => c.charCodeAt(0),
  );

  async function notifTypes(cookie: string): Promise<string[]> {
    const res = await SELF.fetch(`${BASE}/api/notifications`, {
      headers: { cookie },
    });
    return (
      (await res.json()) as { notifications: { type: string }[] }
    ).notifications.map((n) => n.type);
  }

  it("マッチング済みイベントの参加者は審査待ち投稿でき、承認で公開・却下で通知＋削除", async () => {
    const organizer = await makeUser();
    const venueOwner = await makeUser();
    const participant = await makeUser();
    const outsider = await makeUser();
    const venueId = await createVenue(venueOwner.cookie);

    // 会場募集イベント作成→公開
    const create = await SELF.fetch(`${BASE}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: organizer.cookie },
      body: JSON.stringify({
        title: `会場写真イベント_${crypto.randomUUID().slice(0, 6)}`,
        venueType: "offline",
        startsAt: Date.now() + 3600_000,
        endsAt: Date.now() + 7200_000,
        venueWanted: true,
      }),
    });
    const { event } = (await create.json()) as { event: { id: string } };
    await SELF.fetch(`${BASE}/api/events/${event.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: organizer.cookie },
      body: JSON.stringify({ status: "published" }),
    });
    // 会場オーナーがオファー→主催者が承諾（マッチング成立）
    const offer = await SELF.fetch(`${BASE}/api/venue-offers`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: venueOwner.cookie },
      body: JSON.stringify({ venueId, eventId: event.id }),
    });
    const { offer: o } = (await offer.json()) as { offer: { id: string } };
    await SELF.fetch(`${BASE}/api/venue-offers/${o.id}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: organizer.cookie },
      body: JSON.stringify({ action: "accept" }),
    });
    // participant がイベント参加（即confirmed）
    await SELF.fetch(`${BASE}/api/events/${event.id}/join`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: participant.cookie },
      body: JSON.stringify({}),
    });

    // 無関係ユーザーは投稿できない
    const denied = await SELF.fetch(`${BASE}/api/venues/${venueId}/photos`, {
      method: "POST",
      headers: { "content-type": "image/png", cookie: outsider.cookie },
      body: png2,
    });
    expect(denied.status).toBe(403);

    // 参加者は投稿できる（審査待ち）→ 公開一覧には出ない
    const up1 = await SELF.fetch(`${BASE}/api/venues/${venueId}/photos`, {
      method: "POST",
      headers: { "content-type": "image/png", cookie: participant.cookie },
      body: png2,
    });
    expect(up1.status).toBe(201);
    const { photo: p1 } = (await up1.json()) as { photo: { id: string; status: string } };
    expect(p1.status).toBe("pending");

    const publicList = await SELF.fetch(`${BASE}/api/venues/${venueId}/photos`);
    const pl = (await publicList.json()) as {
      photos: { id: string }[];
      pending: unknown[];
      canSubmit: boolean;
    };
    expect(pl.photos.some((x) => x.id === p1.id)).toBe(false);
    expect(pl.pending.length).toBe(0); // 非オーナーには pending を返さない

    // オーナーには pending が見える → 承認 → 公開＋投稿者へ通知
    const ownerList = await SELF.fetch(`${BASE}/api/venues/${venueId}/photos`, {
      headers: { cookie: venueOwner.cookie },
    });
    const ol = (await ownerList.json()) as { pending: { id: string }[] };
    expect(ol.pending.some((x) => x.id === p1.id)).toBe(true);

    const approve = await SELF.fetch(
      `${BASE}/api/venues/${venueId}/photos/${p1.id}/moderate`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: venueOwner.cookie },
        body: JSON.stringify({ action: "approve" }),
      },
    );
    expect(approve.status).toBe(200);
    const afterApprove = await SELF.fetch(`${BASE}/api/venues/${venueId}/photos`);
    const aa = (await afterApprove.json()) as { photos: { id: string }[] };
    expect(aa.photos.some((x) => x.id === p1.id)).toBe(true);
    expect(await notifTypes(participant.cookie)).toContain("venue_photo_result");

    // 2枚目投稿 → 却下 → 一覧から消え通知が増える
    const up2 = await SELF.fetch(`${BASE}/api/venues/${venueId}/photos`, {
      method: "POST",
      headers: { "content-type": "image/png", cookie: participant.cookie },
      body: png2,
    });
    const { photo: p2 } = (await up2.json()) as { photo: { id: string } };
    const before = (await notifTypes(participant.cookie)).filter(
      (t) => t === "venue_photo_result",
    ).length;
    const reject = await SELF.fetch(
      `${BASE}/api/venues/${venueId}/photos/${p2.id}/moderate`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: venueOwner.cookie },
        body: JSON.stringify({ action: "reject" }),
      },
    );
    expect(reject.status).toBe(200);
    const img = await SELF.fetch(
      `${BASE}/api/venues/${venueId}/photos/${p2.id}/image`,
    );
    expect(img.status).toBe(404);
    const after = (await notifTypes(participant.cookie)).filter(
      (t) => t === "venue_photo_result",
    ).length;
    expect(after).toBe(before + 1);

    // 参加者は moderate できない
    const modDenied = await SELF.fetch(
      `${BASE}/api/venues/${venueId}/photos/${p1.id}/moderate`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: participant.cookie },
        body: JSON.stringify({ action: "approve" }),
      },
    );
    expect(modDenied.status).toBe(403);
  });
});
