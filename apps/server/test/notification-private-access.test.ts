import { SELF,env } from 'cloudflare:test';
import { afterEach,expect,it,vi } from 'vitest';
import { bindEnv } from '../src/runtime.js';
import { notificationsRepo } from '../src/db/repositories/notifications.js';
import { emailRepo } from '../src/db/repositories/email.js';
import { eventBroadcastsRepo } from '../src/db/repositories/eventBroadcasts.js';
import { drainBroadcastEmails } from '../src/lib/broadcast.js';
import { sendNotificationEmailToWithOutcome } from '../src/lib/email.js';
const root='https://example.com',sql=(q:string,...v:unknown[])=>env.DB.prepare(q).bind(...v).run();
async function user(){const id=crypto.randomUUID(),sid=crypto.randomUUID();await sql('INSERT INTO user(id,discord_id,username,created_at) VALUES(?,?,?,1)',id,id,id);await sql('INSERT INTO session(id,user_id,expires_at) VALUES(?,?,?)',sid,id,Date.now()+86400000);return {id,cookie:`eventer_session=${sid}`};}
type Actor=Awaited<ReturnType<typeof user>>;
async function event(owner:Actor,visibility:string){const id=crypto.randomUUID(),slug=id.slice(0,8);await sql("INSERT INTO event(id,slug,title,created_by,created_at,starts_at,ends_at,venue_type,status,visibility) VALUES(?,?,'UNIQUE SECRET TITLE',?,1,?,?,'online','published',?)",id,slug,owner.id,Date.now()+60000,Date.now()+3600000,visibility);await sql("INSERT INTO event_member(id,event_id,user_id,role,status,created_at) VALUES(?,?,?,'staff','confirmed',1)",crypto.randomUUID(),id,owner.id);return {id,slug};}
async function grant(e:string,u:Actor){await sql("INSERT INTO event_access_invite(id,event_id,user_id,status,source,created_at) VALUES(?,?,?,'accepted','invite',1)",crypto.randomUUID(),e,u.id);}
const req=(p:string,u?:Actor,method='GET',body?:unknown)=>SELF.fetch(root+p,{method,headers:{...(u?{cookie:u.cookie}:{}),'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
const bind=()=>bindEnv({...env,RESEND_API_KEY:'test'} as never);
async function mail(u:Actor){await sql("INSERT INTO identity(id,user_id,provider,provider_user_id,email,created_at) VALUES(?,?,'google',?,'test@example.com',1)",crypto.randomUUID(),u.id,u.id);await sql("INSERT INTO notification_pref(user_id,email_enabled,updated_at) VALUES(?,1,1)",u.id);}
it('private notices are generic; list/count/unread reauthorize and unrelated legacy is unchanged',async()=>{
 const host=await user(),u=await user(),e=await event(host,'private');await grant(e.id,u);bind();
 await notificationsRepo.create(u.id,'award','SECRET TITLE','SECRET BODY',`/events/${e.id}?sensitive=yes`);
 await notificationsRepo.create(u.id,'info','Unrelated legacy','Keep body','/venues/other');
 let list=await notificationsRepo.listByUser(u.id);expect(JSON.stringify(list)).not.toMatch(/SECRET|sensitive/);expect(list).toHaveLength(2);expect(await notificationsRepo.unreadCount(u.id)).toBe(2);
 await sql("UPDATE event_access_invite SET status='revoked' WHERE event_id=?",e.id);
 expect(await notificationsRepo.countByUser(u.id)).toBe(1);expect(await notificationsRepo.unreadCount(u.id)).toBe(1);expect((await notificationsRepo.listByUser(u.id))[0]).toMatchObject({title:'Unrelated legacy',body:'Keep body'});
 expect((await env.DB.prepare('SELECT count(*) n FROM notification WHERE user_id=?').bind(u.id).first())!.n).toBe(2);
});
it('follower/request fanout inserts zero nonpublic rows; public positive remains',async()=>{
 const host=await user(),u=await user(),e=await event(host,'unlisted');bind();
 for(const type of ['followee_created_event','followee_joined_event','request_event_created'] as const)await notificationsRepo.create(u.id,type,'SECRET','BODY',`/events/${e.id}`,undefined,{actorId:host.id});
 expect(await notificationsRepo.countByUser(u.id)).toBe(0);
 await sql("UPDATE event SET visibility='public' WHERE id=?",e.id);await notificationsRepo.create(u.id,'followee_created_event','Public positive','Public body',`/events/${e.id}`,undefined,{actorId:host.id});expect((await notificationsRepo.listByUser(u.id))[0]!.title).toBe('Public positive');
});
it.each(['recipient','actor'])('queued broadcast rechecks %s after claim and before delivery',async who=>{
 const host=await user(),u=await user(),e=await event(host,'private');await grant(e.id,u);await mail(u);bind();
 const id=await eventBroadcastsRepo.create({eventId:e.id,createdBy:host.id,segment:'confirmed',title:'SECRET',body:'SECRET BODY',recipientCount:1});await eventBroadcastsRepo.queueEmails(id,[u.id]);
 let release!:()=>void,entered!:()=>void;const paused=new Promise<void>(r=>entered=r),hold=new Promise<void>(r=>release=r);
 const original=emailRepo.findRecipient.bind(emailRepo);vi.spyOn(emailRepo,'findRecipient').mockImplementationOnce(async id=>{entered();await hold;return original(id);});
 const send=vi.fn().mockResolvedValue(new Response('{}'));vi.stubGlobal('fetch',send);const pending=drainBroadcastEmails();await paused;
 if(who==='recipient')await sql("UPDATE event_access_invite SET status='revoked' WHERE event_id=?",e.id);else await sql("UPDATE event_member SET role='participant' WHERE event_id=? AND user_id=?",e.id,host.id);
 release();expect(await pending).toMatchObject({claimed:1,skipped:1,sent:0});expect(send).not.toHaveBeenCalled();
});
it('private delivery has no title/body/card/venue or query link; public mail retains detail',async()=>{
 const host=await user(),u=await user(),e=await event(host,'private');await grant(e.id,u);await mail(u);bind();const send=vi.fn().mockResolvedValue(new Response('{}'));vi.stubGlobal('fetch',send);
 expect((await sendNotificationEmailToWithOutcome(u.id,'test@example.com','SECRET TITLE','SECRET BODY',`/events/${e.id}?secret=token`)).ok).toBe(true);
 expect(send.mock.calls[0]![1].body).not.toMatch(/SECRET|secret=token|UNIQUE/);
 await sql("UPDATE event SET visibility='public' WHERE id=?",e.id);await sendNotificationEmailToWithOutcome(u.id,'test@example.com','Public positive','Body',`/events/${e.id}`);expect(send.mock.calls[1]![1].body).toContain('Public positive');
});
it('nonpublic participant key/config/post paths blocked but encrypted staff endpoint preserved',async()=>{
 const host=await user(),e=await event(host,'unlisted');
 for(const [path,method] of [['chat-members','GET'],['chat-key/ephemeral','GET'],['chat-key/ephemeral','POST'],['chat-channel/create','POST'],['chat-channel','POST'],['chat-hidden','POST']])expect((await req(`/api/events/${e.id}/${path}`,host,method,method==='POST'?{}:undefined)).status).toBe(403);
 const staff=await req(`/api/events/${e.id}/staff-chat`,host,"POST",{});expect(staff.status).toBe(200);
 await sql("UPDATE event SET visibility='public' WHERE id=?",e.id);expect((await req(`/api/events/${e.id}/chat-members`,host)).status).toBe(200);
});

it('migration eligibility cannot be forged; legacy editing and new copy remain public',async()=>{
 const host=await user(),old=await event(host,'public');
 const locked=await req(`/api/events/${old.id}`,host,'PATCH',{visibility:'private',nonpublicEligible:true});expect(locked.status).toBe(409);expect(await locked.json()).toEqual({error:'legacy_visibility_locked'});
 expect((await req(`/api/events/${old.id}`,host,'PATCH',{title:'Ordinary edit',nonpublicEligible:true})).status).toBe(200);
 expect((await env.DB.prepare('SELECT nonpublic_eligible n FROM event WHERE id=?').bind(old.id).first())!.n).toBe(0);
 const created=await req('/api/events',host,'POST',{title:'New public',venueType:'online',startsAt:Date.now()+60000,endsAt:Date.now()+3600000,nonpublicEligible:false});expect(created.status).toBe(201);const fresh=(await created.json() as any).event;
 expect((await env.DB.prepare('SELECT nonpublic_eligible n FROM event WHERE id=?').bind(fresh.id).first())!.n).toBe(1);
 expect(await(await req(`/api/events/${fresh.id}`,host,'PATCH',{visibility:'private'})).json()).toEqual({error:'private_events_unavailable'});
 const copy=await req(`/api/events/${old.id}/duplicate`,host,'POST',{});expect(copy.status).toBe(201);const copied=(await copy.json() as any).event;
 expect((await env.DB.prepare('SELECT nonpublic_eligible n FROM event WHERE id=?').bind(copied.id).first())!.n).toBe(1);
});
