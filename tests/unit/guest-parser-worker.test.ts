// @vitest-environment jsdom
import {afterEach,describe,it,expect,vi} from 'vitest';
import {createGuestTransientClient} from '@/lib/guest/sync/transient-client';
import {parseGuestSourceInWorker} from '@/lib/guest/sync/source-parser-worker';
import {encodeGuestWireBytes} from '@/lib/guest/sources/wire';
const requestId='00000000-0000-4000-8000-000000000010',checkedAt='2026-10-24T12:00:00.000Z';
const claims={v:2,aud:'guest',sessionTag:encodeGuestWireBytes(new Uint8Array(32)),operation:'ed-courses',requestId,checkedAt,issuedAtMs:Date.parse(checkedAt),deadlineAtMs:Date.parse(checkedAt)+15000,providerVersion:1,courseId:null};
const receipt=(data=claims)=>encodeGuestWireBytes(new TextEncoder().encode(JSON.stringify(data)))+'.'+encodeGuestWireBytes(new Uint8Array(32));
const raw=(data=claims)=>new Response('{"courses":[]}',{headers:{'content-type':'application/octet-stream','x-kairos-guest-source-version':'2','x-kairos-guest-read-receipt':receipt(data)}});
const result={ok:true as const,schemaVersion:1 as const,requestId,checkedAt,courses:[]};
function workerDouble(terminate:ReturnType<typeof vi.fn>){
 return {onmessage:null as ((event:{data:unknown})=>void)|null,onerror:null as ((event:Event)=>void)|null,onmessageerror:null as ((event:Event)=>void)|null,terminate,postMessage:vi.fn()};
}
const ack={ok:true,schemaVersion:2,requestId,checkedAt,operation:'ed-courses',courseId:null};
const input={schemaVersion:1 as const,requestId,token:'secret'};
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
describe('source read and approval',()=>{
 it('sends bounded raw data to parsing and resolves only after correlated approval',async()=>{
  const fetchImpl=vi.fn<typeof fetch>().mockResolvedValueOnce(raw()).mockResolvedValueOnce(Response.json(ack));
  const parseSource=vi.fn().mockResolvedValue(result);
  await expect(createGuestTransientClient({fetchImpl,parseSource}).edCourses(input,new AbortController().signal)).resolves.toEqual(result);
  expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({...input,schemaVersion:2});
  expect(fetchImpl.mock.calls[1][0]).toBe('/api/guest/sources/approve');
  expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))).toEqual({schemaVersion:2,requestId,receipt:receipt()});
  expect(parseSource.mock.calls[0][0]).toEqual({operation:'ed-courses',requestId,checkedAt,bytes:expect.any(ArrayBuffer)});
 });
 it('rejects a mismatched receipt before invoking the parser',async()=>{
  const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(raw({...claims,requestId:'00000000-0000-4000-8000-000000000011'}));const parseSource=vi.fn();
  await expect(createGuestTransientClient({fetchImpl,parseSource}).edCourses(input,new AbortController().signal)).rejects.toMatchObject({code:'INVALID_RESULT'});expect(parseSource).not.toHaveBeenCalled();
 });
 it('rejects a mismatched approval after parsing',async()=>{
  const fetchImpl=vi.fn<typeof fetch>().mockResolvedValueOnce(raw()).mockResolvedValueOnce(Response.json({...ack,checkedAt:'2026-10-25T12:00:00.000Z'}));
  await expect(createGuestTransientClient({fetchImpl,parseSource:vi.fn().mockResolvedValue(result)}).edCourses(input,new AbortController().signal)).rejects.toMatchObject({code:'INVALID_RESULT'});
 });
 it('rejects an oversized raw response without invoking the parser',async()=>{
  const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array(2*1024*1024+1),{headers:{'content-type':'application/octet-stream','x-kairos-guest-source-version':'2','x-kairos-guest-read-receipt':receipt()}}));const parseSource=vi.fn();
  await expect(createGuestTransientClient({fetchImpl,parseSource}).edCourses(input,new AbortController().signal)).rejects.toMatchObject({code:'SOURCE_RESULT_TOO_LARGE'});expect(parseSource).not.toHaveBeenCalled();expect(fetchImpl).toHaveBeenCalledTimes(1);
 });
 it('does not approve a parser result with unexpected fields',async()=>{
  const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(raw());const parseSource=vi.fn().mockResolvedValue({...result,secret:'reflected'});
  await expect(createGuestTransientClient({fetchImpl,parseSource}).edCourses(input,new AbortController().signal)).rejects.toMatchObject({code:'INVALID_RESULT'});expect(fetchImpl).toHaveBeenCalledTimes(1);
 });
 it('rejects a successful response with the wrong media type before parsing',async()=>{
  const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(new Response('{}',{headers:{'content-type':'application/json','x-kairos-guest-source-version':'2','x-kairos-guest-read-receipt':receipt()}}));const parseSource=vi.fn();
  await expect(createGuestTransientClient({fetchImpl,parseSource}).edCourses(input,new AbortController().signal)).rejects.toMatchObject({code:'INVALID_RESULT'});expect(parseSource).not.toHaveBeenCalled();
 });
 it('uses one deadline even when parsing never completes',async()=>{
  vi.useFakeTimers();const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(raw());let markStarted!:()=>void;const started=new Promise<void>(resolve=>{markStarted=resolve;});
  const promise=createGuestTransientClient({fetchImpl,parseSource:()=>{markStarted();return new Promise(()=>{});}}).edCourses(input,new AbortController().signal);
  const assertion=expect(promise).rejects.toMatchObject({code:'ED_NETWORK_ERROR'});await started;await vi.advanceTimersByTimeAsync(15000);await assertion;expect(fetchImpl).toHaveBeenCalledTimes(1);
 });
 it('interrupts an outstanding parse and never approves it',async()=>{
  const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(raw());let markStarted!:()=>void;const started=new Promise<void>(resolve=>{markStarted=resolve;});const controller=new AbortController();
  const promise=createGuestTransientClient({fetchImpl,parseSource:()=>{markStarted();return new Promise(()=>{});}}).edCourses(input,controller.signal);
  await started;controller.abort();await expect(promise).rejects.toMatchObject({code:'GUEST_INTERRUPTED'});expect(fetchImpl).toHaveBeenCalledTimes(1);
 });
});
describe('dedicated parser worker',()=>{
 it('fails safely when dedicated workers are unavailable',async()=>{
  vi.stubGlobal('Worker',undefined);
  await expect(parseGuestSourceInWorker({operation:'ed-courses',requestId,checkedAt,bytes:new ArrayBuffer(0)},new AbortController().signal,Date.now()+15000)).rejects.toMatchObject({code:'SERVICE_UNAVAILABLE'});
 });
 it('rejects an unrelated worker message and terminates',async()=>{
  const terminate=vi.fn(),worker=workerDouble(terminate);
  vi.stubGlobal('Worker',function FakeWorker(){return worker;});const promise=parseGuestSourceInWorker({operation:'ed-courses',requestId,checkedAt,bytes:new ArrayBuffer(0)},new AbortController().signal,Date.now()+15000);
  worker.onmessage?.({data:{id:'00000000-0000-4000-8000-000000000011',ok:true,result}});await expect(promise).rejects.toMatchObject({code:'INVALID_RESULT'});expect(terminate).toHaveBeenCalledOnce();
 });
 it('terminates on cancellation and ignores a late result',async()=>{
  const terminate=vi.fn(),worker=workerDouble(terminate);
  vi.stubGlobal('Worker',function FakeWorker(){return worker;});const controller=new AbortController();
  const promise=parseGuestSourceInWorker({operation:'ed-courses',requestId,checkedAt,bytes:new ArrayBuffer(0)},controller.signal,Date.now()+15000);
  controller.abort();await expect(promise).rejects.toMatchObject({code:'GUEST_INTERRUPTED'});worker.onmessage?.({data:{id:'late',ok:true,result}});expect(terminate).toHaveBeenCalledOnce();
 });
});
