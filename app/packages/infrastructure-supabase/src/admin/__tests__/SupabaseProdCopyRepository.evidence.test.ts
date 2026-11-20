import { describe, expect, it, vi } from 'vitest';
import { SupabaseProdCopyRepository } from '../SupabaseProdCopyRepository';
const STATUS={members:2,posts:3,organizations:0,follows:1,saved_posts:0,last_copied_at:'2026-11-19T20:00:00Z',is_dev_environment:true};
const repository=(data:unknown)=>new SupabaseProdCopyRepository({rpc:vi.fn(async()=>({data,error:null}))} as never);
describe('production-copy response is evidence, not HTTP success alone',()=>{
 it.each([null,undefined,[],{},'ok',{...STATUS,members:-1},{...STATUS,posts:Infinity},{...STATUS,follows:1.5},{...STATUS,saved_posts:'garbage'},{...STATUS,last_copied_at:'not-a-date'},{...STATUS,is_dev_environment:undefined}])('rejects invalid status %#',async data=>{
 await expect(repository(data).getStatus()).rejects.toMatchObject({name:'DemoDataError',code:'unknown'});
 });
 it.each([null,{},[],{members:1,posts:2},{members:-1,posts:0,organizations:0}])('does not announce deletion from invalid response %#',async data=>{
 await expect(repository(data).deleteAll()).rejects.toMatchObject({name:'DemoDataError',code:'unknown'});
 });
 it('accepts genuinely empty status after a successful response',async()=>{
 await expect(repository({...STATUS,members:0,posts:0,follows:0,last_copied_at:null}).getStatus()).resolves.toMatchObject({members:0,lastCopiedAt:null});
 });
});
