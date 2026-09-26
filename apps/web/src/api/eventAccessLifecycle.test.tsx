import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
import { installEventAccessLifecycle } from './eventAccessLifecycle.js';
import { api,ApiError,invalidateEventResponses } from './client.js';
import { useEvent } from './hooks.js';
afterEach(()=>vi.unstubAllGlobals());
const deferred=<T,>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};};
function setup(){const qc=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});qc.setQueryData(['me'],{user:{id:'A'}});installEventAccessLifecycle(qc);return qc;}
it('account switch cancels populated detail/children/invites and cannot accept held old response, without app reload',async()=>{
 const qc=setup(),held=deferred<unknown>();
 for(const key of [['event','E','members'],['eventInvites','A'],['eventAccess','A'],['community','group','viewer','A'],['communityEventSearch','group','A','phase=past']])qc.setQueryData(key,{secret:'OLD'});
 qc.setQueryData(['events'],{public:'offline'});
 const pending=qc.fetchQuery({queryKey:['event','E','photos'],queryFn:()=>held.promise}).catch(()=>undefined);
 qc.setQueryData(['me'],{user:{id:'B'}});held.resolve({secret:'OLD async'});await pending;
 expect(qc.getQueryCache().findAll({queryKey:['event']})).toHaveLength(0);expect(qc.getQueryData(['eventInvites','A'])).toBeUndefined();expect(qc.getQueryData(['events'])).toEqual({public:'offline'});expect(qc.getQueryData(['community','group','viewer','A'])).toBeUndefined();expect(qc.getQueryData(['communityEventSearch','group','A','phase=past'])).toBeUndefined();qc.clear();
});
it.each(['/events/E/photos','/public/communities/group','/public/communities/group/events?phase=past'])('in-flight %s response is rejected on identity/access epoch change',async path=>{
 const held=deferred<Response>();vi.stubGlobal('fetch',vi.fn(()=>held.promise));const pending=api.get(path);invalidateEventResponses();held.resolve(new Response('{"secret":"old"}'));
 await expect(pending).rejects.toMatchObject({status:409});
});
it('revision change clears children and emits relay stop, but preserves revalidated detail',()=>{
 const qc=setup(),stop=vi.fn();window.addEventListener('event-access-reset',stop);
 qc.setQueryData(['event','E','viewer','A'],{event:{visibility:'private',accessRevision:1}});qc.setQueryData(['event','E','photos'],{secret:'OLD'});
 qc.setQueryData(['event','E','viewer','A'],{event:{visibility:'private',accessRevision:2}});
 expect(qc.getQueryData(['event','E','photos'])).toBeUndefined();expect(qc.getQueryData(['event','E','viewer','A'])).toBeDefined();expect(stop).toHaveBeenCalledOnce();window.removeEventListener('event-access-reset',stop);qc.clear();
});
it.each(['private','public'])('%s revalidation failure clears only confidential offline data',async visibility=>{
 const qc=setup();qc.setQueryData(['event','E','viewer','A'],{event:{title:'OLD',visibility,accessRevision:1}});qc.setQueryData(['event','E','photos'],{secret:'CHILD'});
 vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new TypeError('offline')));
 const {result,unmount}=renderHook(()=>useEvent('E'),{wrapper:({children})=><QueryClientProvider client={qc}>{children}</QueryClientProvider>});
 expect(result.current.data?.event.title).toBe("OLD");
 await act(async()=>{await result.current.refetch();});
 if(visibility==='private'){await waitFor(()=>expect(result.current.data).toBeUndefined());expect(qc.getQueryData(['event','E','photos'])).toBeUndefined();}
 else expect(result.current.data?.event.title).toBe('OLD');unmount();qc.clear();
});
it('explicit denial also clears formerly public detail and children',async()=>{
 const qc=setup();qc.setQueryData(['event','E','viewer','A'],{event:{visibility:'public',accessRevision:1}});qc.setQueryData(['event','E','photos'],{secret:'CHILD'});
 await qc.fetchQuery({queryKey:['event','E','viewer','A'],staleTime:0,queryFn:()=>Promise.reject(new ApiError(404,{}))}).catch(()=>{});
 expect(qc.getQueryData(['event','E','photos'])).toBeUndefined();qc.clear();
});
it('mounted detail page on a deleted event (404) does not refetch in a loop',async()=>{
 const qc=setup();const fetchMock=vi.fn(async()=>new Response('{"error":"not_found"}',{status:404}));vi.stubGlobal('fetch',fetchMock);
 const wrapper=({children}:{children:React.ReactNode})=><QueryClientProvider client={qc}>{children}</QueryClientProvider>;
 const {result,unmount}=renderHook(()=>useEvent('E'),{wrapper});
 await waitFor(()=>expect(result.current.isError).toBe(true));
 await new Promise(r=>setTimeout(r,300));
 expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(2);expect(result.current.isError).toBe(true);unmount();qc.clear();
});

it('community revalidation failure drops private snapshots but preserves retryable error',async()=>{
 const qc=setup();
 for(const key of [['community','group','viewer','A'],['communityEventSearch','group','A','phase=past']]) {
  qc.setQueryData(key,{secret:'OLD'});
  await qc.fetchQuery({queryKey:key,staleTime:0,queryFn:()=>Promise.reject(new Error('offline'))}).catch(()=>{});
  expect(qc.getQueryData(key)).toBeUndefined();expect(qc.getQueryState(key)?.status).toBe('error');
 }
 qc.clear();
});
it('known event revocation clears community detail/search as well as the event children',async()=>{
 const qc=setup();
 qc.setQueryData(['event','E','viewer','A'],{event:{visibility:'private',accessRevision:1}});
 for(const key of [['community','group','viewer','A'],['communityEventSearch','group','A','phase=past']])qc.setQueryData(key,{secret:'OLD'});
 await qc.fetchQuery({queryKey:['event','E','viewer','A'],staleTime:0,queryFn:()=>Promise.reject(new ApiError(404,{}))}).catch(()=>{});
 expect(qc.getQueryData(['community','group','viewer','A'])).toBeUndefined();
 expect(qc.getQueryData(['communityEventSearch','group','A','phase=past'])).toBeUndefined();qc.clear();
});
