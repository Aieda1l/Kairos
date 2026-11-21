import {afterEach,describe,it,expect,vi} from "vitest";
import {createHash} from 'node:crypto';
import {parseGuestSourceBytes} from "@/lib/guest/sources/parse";
import {GuestSourceError} from '@/lib/guest/sources/errors';
import {cases,bytesForCase,requestId,checkedAt} from "../helpers/guest-parser-cases.mjs";
import {edLessons} from '../helpers/guest-source-fixtures';
import golden from "../helpers/guest-parser-golden.json";
afterEach(()=>vi.restoreAllMocks());

describe("portable guest parser frozen hosted results",()=>{
 for(const item of cases)it(item.name,async()=>{
  const bytes=bytesForCase(item).buffer as ArrayBuffer;
  let actual:unknown;
  try{const result=await parseGuestSourceBytes({operation:item.operation,requestId,checkedAt,bytes,...(item.operation==='ed-lessons'?{courseId:item.courseId}:{})} as never);actual=item.digestOnly?{sha256:createHash('sha256').update(JSON.stringify(result)).digest('hex'),count:('assignments'in result?result.assignments:'courses'in result?result.courses:result.lessons).length}:result;}catch(error){actual={error:(error as {code?:string}).code};}
  expect(actual).toEqual((golden as Record<string,unknown>)[item.name]);
 });
 it('converts explicit Ed offsets to UTC before validating the lesson response',async()=>{
  const payload=edLessons(1,{
   effective_available_at:'2026-10-25T09:30:00+00:00',
   due_at:'2026-10-25T23:45:00-08:00',
   updated_at:'2026-10-25 09:30:00+0530',
  });
  const bytes=new TextEncoder().encode(JSON.stringify(payload)).buffer;
  await expect(parseGuestSourceBytes({operation:'ed-lessons',courseId:'12',requestId,checkedAt,bytes})).resolves.toMatchObject({
   lessons:[{releaseAt:'2026-10-25T09:30:00.000Z',dueAt:'2026-10-26T07:45:00.000Z',sourceUpdatedAt:'2026-10-25T04:00:00.000Z'}],
  });
 });
 it('preserves existing UTC precision and nullable Ed timestamps',async()=>{
  const payload=edLessons(1,{available_at:'2026-10-25T09:30:00.123456Z',due_at:null});
  const bytes=new TextEncoder().encode(JSON.stringify(payload)).buffer;
  await expect(parseGuestSourceBytes({operation:'ed-lessons',courseId:'12',requestId,checkedAt,bytes})).resolves.toMatchObject({
   lessons:[{releaseAt:'2026-10-25T09:30:00.123456Z',dueAt:null,sourceUpdatedAt:null}],
  });
 });
 it.each(['2026-10-25T09:30:00','2026-02-30 09:30:00+0000','2026-10-25T09:30:00+24:00','yesterday'])('rejects invalid Ed timestamp %s',async due_at=>{
  const bytes=new TextEncoder().encode(JSON.stringify(edLessons(1,{due_at}))).buffer;
  await expect(parseGuestSourceBytes({operation:'ed-lessons',courseId:'12',requestId,checkedAt,bytes})).rejects.toMatchObject({code:'ED_PARSE_ERROR'});
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
