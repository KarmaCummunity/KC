// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { privatePhotoSource } from '../privatePhotoSource';
import { usePrivatePhotoObjectUrl } from '../usePrivatePhotoObjectUrl';
const id='1b1b1b1b-0000-4000-8000-000000000001';
const first=privatePhotoSource('https://enbqriuxvvuontiwslun.supabase.co',{
 mediaId:id,generation:1,variant:'full',bucket:'post-photo-derived-private',path:`${id}/g1/full.jpg`,state:'ready',
},{principalId:'0a0a0a0a-0000-4000-8000-00000000000a',accessToken:'synthetic-a',expiresAtSeconds:1000},100)!;
const response=()=>new Response(new Uint8Array([255,216,255,217]),{headers:{'Content-Type':'image/jpeg'}});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});
function mocks(){
 const revoke=vi.fn();vi.stubGlobal('URL',Object.assign(class {},{createObjectURL:vi.fn(()=> 'blob:synthetic-only'),revokeObjectURL:revoke}));
 const get=vi.fn(async(_uri: string,_options?: RequestInit)=>response());vi.stubGlobal('fetch',get);return{get,revoke};
}
describe('private web object URLs, inactive prototype',()=>{
 it('keeps Authorization in the fetch, prevents redirects/caches and revokes on access loss',async()=>{
  const{get,revoke}=mocks();const hook=renderHook(({value})=>usePrivatePhotoObjectUrl(value),{initialProps:{value:first as typeof first|null}});
  await waitFor(()=>expect(hook.result.current).toBe('blob:synthetic-only'));
  expect(get.mock.calls[0]![0]).toBe(first.source.uri);
  expect(get.mock.calls[0]![1]).toMatchObject({headers:{Authorization:'Bearer synthetic-a'},cache:'no-store',redirect:'error',credentials:'omit'});
  hook.rerender({value:null});expect(hook.result.current).toBeNull();expect(revoke).toHaveBeenCalledWith('blob:synthetic-only');
 });
 it('does not reveal a previous principal while the next request is pending',async()=>{
  const{get}=mocks();const hook=renderHook(({value})=>usePrivatePhotoObjectUrl(value),{initialProps:{value:first}});
  await waitFor(()=>expect(hook.result.current).not.toBeNull());get.mockImplementation(()=>new Promise(()=>{}));
  hook.rerender({value:{...first,recyclingKey:'different-member',source:{...first.source,headers:{Authorization:'Bearer synthetic-b'}}}});
  expect(hook.result.current).toBeNull();
 });
 it('ignores an old request that resolves after logout',async()=>{
  const{get}=mocks();let resolve!:(x:ReturnType<typeof response>)=>void;
  get.mockImplementation(()=>new Promise(done=>{resolve=done;}));
  const hook=renderHook(({value})=>usePrivatePhotoObjectUrl(value),{initialProps:{value:first as typeof first|null}});
  hook.rerender({value:null});await act(async()=>{resolve(response());});
  expect(hook.result.current).toBeNull();expect(URL.createObjectURL).not.toHaveBeenCalled();
 });
 it('ignores an operation that answers after its total deadline even if the double ignores abort',async()=>{
  vi.useFakeTimers();const{get}=mocks();let resolve!:(x:ReturnType<typeof response>)=>void;
  get.mockImplementation(()=>new Promise(done=>{resolve=done;}));
  const hook=renderHook(()=>usePrivatePhotoObjectUrl(first));
  await act(async()=>{vi.advanceTimersByTime(15_001);resolve(response());});
  expect(hook.result.current).toBeNull();expect(URL.createObjectURL).not.toHaveBeenCalled();
 });
 it('has no fallback on denied responses and releases on unmount',async()=>{
  const{get,revoke}=mocks();get.mockResolvedValue(new Response(null,{status:403}));
  const denied=renderHook(()=>usePrivatePhotoObjectUrl(first));await act(async()=>{});expect(denied.result.current).toBeNull();denied.unmount();
  get.mockResolvedValue(response());const allowed=renderHook(()=>usePrivatePhotoObjectUrl(first));await waitFor(()=>expect(allowed.result.current).not.toBeNull());allowed.unmount();expect(revoke).toHaveBeenCalled();
 });
});
