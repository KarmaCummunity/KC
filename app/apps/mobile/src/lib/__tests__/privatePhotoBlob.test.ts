import { describe, expect, it } from 'vitest';
import { MAX_PRIVATE_PHOTO_BYTES, privatePhotoBlob } from '../privatePhotoBlob';
const headers={'Content-Type':'image/jpeg'};
describe('private photo bounded stream prototype',()=>{
 it('accepts a bounded JPEG response without relying on Content-Length',async()=>{
  const blob=await privatePhotoBlob(new Response(new Uint8Array([255,216,255,217]),{headers}));
  expect(blob.size).toBe(4);expect(blob.type).toBe('image/jpeg');
 });
 it('rejects denied, empty and non-JPEG responses',async()=>{
  for(const response of [new Response(null,{status:403}),new Response(new Uint8Array(),{headers}),new Response('x',{headers:{'Content-Type':'text/html'}})])
   await expect(privatePhotoBlob(response)).rejects.toThrow(/private_photo/);
 });
 it('cancels a too-large declared response before reading its body',async()=>{
  let cancelled=false;const body=new ReadableStream({cancel(){cancelled=true;}});
  await expect(privatePhotoBlob(new Response(body,{headers:{...headers,'Content-Length':String(MAX_PRIVATE_PHOTO_BYTES+1)}}))).rejects.toThrow('private_photo_size_refused');
  expect(cancelled).toBe(true);
 });
 it('enforces the real stream cap when Content-Length is missing or understated',async()=>{
  for(const declared of [undefined,'1']){
   let cancelled=false;const body=new ReadableStream({start(c){c.enqueue(new Uint8Array(MAX_PRIVATE_PHOTO_BYTES));c.enqueue(new Uint8Array(1));},cancel(){cancelled=true;}});
   await expect(privatePhotoBlob(new Response(body,{headers:{...headers,...(declared?{'Content-Length':declared}:{})}}))).rejects.toThrow('private_photo_size_refused');
   expect(cancelled).toBe(true);
  }
 });
});
