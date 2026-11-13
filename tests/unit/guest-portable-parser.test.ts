import {afterEach,describe,it,expect,vi} from "vitest";
import {createHash} from 'node:crypto';
import {parseGuestSourceBytes} from "@/lib/guest/sources/parse";
import {GuestSourceError} from '@/lib/guest/sources/errors';
import {cases,bytesForCase,requestId,checkedAt} from "../helpers/guest-parser-cases.mjs";
import golden from "../helpers/guest-parser-golden.json";
afterEach(()=>vi.restoreAllMocks());

describe("portable guest parser frozen hosted results",()=>{
 for(const item of cases)it(item.name,async()=>{
  const bytes=bytesForCase(item).buffer as ArrayBuffer;
  let actual:unknown;
  try{const result=await parseGuestSourceBytes({operation:item.operation,requestId,checkedAt,bytes,...(item.operation==='ed-lessons'?{courseId:item.courseId}:{})} as never);actual=item.digestOnly?{sha256:createHash('sha256').update(JSON.stringify(result)).digest('hex'),count:('assignments'in result?result.assignments:'courses'in result?result.courses:result.lessons).length}:result;}catch(error){actual={error:(error as {code?:string}).code};}
  expect(actual).toEqual((golden as Record<string,unknown>)[item.name]);
 });
 it('rejects an aborted job before parsing',async()=>{
  const c=new AbortController();c.abort();
  await expect(parseGuestSourceBytes({operation:'canvas-feed',requestId,checkedAt,bytes:new ArrayBuffer(0)},{signal:c.signal})).rejects.toMatchObject({code:'GUEST_INTERRUPTED'});
 });
 it('obeys the caller clock without granting a fresh parse deadline',async()=>{
  await expect(parseGuestSourceBytes({operation:'ed-courses',requestId,checkedAt,bytes:new TextEncoder().encode('{"courses":[]}').buffer},{check(){throw new GuestSourceError('ED_NETWORK_ERROR');}})).rejects.toMatchObject({code:'ED_NETWORK_ERROR'});
 });
 it('rejects non-byte input with a fixed safe error',async()=>{
  await expect(parseGuestSourceBytes({operation:'canvas-feed',requestId,checkedAt,bytes:{byteLength:1}} as never)).rejects.toMatchObject({code:'BAD_REQUEST'});
 });
 it('discards a fallback hash that finishes after cancellation',async()=>{
  let finish!:(bytes:ArrayBuffer)=>void;const held=new Promise<ArrayBuffer>(resolve=>{finish=resolve;});
  const digest=vi.spyOn(globalThis.crypto.subtle,'digest').mockReturnValueOnce(held);
  const controller=new AbortController();
  const pending=parseGuestSourceBytes({operation:'canvas-feed',requestId,checkedAt,bytes:bytesForCase(cases[0]).buffer},{signal:controller.signal}).catch(error=>error);
  await vi.waitFor(()=>expect(digest).toHaveBeenCalledOnce());controller.abort();finish(new ArrayBuffer(32));
  expect(await pending).toMatchObject({code:'GUEST_INTERRUPTED'});
 });
 it('maps unavailable hashing to a safe infrastructure error',async()=>{
  vi.spyOn(globalThis.crypto.subtle,'digest').mockRejectedValueOnce(new Error('private hash diagnostic'));
  const error=await parseGuestSourceBytes({operation:'canvas-feed',requestId,checkedAt,bytes:bytesForCase(cases[0]).buffer}).catch(error=>error);
  expect(error).toMatchObject({code:'SERVICE_UNAVAILABLE'});expect(error.message).not.toContain('private hash diagnostic');
 });
});
