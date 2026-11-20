// @vitest-environment node
import {readFileSync} from 'node:fs';
import {fileURLToPath, URL as NodeURL} from 'node:url';
import {describe,it,expect,vi} from 'vitest';
// Execute the actual hook effect, not a copied implementation.
const source=readFileSync(fileURLToPath(new NodeURL('../../hooks/useMarkChatRead.ts',import.meta.url)),'utf8');
const start=source.indexOf('  useEffect(() => {\n    if (!unreadIncoming) return;');
const end=source.indexOf('\n}',start);
const effect=source.slice(start,end);
const executeEffect=new Function('useEffect','unreadIncoming','container','chatId','userId','useChatStore','reportHandledError',effect.replace('(error: unknown)', '(error)'));
const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
describe('chat screen mark-read boundary',()=>{
 it('wires the extracted acknowledgement hook into the screen',()=>{
 const screen=readFileSync(fileURLToPath(new NodeURL('../../../app/chat/[id].tsx',import.meta.url)),'utf8');
 expect(screen).toContain("import { useMarkChatRead } from '../../src/hooks/useMarkChatRead';");
 expect(screen).toContain('useMarkChatRead(messages, chatId, userId);');
 });
 it('does not mark locally read until the actual write succeeds',async()=>{
 let complete!:()=>void;const write=vi.fn(()=>new Promise<void>(resolve=>{complete=resolve}));const local=vi.fn();const report=vi.fn();
 executeEffect((f:()=>void)=>f(),true,{markChatRead:{execute:write}},'chat1','user1',{getState:()=>({markChatLocallyRead:local})},report);
 expect(local).not.toHaveBeenCalled();complete();await settle();
 expect(write).toHaveBeenCalledExactlyOnceWith({chatId:'chat1',userId:'user1'});expect(local).toHaveBeenCalledExactlyOnceWith('chat1');expect(report).not.toHaveBeenCalled();
 });
 it('contains rejection and reports it without false read state or retry',async()=>{
 const error=new Error('canceling statement due to statement timeout');const write=vi.fn().mockRejectedValue(error);const local=vi.fn();const report=vi.fn();
 executeEffect((f:()=>void)=>f(),true,{markChatRead:{execute:write}},'chat1','user1',{getState:()=>({markChatLocallyRead:local})},report);
 await settle();expect(local).not.toHaveBeenCalled();expect(write).toHaveBeenCalledTimes(1);expect(report).toHaveBeenCalledExactlyOnceWith(error,'manual',['chat','mark-read']);
 });
 it('does nothing without unread messages',async()=>{
 const write=vi.fn();const local=vi.fn();const report=vi.fn();executeEffect((f:()=>void)=>f(),false,{markChatRead:{execute:write}},'chat1','user1',{getState:()=>({markChatLocallyRead:local})},report);await settle();expect(write).not.toHaveBeenCalled();expect(local).not.toHaveBeenCalled();expect(report).not.toHaveBeenCalled();
 });
});
