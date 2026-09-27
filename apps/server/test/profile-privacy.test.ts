import { SELF, env } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../src/types.js";
import { bindEnv } from "../src/runtime.js";
import { usersRepo } from "../src/db/repositories/users.js";
import { accountMergeRepo } from "../src/db/repositories/accountMerge.js";
import { gamificationRepo } from "../src/db/repositories/gamification.js";
import { publicRoutes } from "../src/routes/public.js";
import { getUserCardImage, putMyCardImage } from "../src/routes/profileCardImages.js";
const base="https://example.com/api", png=new Uint8Array([137,80,78,71,1]);
const sql=(q:string,...args:unknown[])=>env.DB.prepare(q).bind(...args).run();
async function user() {
  bindEnv(env as never);
  const id=crypto.randomUUID();
  const u=await usersRepo.createFromProfile("google",{providerUserId:id,username:`p_${id.slice(0,8)}`,globalName:null,avatarUrl:null});
  const sid=crypto.randomUUID();
  await sql("INSERT INTO session(id,user_id,expires_at) VALUES(?,?,?)",sid,u.id,Date.now()+86400000);
  return {...u,cookie:`eventer_session=${sid}`};
}
const generation=async(id:string)=>(await usersRepo.findById(id))!.cardImageGeneration!;
async function event(owner:string,visibility="public") {
  const id=crypto.randomUUID();
  await sql("INSERT INTO event(id,title,created_by,created_at,starts_at,ends_at,venue_type,status,visibility,photos_public) VALUES(?, ?,?,1,1,2,'online','published',?,1)",id,visibility+" title",owner,visibility);
  return id;
}
const member=(e:string,u:string)=>sql("INSERT INTO event_member(id,event_id,user_id,role,status,created_at) VALUES(?,?,?,'participant','confirmed',1)",crypto.randomUUID(),e,u);
const upload=(u:Awaited<ReturnType<typeof user>>,g:string,k="rosette-indigo")=>SELF.fetch(`${base}/me/card-image?k=${k}&g=${g}`,{method:"PUT",headers:{cookie:u.cookie,"content-type":"image/png"},body:png});
const image=async(u:string,g?:string,k="rosette-indigo")=>{
  const r=await SELF.fetch(`${base}/users/${u}/card-image?k=${k}${g?`&g=${g}`:""}`);
  const bytes=await r.arrayBuffer(); return new Response(bytes,{status:r.status,headers:r.headers});
};
afterEach(()=>vi.restoreAllMocks());

it("actual new user gets generation; old B and legacy cannot return after new A; unrelated user is untouched",async()=>{
  const u=await user(),other=await user(),e=await event(u.id); await member(e,u.id);
  const g=await generation(u.id),untouched=await generation(other.id); expect(g).toMatch(/^[a-f0-9]{32}$/);
  expect((await upload(u,g)).status).toBe(200); expect((await upload(u,g,"arcs-rose")).status).toBe(200);
  await env.BUCKET.put(`profile-cards/${u.id}/arcs-rose.png`,png); await env.BUCKET.put(`profile-cards/${u.id}.png`,png);
  await sql("UPDATE event SET visibility='private' WHERE id=?",e);
  const next=await generation(u.id); expect(next).not.toBe(g); expect(await generation(other.id)).toBe(untouched);
  expect((await image(u.id)).status).toBe(404); expect((await upload(u,g)).status).toBe(409);
  expect((await upload(u,next)).status).toBe(200);
  expect((await image(u.id,g)).status).toBe(404); expect((await image(u.id,undefined,"arcs-rose")).status).toBe(404);
  const a=await image(u.id,next); expect(a.status).toBe(200); expect(a.headers.get("cache-control")).toContain("no-store");
  expect((await upload(u,next,"arcs-rose")).status).toBe(200); expect((await image(u.id,undefined,"arcs-rose")).status).toBe(200);
});

it("PUT CAS rejects a generation changed during R2 put; GET rechecks even before 304",async()=>{
  const u=await user(),e=await event(u.id);await member(e,u.id);const g=await generation(u.id);
  const app=new Hono<AppEnv>();app.use("*",async(c,next)=>{c.set("user",u);await next();});
  app.put("/me/card-image",putMyCardImage);app.get("/users/:id/card-image",getUserCardImage);
  const originalPut=env.BUCKET.put.bind(env.BUCKET);
  vi.spyOn(env.BUCKET,"put").mockImplementationOnce(async(...args:Parameters<typeof env.BUCKET.put>)=>{
    const obj=await originalPut(...args);await sql("UPDATE event SET visibility='unlisted' WHERE id=?",e);return obj;
  });
  const stale=await app.request(`/me/card-image?k=rosette-indigo&g=${g}`,{method:"PUT",headers:{"content-type":"image/png"},body:png});expect(stale.status).toBe(409);
  expect(await env.BUCKET.get(`profile-cards/${u.id}/generations/${g}/rosette-indigo.png`)).toBeNull();
  const next=await generation(u.id);expect((await upload(u,next)).status).toBe(200);
  const originalGet=env.BUCKET.get.bind(env.BUCKET);
  vi.spyOn(env.BUCKET,"get").mockImplementationOnce(async(...args:Parameters<typeof env.BUCKET.get>)=>{
    const obj=await originalGet(...args);await sql("UPDATE event SET visibility='private' WHERE id=?",e);return obj;
  });
  const r=await app.request(`/users/${u.id}/card-image?g=${next}`,{headers:{"if-none-match":`"${next}:rosette-indigo:${(await usersRepo.findById(u.id))!.cardImageUpdatedAt}"`}});expect(r.status).toBe(404);
});

it("snapshot crossing a contributor change is rejected instead of relabeled",async()=>{
  const u=await user(),e=await event(u.id);await member(e,u.id);
  const original=gamificationRepo.statsForUser.bind(gamificationRepo);
  vi.spyOn(gamificationRepo,"statsForUser").mockImplementationOnce(async(...args)=>{
    const result=await original(...args);await sql("UPDATE event SET visibility='private' WHERE id=?",e);return result;
  });
  const r=await publicRoutes.request(`/users/${u.username}`);expect(r.status).toBe(409);expect(await r.json()).toEqual({error:"card_generation_changed"});
});

it("before relation removal captures former member, speaker, like target and both meet users; rollback preserves generations",async()=>{
  const owner=await user(),e=await event(owner.id),unrelated=await user(),old=await generation(unrelated.id);
  const targets=await Promise.all([user(),user(),user(),user(),user()]);
  await member(e,targets[0].id);
  await sql("INSERT INTO event_schedule_item(id,event_id,title,speaker_user_id,sort_order,created_at) VALUES('speaker',?,'talk',?,0,1)",e,targets[1].id);
  await sql("INSERT INTO event_like(id,event_id,user_id,kind,target_key,created_at) VALUES('like',?,?,'host',?,1)",e,owner.id,targets[2].id);
  await sql("INSERT INTO event_meet(id,event_id,user_low,user_high,created_at) VALUES('meet',?,?,?,1)",e,targets[3].id,targets[4].id);
  const before=await Promise.all(targets.map(t=>generation(t.id)));
  await expect(env.DB.batch([env.DB.prepare("DELETE FROM event_member WHERE event_id=?").bind(e),env.DB.prepare("INSERT INTO event_member(id,event_id,user_id,role,status,created_at) VALUES('bad','missing','missing','participant','confirmed',1)")])).rejects.toThrow();
  expect(await Promise.all(targets.map(t=>generation(t.id)))).toEqual(before);
  await sql("DELETE FROM event_member WHERE event_id=?",e);expect(await generation(targets[0].id)).not.toBe(before[0]);
  for(const [table,id,index] of [["event_schedule_item","speaker",1],["event_like","like",2],["event_meet","meet",3]] as const){
    const g=await generation(targets[index].id),other=await generation(targets[4].id);await sql(`DELETE FROM ${table} WHERE id=?`,id);
    expect(await generation(targets[index].id)).not.toBe(g);if(table==='event_meet')expect(await generation(targets[4].id)).not.toBe(other);
  }
  expect(await generation(unrelated.id)).toBe(old);
});

it("user deletion captures sender contributions, FK cascade and merge never inherit loser PNG",async()=>{
  const owner=await user(),e=await event(owner.id),sender=await user(),target=await user(),other=await user();
  await sql("INSERT INTO event_like(id,event_id,user_id,kind,target_key,created_at) VALUES('received',?,?,'staff',?,1)",e,sender.id,target.id);
  const g=await generation(target.id),untouched=await generation(other.id);
  await sql("UPDATE user SET deleted_at=1 WHERE id=?",sender.id);expect(await generation(target.id)).not.toBe(g);
  const g2=await generation(target.id);await sql("DELETE FROM user WHERE id=?",sender.id);expect(await generation(target.id)).not.toBe(g2);
  await member(e,target.id);const prev=await generation(target.id);await sql("DELETE FROM event WHERE id=?",e);expect(await generation(target.id)).not.toBe(prev);
  const loser=await user(),winGen=await generation(target.id);expect((await upload(loser,await generation(loser.id))).status).toBe(200);
  await accountMergeRepo.mergeUsers(target.id,loser.id);expect(await generation(target.id)).not.toBe(winGen);expect((await image(target.id)).status).toBe(404);
  expect(await generation(other.id)).toBe(untouched);
});

it("private/unlisted profile activity, XP, likes, photos, facets and request counts are absent before limit",async()=>{
  const u=await user(),peer=await user(),pub=await event(u.id),hidden=await event(u.id,'private'),unlisted=await event(u.id,'unlisted');
  for(const e of [pub,hidden,unlisted]){
    await member(e,u.id);await member(e,peer.id);await member(e,(await user()).id);await member(e,(await user()).id);
    await sql("INSERT INTO event_like(id,event_id,user_id,kind,target_key,created_at) VALUES(?,?,?,'participant',?,1)",crypto.randomUUID(),e,peer.id,u.id);
    await sql("INSERT INTO event_meet(id,event_id,user_low,user_high,created_at) VALUES(?,?,?,?,1)",crypto.randomUUID(),e,u.id,peer.id);
    await sql("INSERT INTO event_photo(id,event_id,user_id,created_at) VALUES(?,?,?,?)",crypto.randomUUID(),e,u.id,e===pub?1:100);
  }
  const profile=await (await SELF.fetch(`${base}/public/users/${u.username}`,{headers:{cookie:u.cookie}})).json() as any;
  expect(profile.events.map((e:any)=>e.id)).toEqual([pub]);expect(profile.participation.attended).toBe(1);expect(profile.participation.likesReceived).toBe(1);
  expect(await gamificationRepo.statsForUser(u.id,Date.now())).toMatchObject({ attendedQualifying:1, likesReceivedQualifying:1, meets:1 });expect(profile.meetTotal).toBe(1);expect(profile.eventPhotos).toHaveLength(1);
  const page=await (await SELF.fetch(`${base}/public/users/${u.username}/photos?limit=1`)).json() as any;
  expect(page.total).toBe(1);expect(page.hasMore).toBe(false);expect(page.photos[0].eventId).toBe(pub);expect(JSON.stringify(page.facets)).not.toContain(hidden);
  await sql("INSERT INTO event_request(id,title,created_by,created_at) VALUES('request','egg',?,1)",u.id);
  for(const e of [pub,hidden,unlisted])await sql("INSERT INTO event_request_event(request_id,event_id,created_at) VALUES('request',?,1)",e);
  const {eventRequestsRepo}=await import('../src/db/repositories/eventRequests.js');expect((await eventRequestsRepo.findById('request'))!.eventCount).toBe(1);expect(await eventRequestsRepo.linkedEventIds('request')).toEqual([pub]);
});

it("community identities stay public-only while aggregate membership includes private participants",async()=>{
  const owner=await user(),u=await user(),e=await event(owner.id,'private');await member(e,u.id);
  await sql("INSERT INTO community(id,slug,name,owner_id,created_at) VALUES('group','group','Group',?,1)",owner.id);
  await sql("UPDATE event SET community_id='group' WHERE id=?",e);
  const {communitiesRepo}=await import('../src/db/repositories/communities.js');
  expect(await communitiesRepo.listForUser(u.id)).toEqual([]);expect(await communitiesRepo.listMembers('group')).toEqual([]);
  expect(await communitiesRepo.findBySlug('group')).toMatchObject({memberCount:1,eventCount:0});
  await sql("INSERT INTO community_member(id,community_id,user_id,role,created_at) VALUES('cm','group',?,'member',1)",u.id);
  expect((await communitiesRepo.listForUser(u.id))[0]!.myEventCount).toBe(0);
  await sql("UPDATE event SET visibility='public' WHERE id=?",e);
  expect((await communitiesRepo.listForUser(u.id))[0]!.myEventCount).toBe(1);
  expect((await communitiesRepo.listMembers('group')).map(m=>m.userId)).toEqual([u.id]);
});

it("speaker replacement and track visibility invalidate old and new contributors",async()=>{
  const owner=await user(),a=await user(),b=await user(),e=await event(owner.id);
  await sql("INSERT INTO event_schedule_item(id,event_id,title,speaker_user_id,sort_order,created_at,placement) VALUES('talk',?,'Talk',?,0,1,'tracks')",e,a.id);
  await sql("INSERT INTO event_track(id,event_id,name,sort_order,created_at) VALUES('track',?,'Track',0,1)",e);
  await sql("INSERT INTO event_schedule_item_track(item_id,track_id) VALUES('talk','track')");
  const ga=await generation(a.id),gb=await generation(b.id);
  await sql("UPDATE event_schedule_item SET speaker_user_id=? WHERE id='talk'",b.id);
  expect(await generation(a.id)).not.toBe(ga);expect(await generation(b.id)).not.toBe(gb);
  const old=await generation(b.id);await sql("UPDATE event_track SET visibility='staff' WHERE id='track'");expect(await generation(b.id)).not.toBe(old);
});

it("public awards and speaking preserve public contributions, and failed visibility CAS does not rotate",async()=>{
  const u=await user(),pub=await event(u.id),hidden=await event(u.id,'private');
  for(const e of [pub,hidden]){
    await sql("INSERT INTO event_schedule_item(id,event_id,title,speaker_user_id,sort_order,created_at) VALUES(?,?,'talk',?,0,1)",e,e,u.id);
    await sql("INSERT INTO entry(id,event_id,name,created_at) VALUES(?,?,'entry',1)",e,e);
    await sql("INSERT INTO entry_member(id,entry_id,user_id) VALUES(?,?,?)",e,e,u.id);
    await sql("INSERT INTO award_rank(id,event_id,name,created_at) VALUES(?,?,'winner',1)",e,e);
    await sql("INSERT INTO award_result(id,event_id,entry_id,award_rank_id) VALUES(?,?,?,?)",e,e,e,e);
  }
  const p=await(await SELF.fetch(`${base}/public/users/${u.username}`)).json() as any;
  expect(p.awards.map((a:any)=>a.eventId)).toEqual([pub]);expect(p.speakerEventIds).toEqual([pub]);expect(p.participation.spoken).toBe(1);
  const g=await generation(u.id);
  await sql("UPDATE event SET visibility='private' WHERE id=? AND access_revision=-1",pub);expect(await generation(u.id)).toBe(g);
});

it("generation is mandatory and validated; HEAD and conditional GET remain no-store",async()=>{
  const u=await user(),g=await generation(u.id);
  for(const [suffix,error] of [["","generation_required"],["&g=","invalid_generation"],["&g=bad","invalid_generation"]]){
    const r=await SELF.fetch(`${base}/me/card-image?k=rosette-indigo${suffix}`,{method:"PUT",headers:{cookie:u.cookie,"content-type":"image/png"},body:png});
    expect(r.status).toBe(400);expect(await r.json()).toEqual({error});expect(r.headers.get('cache-control')).toContain('no-store');
  }
  expect((await upload(u,g)).status).toBe(200);const current=await image(u.id,g);
  const url=`${base}/users/${u.id}/card-image?g=${g}`;
  const head=await SELF.fetch(url,{method:'HEAD'});expect(head.status).toBe(200);expect((await head.arrayBuffer()).byteLength).toBe(0);
  const conditional=await SELF.fetch(url,{headers:{'if-none-match':current.headers.get('etag')!}});expect(conditional.status).toBe(304);expect(conditional.headers.get('cache-control')).toContain('no-store');
});

it("unchanged event and timetable saves preserve contributor generations and in-flight snapshots",async()=>{
  const u=await user(),e=await event(u.id);await member(e,u.id);
  await sql("INSERT INTO event_schedule_item(id,event_id,title,speaker_user_id,sort_order,created_at,placement) VALUES('unchanged',?,'Talk',?,0,1,'tracks')",e,u.id);
  await sql("INSERT INTO event_track(id,event_id,name,sort_order,created_at) VALUES('unchanged-track',?,'Track',0,1)",e);
  await sql("INSERT INTO event_schedule_item_track(item_id,track_id) VALUES('unchanged','unchanged-track')");
  await sql("UPDATE event_member SET role='staff' WHERE event_id=? AND user_id=?",e,u.id);
  const g=await generation(u.id);
  await sql("UPDATE event SET title='renamed',status=status,starts_at=starts_at,ends_at=ends_at,community_id=community_id,attendance_check=attendance_check WHERE id=?",e);
  expect(await generation(u.id)).toBe(g);
  const {eventScheduleRepo}=await import('../src/db/repositories/eventSchedule.js');
  const current=await eventScheduleRepo.listByEvent(e,'staff');
  const tracks=await eventScheduleRepo.listTracks(e,'staff');
  await eventScheduleRepo.saveAll(e,current.map(i=>({...i,trackIndexes:[0]})),tracks,{eventId:e,actorId:u.id,permission:"manager"});
  expect(await generation(u.id)).toBe(g); // updated_at is NULL: a render can still be pending
  await sql("UPDATE event_schedule_item SET speaker_user_id=NULL WHERE id='unchanged'");
  expect(await generation(u.id)).not.toBe(g);
});
