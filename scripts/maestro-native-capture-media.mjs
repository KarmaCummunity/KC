#!/usr/bin/env node
// Scoped to flows07/19: never retain automatic failure pixels from possibly stale fixtures.
import { readdirSync, existsSync, unlinkSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
const allowed = {
  '07-create-post-form': new Set(['861-create-form.png']),
  '19-edit-profile-keyboard-toolbar': new Set(['861-profile-input-focused.png','861-profile-keyboard-dismissed.png']),
};
const media=/\.(png|jpe?g|webp|gif|bmp|heic|avif|mp4|mov|webm)$/i;
export function cleanCaptureMedia(root,label){
 const flow=label.replace(/-retry$/,'');
 if(!allowed[flow])return {removed:0,retained:0};
 let removed=0,retained=0;
 const walk=(path,allowNamed)=>{
  if(!existsSync(path))return;
  for(const entry of readdirSync(path,{withFileTypes:true})){
   const child=join(path,entry.name);
   if(entry.isDirectory())walk(child,allowNamed);
   else if(media.test(entry.name)){
    if(allowNamed && allowed[flow].has(basename(child)))retained++;
    else {unlinkSync(child);removed++;}
   }
  }
 };
 // Named captures are valid only inside the explicit command's output tree.
 walk(join(root,'captures',label),true);
 walk(join(root,'debug',label),false);
 walk(join(root,'reports',label),false);
 for(const ext of ['mp4','mov','webm']){
  const p=join(root,'videos',`${label}.${ext}`);
  if(existsSync(p)){unlinkSync(p);removed++;}
 }
 return {removed,retained};
}

// Explicitly safe runs must produce each named PNG. Missing proof is a failed capture, not a pass.
export function requireCaptureOutputs(root, label, safe) {
 if(safe !== 'true')return;
 const expected=allowed[label.replace(/-retry$/,'')];
 if(!expected)return;
 const found=new Map();
 const walk=path=>{
  if(!existsSync(path))return;
  for(const e of readdirSync(path,{withFileTypes:true})){
   const child=join(path,e.name);
   if(e.isDirectory())walk(child);
   else if(expected.has(e.name)){
    const bytes=readFileSync(child);
    if(bytes.length<24 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ||
      bytes.readUInt32BE(16)===0 || bytes.readUInt32BE(20)===0)throw new Error('Invalid safe capture PNG');
    found.set(e.name,(found.get(e.name)||0)+1);
   }
  }
 };
 walk(join(root,'captures',label));
 for(const name of expected)if(found.get(name)!==1)throw new Error('Required safe capture missing or duplicated: '+name);
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const [root,label,safe]=process.argv.slice(2);
 if(!root||!label)throw new Error('output root and attempt label required');
 console.log('Scoped native capture media cleanup',cleanCaptureMedia(root,label));
 requireCaptureOutputs(root,label,safe);
}
