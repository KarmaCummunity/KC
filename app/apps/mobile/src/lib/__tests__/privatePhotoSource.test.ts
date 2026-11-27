import { describe, expect, it } from 'vitest';
import { privatePhotoSource, type PrivatePhotoRef, type PrivatePhotoSession } from '../privatePhotoSource';
const base = 'https://enbqriuxvvuontiwslun.supabase.co';
const id = '1b1b1b1b-0000-4000-8000-000000000001';
const member = '0a0a0a0a-0000-4000-8000-00000000000a';
const photo: PrivatePhotoRef = { mediaId: id, generation: 1, variant: 'full', bucket: 'post-photo-derived-private', path: `${id}/g1/full.jpg`, state: 'ready' };
const session: PrivatePhotoSession = { principalId: member, accessToken: 'synthetic-token-only', expiresAtSeconds: 1000 };
describe('private photo transport capability, not wired to product', () => {
 it('puts the ephemeral bearer only in headers; disables caching and has no fallback', () => {
  const result = privatePhotoSource(base, photo, session, 100)!;
  expect(result.source.uri).toBe(`${base}/storage/v1/object/authenticated/post-photo-derived-private/${id}/g1/full.jpg`);
  expect(result.source.uri).not.toContain(session.accessToken);
  expect(result.source.headers).toEqual({ Authorization: `Bearer ${session.accessToken}` });
  expect(result.cachePolicy).toBe('none');
  expect(result.source.cacheKey).not.toContain(session.accessToken);
  expect(result).not.toHaveProperty('fallbackUri');
 });
 it('has no source before ready, after revocation, logout or imminent token expiry', () => {
  for (const state of ['pending','revoked'] as const) expect(privatePhotoSource(base,{...photo,state},session,100)).toBeNull();
  expect(privatePhotoSource(base,photo,null,100)).toBeNull();
  expect(privatePhotoSource(base,photo,session,970)).toBeNull();
 });
 it('isolates recycling/cache identity across principal, generation and variant', () => {
  const original=privatePhotoSource(base,photo,session,100)!;
  const other=privatePhotoSource(base,photo,{...session,principalId:'0b0b0b0b-0000-4000-8000-00000000000b'},100)!;
  const next=privatePhotoSource(base,{...photo,generation:2,path:`${id}/g2/full.jpg`},session,100)!;
  const thumb=privatePhotoSource(base,{...photo,variant:'thumb',path:`${id}/g1/thumb.jpg`},session,100)!;
  expect(new Set([original,other,next,thumb].map(x=>x.recyclingKey)).size).toBe(4);
 });
 it('rejects path traversal, query tokens, arbitrary variants and unapproved buckets', () => {
  for(const path of ['../other.jpg',`${id}/g1/full.jpg?token=x`,`${id}/g1/%2e%2e/full.jpg`,'https://external.invalid/x'])
   expect(privatePhotoSource(base,{...photo,path},session,100)).toBeNull();
  expect(privatePhotoSource(base,{...photo,bucket:'post-images' as PrivatePhotoRef['bucket']},session,100)).toBeNull();
  expect(privatePhotoSource(base,{...photo,variant:'other' as PrivatePhotoRef['variant']},session,100)).toBeNull();
 });
 it('refuses non-provider, insecure, decorated and credential-bearing origins', () => {
  for(const url of ['http://enbqriuxvvuontiwslun.supabase.co','https://external.invalid',base+'/evil',base+'?token=x',base+'#x','https://a:b@enbqriuxvvuontiwslun.supabase.co'])
   expect(privatePhotoSource(url,photo,session,100)).toBeNull();
 });
 it('rejects malformed identities, generation, clocks and header injection', () => {
  expect(privatePhotoSource(base,{...photo,mediaId:'bad'},session,100)).toBeNull();
  for(const generation of [0,-1,1.5,NaN])expect(privatePhotoSource(base,{...photo,generation},session,100)).toBeNull();
  expect(privatePhotoSource(base,photo,session,NaN)).toBeNull();
  expect(privatePhotoSource(base,photo,{...session,accessToken:'x\r\nX-Test: bad'},100)).toBeNull();
 });
});
