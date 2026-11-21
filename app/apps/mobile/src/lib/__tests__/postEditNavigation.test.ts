import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hrefForPostEdit } from '../postEditNavigation';

describe('hrefForPostEdit', () => {
  it('routes native listing worlds to edit-listing', () => {
    expect(
      hrefForPostEdit({ postId: 'p1', listingId: 'l1', listingWorldSlug: 'rides' }),
    ).toBe('/edit-listing/p1');
    expect(
      hrefForPostEdit({ postId: 'p2', listingId: 'l2', listingWorldSlug: 'food' }),
    ).toBe('/edit-listing/p2');
  });

  it('routes items and plain posts to edit-post', () => {
    expect(hrefForPostEdit({ postId: 'p3', listingId: null, listingWorldSlug: null })).toBe('/edit-post/p3');
    expect(hrefForPostEdit({ postId: 'p4', listingId: 'l4', listingWorldSlug: 'items' })).toBe('/edit-post/p4');
  });
});

// #2238: generated edit URLs must be admitted by both platforms' native-link declarations.
describe('native edit URL registration',()=>{
 const root=join(__dirname,'../../..');
 type IntentData = {scheme:string;host:string;pathPrefix?:string};
 type Intent = {action:string;autoVerify:boolean;category:string[];data:IntentData[]};
 type Association = {appID:string;paths:string[]};
 const config=JSON.parse(readFileSync(join(root,'app.json'),'utf8')).expo as {android:{intentFilters:Intent[]};ios:{associatedDomains:string[]}};
 const aasa=JSON.parse(readFileSync(join(root,'public/.well-known/apple-app-site-association'),'utf8')) as {applinks:{details:Association[]}};
 for(const target of [
 {postId:'p1',listingId:null,listingWorldSlug:null},
 {postId:'p2',listingId:'l2',listingWorldSlug:'rides' as const},
 ]){
 const path=hrefForPostEdit(target);
 it('claims '+path+' via verified Android HTTPS intent',()=>{
 const entries=config.android.intentFilters.filter((f)=>f.action==='VIEW'&&f.autoVerify===true&&f.category.includes('BROWSABLE')&&f.category.includes('DEFAULT')).flatMap((f)=>f.data);
 expect(entries.some((d)=>d.scheme==='https'&&d.host==='karma-community-kc.com'&&d.pathPrefix&&path.startsWith(d.pathPrefix))).toBe(true);
 });
 it('claims '+path+' via iOS associated domain and scoped AASA path',()=>{
 expect(config.ios.associatedDomains).toContain('applinks:karma-community-kc.com');
 const detail=aasa.applinks.details.find((d)=>d.appID==='HVW3H3DLRB.org.karmacommunity.app');
 expect(detail?.paths).toContain(path.startsWith('/edit-post/')?'/edit-post/*':'/edit-listing/*');
 });
 }
 it('keeps the claims scoped to edit paths, not every HTTPS path',()=>{
 const data=config.android.intentFilters.flatMap(f=>f.data);
 for(const prefix of ['/edit-post/','/edit-listing/']) expect(data.filter(d=>d.pathPrefix===prefix)).toHaveLength(1);
 expect(data.some(d=>d.pathPrefix==='/'||!d.pathPrefix)).toBe(false);
 const paths=aasa.applinks.details.flatMap(d=>d.paths);expect(paths).not.toContain('*');expect(paths).not.toContain('/*');
 });
});
