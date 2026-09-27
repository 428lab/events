import { SELF,env } from 'cloudflare:test';
import { afterEach,expect,it,vi } from 'vitest';
import { bindEnv } from '../src/runtime.js';
import { meetScanRoutes } from '../src/routes/eventMeets.js';
import { eventMeetsRepo } from '../src/db/repositories/eventMeets.js';
import { notificationsRepo } from '../src/db/repositories/notifications.js';
import { verifyUndoToken } from '../src/lib/meetToken.js';
const sql=(q:string,...v:unknown[])=>env.DB.prepare(q).bind(...v).run();
async function user(){const id=crypto.randomUUID(),sid=crypto.randomUUID();await sql('INSERT INTO user(id,discord_id,username,created_at) VALUES(?,?,?,1)',id,id,id);await sql('INSERT INTO session(id,user_id,expires_at) VALUES(?,?,?)',sid,id,Date.now()+86400000);return {id,cookie:`eventer_session=${sid}`};}
type Actor=Awaited<ReturnType<typeof user>>;
async function event(a:Actor,b:Actor,visibility='private'){
 const id=crypto.randomUUID(),now=Date.now();
 await sql("INSERT INTO event(id,title,created_by,created_at,starts_at,ends_at,venue_type,status,visibility,attendance_check) VALUES(?,'CONFIDENTIAL',?,1,?,?,'online','published',?,1)",id,a.id,now-3600000,now-1,visibility);
 for(const u of [a,b]){
  await sql("INSERT INTO event_member(id,event_id,user_id,role,status,created_at) VALUES(?,?,?,'participant','confirmed',1)",crypto.randomUUID(),id,u.id);
  await sql("INSERT INTO event_access_invite(id,event_id,user_id,status,source,created_at) VALUES(?,?,?,'accepted','invite',1)",crypto.randomUUID(),id,u.id);
 }
 return id;
}
async function token(u:Actor){const r=await SELF.fetch('https://example.com/api/meet/token',{headers:{cookie:u.cookie}});expect(r.status).toBe(200);bindEnv(env as never);return (await r.json() as {token:string}).token;}
const request=(path:string,u:Actor,body:unknown)=>meetScanRoutes.request(path,{method:'POST',headers:{cookie:u.cookie,'content-type':'application/json'},body:JSON.stringify(body)});
const revoke=(e:string,u:Actor)=>sql("UPDATE event_access_invite SET status='revoked' WHERE event_id=? AND user_id=?",e,u.id);
const count=async(table:string,e:string)=>(await env.DB.prepare(`SELECT COUNT(*) n FROM ${table} WHERE event_id=?`).bind(e).first<{n:number}>())!.n;
afterEach(()=>vi.restoreAllMocks());
it.each(['scanner','target'])('late %s revocation after selection yields no event/result/notice and preserves QR',async side=>{
 const a=await user(),b=await user(),e=await event(a,b),qr=await token(b);
 const original=eventMeetsRepo.meetablePairsBetween.bind(eventMeetsRepo);
 vi.spyOn(eventMeetsRepo,'meetablePairsBetween').mockImplementationOnce(async(...args)=>{const rows=await original(...args);expect(rows).toHaveLength(1);await revoke(e,side==='scanner'?a:b);return rows;});
 const r=await request('/scan',a,{token:qr});expect(r.status).toBe(409);expect(await r.json()).toEqual({error:'no_shared_event'});
 expect(await count('event_meet',e)).toBe(0);expect(await count('notification',e)).toBe(0);
 await sql("UPDATE event_access_invite SET status='accepted' WHERE event_id=?",e);
 expect((await request('/scan',a,{token:qr})).status).toBe(200);
});
it('mixed shared events exclude revoked private event from results and signed undo grants',async()=>{
 const a=await user(),b=await user(),hidden=await event(a,b),pub=await event(a,b,'public'),qr=await token(b);
 await revoke(hidden,b);
 const r=await request('/scan',a,{token:qr});expect(r.status).toBe(200);const body=await r.json() as any;
 expect(body.events.map((e:any)=>e.eventId)).toEqual([pub]);
 const signed=await verifyUndoToken(body.undoToken);expect(signed.ok).toBe(true);if(signed.ok)expect(signed.payload.grants.map(g=>g.eventId)).toEqual([pub]);
 expect(await count('event_meet',hidden)).toBe(0);
});
it('post-write revocation hides response/undo and actor-linked notification without undoing committed history',async()=>{
 const a=await user(),b=await user(),e=await event(a,b),qr=await token(b);
 vi.spyOn(notificationsRepo,'deliverMeetNotifications').mockImplementationOnce(async()=>{await revoke(e,a);});
 const r=await request('/scan',a,{token:qr});expect(r.status).toBe(409);expect(await r.json()).toEqual({error:'no_shared_event'});
 expect(await count('event_meet',e)).toBe(1);expect(await count('notification',e)).toBe(1);
 expect(await notificationsRepo.listByUser(b.id)).toEqual([]);expect(await notificationsRepo.countByUser(b.id)).toBe(0);expect(await notificationsRepo.unreadCount(b.id)).toBe(0);
 expect(await (await request('/scan',a,{token:qr})).json()).toEqual({error:'used'});
});
it('undo requalifies both users and only removes notices/history for still-visible changed events',async()=>{
 const a=await user(),b=await user(),hidden=await event(a,b),pub=await event(a,b,'public'),qr=await token(b);
 await sql("UPDATE event_member SET role='staff' WHERE event_id=? AND user_id=?",pub,a.id);
 const scan=await request('/scan',a,{token:qr});const body=await scan.json() as any;expect(scan.status).toBe(200);
 await revoke(hidden,b);const r=await request('/undo',a,{undoToken:body.undoToken});expect(r.status).toBe(200);expect((await r.json() as any).undone).toBe(1);
 expect(await count('event_meet',hidden)).toBe(1);expect(await count('event_meet',pub)).toBe(0);
 expect(await count('notification',hidden)).toBe(1);expect(await count('notification',pub)).toBe(0);
 expect(await (await request('/undo',a,{undoToken:body.undoToken})).json()).toEqual({undone:0,attendanceRevoked:false});
});
it('diagnostics do not use inaccessible events as timing or pending evidence',async()=>{
 const a=await user(),b=await user(),e=await event(a,b);await token(b);await revoke(e,b);
 await sql('UPDATE event SET starts_at=?,ends_at=? WHERE id=?',Date.now()+86400000,Date.now()+90000000,e);
 expect(await eventMeetsRepo.diagnoseUnmeetable(a.id,b.id)).toBe('no_shared_event');
 await sql("UPDATE event_member SET status='waitlist' WHERE event_id=? AND user_id=?",e,b.id);
 expect(await eventMeetsRepo.diagnoseUnmeetable(a.id,b.id)).toBe('no_shared_event');
});
it('batch error rolls back meet/attendance/notice and releases only claimed nonce',async()=>{
 const a=await user(),b=await user(),e=await event(a,b,'public'),qr=await token(b);await sql("UPDATE event_member SET role='staff' WHERE event_id=? AND user_id=?",e,a.id);
 await env.DB.exec("CREATE TRIGGER fail_meet_notice BEFORE INSERT ON notification BEGIN SELECT RAISE(ABORT,'injected meet failure'); END");
 try {expect((await request('/scan',a,{token:qr})).status).toBe(500);}finally{await env.DB.exec('DROP TRIGGER fail_meet_notice');}
 expect(await count('event_meet',e)).toBe(0);expect((await env.DB.prepare('SELECT attended FROM event_member WHERE event_id=? AND user_id=?').bind(e,b.id).first())!.attended).toBe(0);
 expect((await request('/scan',a,{token:qr})).status).toBe(200);
});
it('scanner revocation after receiving undo token preserves private history and hides all changes',async()=>{
 const a=await user(),b=await user(),e=await event(a,b),qr=await token(b);const first=await request('/scan',a,{token:qr});const body=await first.json() as any;
 await revoke(e,a);expect(await(await request('/undo',a,{undoToken:body.undoToken})).json()).toEqual({undone:0,attendanceRevoked:false});expect(await count('event_meet',e)).toBe(1);expect(await count('notification',e)).toBe(1);
});
it('public visibility does not bypass active-target qualification after selection',async()=>{
 const a=await user(),b=await user(),e=await event(a,b,'public'),qr=await token(b);const original=eventMeetsRepo.meetablePairsBetween.bind(eventMeetsRepo);
 vi.spyOn(eventMeetsRepo,'meetablePairsBetween').mockImplementationOnce(async(...args)=>{const rows=await original(...args);await sql('UPDATE user SET deleted_at=1 WHERE id=?',b.id);return rows;});
 const r=await request('/scan',a,{token:qr});expect(r.status).toBe(409);expect(await r.json()).toEqual({error:'no_shared_event'});expect(await count('event_meet',e)).toBe(0);
});
