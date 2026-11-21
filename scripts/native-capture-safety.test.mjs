import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeNativeCreate, safeNativeProfile, safeNativeIdentity } from '../app/apps/mobile/src/lib/nativeCaptureSafety.ts';
const session={userId:'seed-user',email:'user1@seed.kc.test',phone:null};
const profile={displayName:'E2E Member 1',dateOfBirth:'1990-01-01',avatarUrl:null,contactPhone:'',biography:'',street:'',streetNumber:'',city:{name:'נתניה'},loading:false};
test('profile evidence permits only known synthetic or empty visible fields',()=>{
 assert.equal(safeNativeProfile(profile,session),true);
 for(const [key,value] of Object.entries({displayName:'Someone',dateOfBirth:'1991-02-03',avatarUrl:'image',contactPhone:'123',biography:'text',street:'road',streetNumber:'1',city:{name:'Elsewhere'},loading:true})){
  assert.equal(safeNativeProfile({...profile,[key]:value},session),false,key);
 }
});
test('create evidence requires loaded empty post form, no persisted draft or address',()=>{
 const form={title:'',description:'',uploads:[]};
 const safe=(f=form,city=null,street='',number='',ready=true,phase='none',engine='post')=>safeNativeCreate(f,city,street,number,ready,phase,engine,session);
 assert.equal(safe(),true);
 for(const f of [{...form,title:'draft'},{...form,description:'private'},{...form,uploads:['image']}])assert.equal(safe(f),false);
 assert.equal(safe(form,{name:'Elsewhere'}),false);
 assert.equal(safe(form,null,'street'),false);
 assert.equal(safe(form,null,'','1'),false);
 assert.equal(safe(form,null,'','',false),false);
 for(const phase of ['pending','ready'])assert.equal(safe(form,null,'','',true,phase),false);
 assert.equal(safe(form,null,'','',true,'none','listing'),false);
});

test('actual session identity, never runner override, controls both markers',()=>{
 for(const wrong of [null,undefined,{...session,userId:''},{...session,email:null},{...session,email:'other@test.invalid'},{...session,phone:'123'}]){
  assert.equal(safeNativeIdentity(wrong),false);
  assert.equal(safeNativeProfile(profile,wrong),false);
  assert.equal(safeNativeCreate({title:'',description:'',uploads:[]},null,'','',true,'none','post',wrong),false);
 }
 assert.equal(safeNativeProfile({...profile,loading:true},session),false);
 assert.equal(safeNativeCreate({title:'',description:'',uploads:[]},null,'','',false,'none','post',session),false);
});
