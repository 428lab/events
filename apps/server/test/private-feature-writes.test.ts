import {SELF,env} from 'cloudflare:test';
import {expect,it} from 'vitest';
import {bindEnv} from '../src/runtime.js';
import {eventWrite} from '../src/db/repositories/eventWriteGuard.js';
const root='https://example.com',sql=(q:string,...v:unknown[])=>env.DB.prepare(q).bind(...v).run();
async function user(){const id=crypto.randomUUID(),sid=crypto.randomUUID();await sql('INSERT INTO user(id,discord_id,username,created_at) VALUES(?,?,?,1)',id,id,id);await sql('INSERT INTO session(id,user_id,expires_at) VALUES(?,?,?)',sid,id,Date.now()+86400000);return {id,cookie:`eventer_session=${sid}`};}
type Actor=Awaited<ReturnType<typeof user>>;
async function event(owner:Actor,visibility:string){const id=crypto.randomUUID(),slug=id.slice(0,8);await sql("INSERT INTO event(id,slug,title,created_by,created_at,starts_at,ends_at,venue_type,status,visibility) VALUES(?,?,'UNIQUE SECRET TITLE',?,1,?,?,'online','published',?)",id,slug,owner.id,Date.now()+60000,Date.now()+3600000,visibility);await sql("INSERT INTO event_member(id,event_id,user_id,role,status,created_at) VALUES(?,?,?,'staff','confirmed',1)",crypto.randomUUID(),id,owner.id);return {id,slug};}
async function grant(e:string,u:Actor){await sql("INSERT INTO event_access_invite(id,event_id,user_id,status,source,created_at) VALUES(?,?,?,'accepted','invite',1)",crypto.randomUUID(),e,u.id);}
const req=(p:string,u?:Actor,method='GET',body?:unknown)=>SELF.fetch(root+p,{method,headers:{...(u?{cookie:u.cookie}:{}),'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});

it('D1 assertion denial rolls back later writes and PNG triggers; unrelated SQL failures stay failures',async()=>{
 const owner=await user(),outsider=await user(),e=await event(owner,'private');bindEnv(env as never);
 const generation=await env.DB.prepare('SELECT card_image_generation g FROM user WHERE id=?').bind(owner.id).first();
 await expect(eventWrite({eventId:e.id,actorId:outsider.id,permission:'manager'},[{sql:"UPDATE event SET visibility='public' WHERE id=?",args:[e.id]}])).rejects.toMatchObject({status:409});
 expect((await env.DB.prepare('SELECT visibility FROM event WHERE id=?').bind(e.id).first())!.visibility).toBe('private');
 expect(await env.DB.prepare('SELECT card_image_generation g FROM user WHERE id=?').bind(owner.id).first()).toEqual(generation);
 await eventWrite({eventId:e.id,actorId:owner.id,permission:'manager'},[{sql:"UPDATE event SET title='Valid writer' WHERE id=?",args:[e.id]}]);
 expect((await env.DB.prepare('SELECT title FROM event WHERE id=?').bind(e.id).first())!.title).toBe('Valid writer');
 await expect(eventWrite({eventId:e.id,actorId:owner.id,permission:'manager'},[{sql:'INSERT INTO nonexistent_table VALUES(1)'}])).rejects.not.toMatchObject({status:409});
});

it('visibility CAS seeds only existing members, closes/rotates shared survey and clears grants on exit',async()=>{
 const owner=await user(),member=await user(),outsider=await user(),e=await event(owner,'public');bindEnv(env as never);
 const {eventsRepo}=await import('../src/db/repositories/events.js');
 await sql('UPDATE event SET nonpublic_eligible=1,chat_enabled=1 WHERE id=?',e.id);
 await sql("INSERT INTO event_member(id,event_id,user_id,role,status,created_at) VALUES(?,?,?,'participant','waitlist',1)",crypto.randomUUID(),e.id,member.id);
 const survey=crypto.randomUUID();await sql("INSERT INTO event_pre_survey(id,event_id,token,title,description,status,created_at) VALUES(?,?,'old-token','Form','','open',1)",survey,e.id);
 await sql("INSERT INTO event_access_invite(id,event_id,user_id,invited_by,status,source,created_at) VALUES(?,?,?,?,'accepted','invite',1)",crypto.randomUUID(),e.id,owner.id,outsider.id);
 const before=(await eventsRepo.findById(e.id))!;
 expect(await eventsRepo.update(e.id,{visibility:'private',confirmVisibilityChange:true,expectedAccessRevision:before.accessRevision+1},owner.id)).toBeNull();
 expect(await eventsRepo.update(e.id,{visibility:'private',confirmVisibilityChange:true,expectedAccessRevision:before.accessRevision},owner.id)).toMatchObject({visibility:'private',chatEnabled:false});
 expect((await req(`/api/events/${e.id}`,member)).status).toBe(200);expect((await req(`/api/events/${e.id}`,outsider)).status).toBe(404);
 const form=await env.DB.prepare('SELECT token,status FROM event_pre_survey WHERE id=?').bind(survey).first();expect(form!.status).toBe('closed');expect(form!.token).not.toBe('old-token');
 const count=await env.DB.prepare('SELECT count(*) n FROM event_access_invite WHERE event_id=?').bind(e.id).first();expect(count!.n).toBe(2);
 expect(await env.DB.prepare('SELECT invited_by,source FROM event_access_invite WHERE event_id=? AND user_id=?').bind(e.id,member.id).first()).toEqual({invited_by:owner.id,source:'existing_member'});
 expect(await env.DB.prepare('SELECT invited_by,source FROM event_access_invite WHERE event_id=? AND user_id=?').bind(e.id,owner.id).first()).toEqual({invited_by:outsider.id,source:'invite'});
 const current=(await eventsRepo.findById(e.id))!;expect(await eventsRepo.update(e.id,{visibility:'unlisted',confirmVisibilityChange:true,expectedAccessRevision:current.accessRevision},owner.id)).not.toBeNull();
 expect((await env.DB.prepare('SELECT count(*) n FROM event_access_invite WHERE event_id=?').bind(e.id).first())!.n).toBe(0);
 expect((await env.DB.prepare('SELECT status FROM event_member WHERE event_id=? AND user_id=?').bind(e.id,member.id).first())!.status).toBe('waitlist');
 expect((await env.DB.prepare('SELECT status FROM event_pre_survey WHERE id=?').bind(survey).first())!.status).toBe('closed');
});
it('failed visibility side effect rolls back visibility, grants, revision and PNG generations',async()=>{
 const owner=await user(),e=await event(owner,'public');bindEnv(env as never);const {eventsRepo}=await import('../src/db/repositories/events.js');
 await sql('UPDATE event SET nonpublic_eligible=1 WHERE id=?',e.id);await sql("INSERT INTO event_pre_survey(id,event_id,token,title,description,status,created_at) VALUES(?,?,'old','Form','','open',1)",crypto.randomUUID(),e.id);
 const before=(await eventsRepo.findById(e.id))!,g=await env.DB.prepare('SELECT card_image_generation g FROM user WHERE id=?').bind(owner.id).first();
 await sql("CREATE TRIGGER fail_private_survey BEFORE UPDATE ON event_pre_survey BEGIN SELECT RAISE(ABORT,'fixture_visibility_rollback'); END");
 await expect(eventsRepo.update(e.id,{visibility:'private',confirmVisibilityChange:true,expectedAccessRevision:before.accessRevision},owner.id)).rejects.toThrow();
 expect(await eventsRepo.findById(e.id)).toMatchObject({visibility:'public',accessRevision:before.accessRevision});
 expect(await env.DB.prepare('SELECT card_image_generation g FROM user WHERE id=?').bind(owner.id).first()).toEqual(g);
 expect((await env.DB.prepare('SELECT count(*) n FROM event_access_invite WHERE event_id=?').bind(e.id).first())!.n).toBe(0);
});

it.each(['public','private'])('scoring keeps participant/judge/staff non-canceled roles and target restrictions (%s)',async visibility=>{
 const host=await user(),participant=await user(),outsider=await user(),e=await event(host,visibility);
 await sql("INSERT INTO event_member(id,event_id,user_id,role,status,created_at) VALUES(?,?,?,'participant','confirmed',1)",crypto.randomUUID(),e.id,participant.id);
 if(visibility==='private')await grant(e.id,participant);
 const entry=crypto.randomUUID(),criterion=crypto.randomUUID();
 await sql("INSERT INTO entry(id,event_id,name,created_at) VALUES(?,?,'Other entry',1)",entry,e.id);
 await sql("INSERT INTO scoring_criterion(id,event_id,name) VALUES(?,?,'Quality')",criterion,e.id);
 const score={entryId:entry,criterionId:criterion,value:3},path=`/api/events/${e.id}/scores`;
 for(const role of ['participant','judge','staff'])for(const status of ['confirmed','pending','waitlist']){
  await sql('UPDATE event_member SET role=?,status=? WHERE event_id=? AND user_id=?',role,status,e.id,participant.id);
  expect((await req(path,participant,'PUT',score)).status).toBe(200);
 }
 expect((await env.DB.prepare('SELECT value FROM score WHERE event_id=? AND judge_user_id=?').bind(e.id,participant.id).first())!.value).toBe(3);
 for(const [role,status] of [['observer','confirmed'],['participant','canceled']]){
  await sql('UPDATE event_member SET role=?,status=? WHERE event_id=? AND user_id=?',role,status,e.id,participant.id);
  expect((await req(path,participant,'PUT',{...score,value:1})).status).toBe(403);
 }
 await sql("UPDATE event_member SET role='participant',status='confirmed' WHERE event_id=? AND user_id=?",e.id,participant.id);
 expect((await req(path,outsider,'PUT',score)).status).toBe(visibility==='private'?404:403);
 const other=await event(host,visibility),otherEntry=crypto.randomUUID(),otherCriterion=crypto.randomUUID();
 await sql("INSERT INTO entry(id,event_id,name,created_at) VALUES(?,?,'Foreign entry',1)",otherEntry,other.id);
 await sql("INSERT INTO scoring_criterion(id,event_id,name) VALUES(?,?,'Foreign criterion')",otherCriterion,other.id);
 expect((await req(path,participant,'PUT',{...score,entryId:otherEntry})).status).toBe(404);
 expect((await req(path,participant,'PUT',{...score,criterionId:otherCriterion})).status).toBe(404);
 await sql('INSERT INTO entry_member(id,entry_id,user_id) VALUES(?,?,?)',crypto.randomUUID(),entry,participant.id);
 expect((await req(path,participant,'PUT',score)).status).toBe(403);
 await sql('DELETE FROM entry_member WHERE entry_id=?',entry);
 await sql('UPDATE event_state SET scoring_locked=1 WHERE event_id=?',e.id);
 expect((await req(path,participant,'PUT',score)).status).toBe(409);
 await sql('UPDATE event_state SET scoring_locked=0 WHERE event_id=?',e.id);
 if(visibility==='private'){
  await sql("UPDATE event_access_invite SET status='revoked' WHERE event_id=? AND user_id=?",e.id,participant.id);
  expect((await req(path,participant,'PUT',{...score,value:1})).status).toBe(404);
 }
 expect((await env.DB.prepare('SELECT value FROM score WHERE event_id=? AND judge_user_id=?').bind(e.id,participant.id).first())!.value).toBe(3);
});
