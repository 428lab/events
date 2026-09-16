import { SELF,env } from 'cloudflare:test';
import { expect,it } from 'vitest';
const root='https://example.com',sql=(q:string,...v:unknown[])=>env.DB.prepare(q).bind(...v).run();
async function user(){const id=crypto.randomUUID(),sid=crypto.randomUUID();await sql('INSERT INTO user(id,discord_id,username,created_at) VALUES(?,?,?,1)',id,id,id);await sql('INSERT INTO session(id,user_id,expires_at) VALUES(?,?,?)',sid,id,Date.now()+86400000);return {id,cookie:`eventer_session=${sid}`};}
type Actor=Awaited<ReturnType<typeof user>>;
async function event(owner:Actor,visibility:string){const id=crypto.randomUUID(),slug=id.slice(0,8);await sql("INSERT INTO event(id,slug,title,created_by,created_at,starts_at,ends_at,venue_type,status,visibility) VALUES(?,?,'UNIQUE SECRET TITLE',?,1,?,?,'online','published',?)",id,slug,owner.id,Date.now()+60000,Date.now()+3600000,visibility);await sql("INSERT INTO event_member(id,event_id,user_id,role,status,created_at) VALUES(?,?,?,'staff','confirmed',1)",crypto.randomUUID(),id,owner.id);return {id,slug};}
async function grant(e:string,u:Actor){await sql("INSERT INTO event_access_invite(id,event_id,user_id,status,source,created_at) VALUES(?,?,?,'accepted','invite',1)",crypto.randomUUID(),e,u.id);}
const req=(p:string,u?:Actor,method='GET',body?:unknown)=>SELF.fetch(root+p,{method,headers:{...(u?{cookie:u.cookie}:{}),'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
it('HTML, slug and child SPA do not disclose private titles; unlisted direct view differs from public discovery',async()=>{
 const owner=await user(),recipient=await user(),e=await event(owner,'private');await grant(e.id,recipient);
 for(const path of [`/events/${e.id}`,`/events/${e.id}/photos`,`/e/${e.slug}`]){
  const denied=await req(path);expect(denied.status).toBe(404);expect(await denied.text()).not.toContain('UNIQUE SECRET TITLE');expect(denied.headers.get('cache-control')).toContain('no-store');expect(denied.headers.get('referrer-policy')).toBe('no-referrer');expect(denied.headers.get('x-robots-tag')).toContain('noindex');
  const allowed=await req(path,recipient);expect(allowed.status).toBe(200);expect(await allowed.text()).not.toContain('UNIQUE SECRET TITLE');
 }
 expect((await req(`/api/public/events/by-slug/${e.slug}`)).status).toBe(404);
 expect(await(await req(`/api/public/events/by-slug/${e.slug}`,recipient)).json()).toEqual({id:e.id});
 await sql("UPDATE event_access_invite SET status='revoked' WHERE event_id=?",e.id);expect((await req(`/e/${e.slug}`,recipient)).status).toBe(404);
 await sql("UPDATE event SET visibility='unlisted' WHERE id=?",e.id);expect((await req(`/e/${e.slug}`)).status).toBe(200);expect((await req(`/api/public/events/by-slug/${e.slug}`)).status).toBe(200);
 const feed=await req('/feed/events.ics');expect(await feed.text()).not.toContain(e.id);expect(feed.headers.get('cache-control')).toContain('no-store');
 await sql("UPDATE event SET visibility='public' WHERE id=?",e.id);expect(await(await req(`/e/${e.slug}`)).text()).toContain('UNIQUE SECRET TITLE');expect(await(await req('/feed/events.ics')).text()).toContain(e.id);
});
it('personal lists and bingo counts reauthorize without deleting historical participation',async()=>{
 const owner=await user(),u=await user(),e=await event(owner,'private');await grant(e.id,u);
 await sql("INSERT INTO event_member(id,event_id,user_id,role,status,created_at) VALUES(?,?,?,'participant','confirmed',1)",crypto.randomUUID(),e.id,u.id);
 await sql("INSERT INTO event_bingo_result(id,event_id,user_id,started_at,ended_at,drawn_total) VALUES(?,?,?,1,2,10)",crypto.randomUUID(),e.id,u.id);
 expect(JSON.stringify(await(await req('/api/me/events',u)).json())).toContain(e.id);expect((await(await req('/api/me/bingo-results',u)).json() as any).games).toBe(1);
 await sql("UPDATE event_access_invite SET status='revoked' WHERE event_id=?",e.id);
 expect(JSON.stringify(await(await req('/api/me/events',u)).json())).not.toContain(e.id);expect((await(await req('/api/me/bingo-results',u)).json() as any).games).toBe(0);
 expect((await env.DB.prepare('SELECT status FROM event_member WHERE event_id=? AND user_id=?').bind(e.id,u.id).first())!.status).toBe('confirmed');
});
it('shared survey token never opens private event even to staff; unlisted independent survey is retained',async()=>{
 const owner=await user(),e=await event(owner,'public');
 const setup=await req(`/api/events/${e.id}/pre-survey`,owner,'PUT',{title:'PRIVATE FORM TITLE',description:'',questions:[]});expect(setup.status).toBe(200);const {survey}=await setup.json() as any;
 await sql("UPDATE event SET visibility='private' WHERE id=?",e.id);
 for(const path of [`/api/public/pre-surveys/${survey.token}`,`/s/${survey.token}`]){const r=await req(path,owner);expect(r.status).toBe(404);expect(await r.text()).not.toContain('PRIVATE FORM TITLE');}
 expect((await req(`/api/public/pre-surveys/${survey.token}/responses`,owner,'POST',{answers:[]})).status).toBe(404);
 await sql("UPDATE event SET visibility='unlisted' WHERE id=?",e.id);expect((await req(`/api/public/pre-surveys/${survey.token}`)).status).toBe(200);
});
it('venue provider keeps offer status but needs event viewing access before event information or attendance CSV',async()=>{
 const owner=await user(),provider=await user(),e=await event(owner,'private'),venue=crypto.randomUUID(),offer=crypto.randomUUID();
 await sql("INSERT INTO venue(id,owner_id,name,created_at,updated_at) VALUES(?,?,'Venue',1,1)",venue,provider.id);
 await sql("INSERT INTO venue_offer(id,venue_id,event_id,direction,status,organizer_contact,created_by,created_at) VALUES(?,?,?,'event_to_venue','accepted','SECRET CONTACT',?,1)",offer,venue,e.id,owner.id);
 const r=await req(`/api/venue-offers/for-venue/${venue}`,provider);expect(r.status).toBe(200);const body=await r.json() as any;expect(body.offers[0]).toMatchObject({id:offer,status:'accepted',event:null,eventId:null,organizerContact:''});expect(JSON.stringify(body)).not.toContain('UNIQUE SECRET TITLE');
 expect((await req(`/api/events/${e.id}/attendance.csv`,provider)).status).toBe(404);
 await grant(e.id,provider);expect((await req(`/api/events/${e.id}/attendance.csv`,provider)).status).toBe(200);expect(JSON.stringify(await(await req(`/api/venue-offers/for-venue/${venue}`,provider)).json())).toContain('UNIQUE SECRET TITLE');
});

it.each(['/events/upcoming','/events/new'])('ordinary SPA %s keeps GET/HEAD200 without private-event robots',async path=>{
 for(const method of ['GET','HEAD']){
  const r=await req(path,undefined,method);expect(r.status).toBe(200);expect(r.headers.get('x-robots-tag')).toBeNull();expect(await r.text()).not.toContain('noindex,nofollow,noarchive');
 }
 expect((await req('/events/missing-event/photos')).status).toBe(404);
});
