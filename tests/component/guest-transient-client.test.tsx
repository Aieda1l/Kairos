// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {createGuestTransientClient} from "@/lib/guest/sync/transient-client";
import {guestUuid} from "../helpers/guest-fixtures";
import {encodeGuestWireBytes} from "@/lib/guest/sources/wire";

const requestId=guestUuid(10),checkedAt="2026-10-24T12:00:00.000Z",secret="guest-secret-marker";
const base={ok:true,schemaVersion:1,requestId,checkedAt};
const signal=new AbortController().signal;
type Operation="canvas-feed"|"ed-courses"|"ed-lessons";
function sourceFixture(operation:Operation,courseId:string|null=null,id=requestId){
  const encode=(value:unknown)=>encodeGuestWireBytes(new TextEncoder().encode(JSON.stringify(value)));
  const receipt=encode({v:2,aud:"guest",sessionTag:encodeGuestWireBytes(new Uint8Array(32)),operation,requestId:id,checkedAt,issuedAtMs:Date.parse(checkedAt),deadlineAtMs:Date.parse(checkedAt)+15000,providerVersion:1,courseId})+"."+encodeGuestWireBytes(new Uint8Array(32));
  return {raw:()=>new Response("{}",{headers:{"content-type":"application/octet-stream","x-kairos-guest-source-version":"2","x-kairos-guest-read-receipt":receipt}}),ack:()=>Response.json({ok:true,schemaVersion:2,requestId:id,checkedAt,operation,courseId})};
}

beforeEach(()=>vi.stubGlobal("fetch",vi.fn(()=>{throw new Error("Unexpected default fetch");})));
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
const cases=[
  {method:"bootstrap",path:"/api/guest/session",input:{schemaVersion:1,requestId,turnstileToken:secret},response:{...base,expiresAt:"2026-10-24T12:30:00.000Z"}},
  {method:"canvasFeed",path:"/api/guest/sources/canvas/feed",input:{schemaVersion:1,requestId,feedUrl:secret},response:{...base,assignments:[],report:{skippedCount:0,malformedCount:0,partial:false}}},
  {method:"edCourses",path:"/api/guest/sources/ed/courses",input:{schemaVersion:1,requestId,token:secret},response:{...base,courses:[]}},
  {method:"edLessons",path:"/api/guest/sources/ed/lessons",input:{schemaVersion:1,requestId,token:secret,courseId:"12"},response:{...base,courseId:"12",lessons:[]}},
] as const;
describe("guest same-origin transient client",()=>{
  it.each(cases)("sends complete $method body only to the fixed path",async({method,path,input,response})=>{
    const operation=method==="canvasFeed"?"canvas-feed":method==="edCourses"?"ed-courses":"ed-lessons";
    const courseId=method==="edLessons"?"12":null;
    const fixture=sourceFixture(operation,courseId);
    const fetchImpl=vi.fn<typeof fetch>();
    if(method==="bootstrap")fetchImpl.mockResolvedValueOnce(Response.json(response));
    else fetchImpl.mockResolvedValueOnce(fixture.raw()).mockResolvedValueOnce(fixture.ack());
    const client=createGuestTransientClient({fetchImpl,parseSource:vi.fn().mockResolvedValue(response)});
    const invoke=client[method] as (input:typeof cases[number]["input"],signal:AbortSignal)=>Promise<unknown>;
    await expect(invoke(input,signal)).resolves.toEqual(response);
    expect(fetchImpl.mock.calls[0][0]).toBe(path);
    expect(fetchImpl.mock.calls[0][1]).toEqual(expect.objectContaining({method:"POST",credentials:"same-origin",cache:"no-store",redirect:"error",headers:{"Content-Type":"application/json"},body:JSON.stringify(method==="bootstrap"?input:{...input,schemaVersion:2})}));
    expect(fetchImpl).toHaveBeenCalledTimes(method==="bootstrap"?1:2);
    expect(String(fetchImpl.mock.calls[0][0])).not.toContain(secret);
    expect(fetch).toHaveBeenCalledTimes(0);
  });
  it("ends with strict empty JSON and validates the existing end response",async()=>{
    const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(Response.json({ok:true}));
    await expect(createGuestTransientClient({fetchImpl}).endSession(signal)).resolves.toEqual({ok:true});
    expect(fetchImpl).toHaveBeenCalledWith("/api/guest/session/end",expect.objectContaining({body:"{}",redirect:"error",signal}));
  });
  it.each([
    {status:401,code:"GUEST_SESSION_REQUIRED",message:"Start a guest session to continue."},
    {status:422,code:"ED_AUTH_INVALID",message:"Update your Ed API token and try again."},
  ])("preserves $code without redirect or source retry",async({status,code,message})=>{
    const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(Response.json({ok:false,code,message},{status}));
    await expect(createGuestTransientClient({fetchImpl}).edCourses({schemaVersion:1,requestId,token:secret},signal)).rejects.toMatchObject({code,message});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).toBe("/api/guest/sources/ed/courses");
  });
  it.each([
    {...base,requestId:guestUuid(11),courses:[]},
    {...base,courses:[],unknown:secret},
    {ok:false,code:"ED_AUTH_INVALID",message:secret},
    {ok:false,code:secret,message:secret},
  ])("rejects uncorrelated, extra or unsafe parser fields before approval",async response=>{
    const fixture=sourceFixture("ed-courses"),fetchImpl=vi.fn<typeof fetch>().mockResolvedValueOnce(fixture.raw()).mockResolvedValueOnce(fixture.ack());
    const parseSource=vi.fn().mockResolvedValue(response);
    await expect(createGuestTransientClient({fetchImpl,parseSource}).edCourses({schemaVersion:1,requestId,token:secret},signal)).rejects.toMatchObject({code:"INVALID_RESULT",message:"The source returned an invalid result."});
    expect(parseSource).toHaveBeenCalledOnce();expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each([{ok:false,code:"ED_AUTH_INVALID",message:secret},{ok:false,code:secret,message:secret}])("rejects unsafe server error copy before parsing",async response=>{
    const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(Response.json(response,{status:422})),parseSource=vi.fn();
    await expect(createGuestTransientClient({fetchImpl,parseSource}).edCourses({schemaVersion:1,requestId,token:secret},signal)).rejects.toMatchObject({code:"INVALID_RESULT",message:"The source returned an invalid result."});
    expect(parseSource).not.toHaveBeenCalled();expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("rejects a schema-valid Ed response for another course before approval",async()=>{
    const fixture=sourceFixture("ed-lessons","12"),fetchImpl=vi.fn<typeof fetch>().mockResolvedValueOnce(fixture.raw()).mockResolvedValueOnce(fixture.ack());
    const parseSource=vi.fn().mockResolvedValue({...base,courseId:"13",lessons:[]});
    await expect(createGuestTransientClient({fetchImpl,parseSource}).edLessons({schemaVersion:1,requestId,token:secret,courseId:"12"},signal)).rejects.toMatchObject({code:"INVALID_RESULT"});
    expect(parseSource).toHaveBeenCalledOnce();expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each([new Response(null,{status:302,headers:{location:"/sign-in"}}),new Response(secret),Response.json({...base,courses:[]},{status:500})])("rejects redirect, non-JSON and status-inconsistent success safely",async response=>{
    const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(response);
    await expect(createGuestTransientClient({fetchImpl}).edCourses({schemaVersion:1,requestId,token:secret},signal)).rejects.toMatchObject({code:"INVALID_RESULT",message:"The source returned an invalid result."});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("uses fixed errors on fetch failure without leaking the secret",async()=>{
    const fetchImpl=vi.fn<typeof fetch>().mockRejectedValue(new Error(secret));
    await expect(createGuestTransientClient({fetchImpl}).edCourses({schemaVersion:1,requestId,token:secret},signal)).rejects.toMatchObject({code:"SERVICE_UNAVAILABLE",message:"This service is temporarily unavailable."});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("does not dispatch invalid inputs or pre-aborted requests",async()=>{
    const fetchImpl=vi.fn<typeof fetch>();
    const client=createGuestTransientClient({fetchImpl});
    await expect(client.edCourses({schemaVersion:1,requestId,token:""},signal)).rejects.toMatchObject({code:"BAD_REQUEST"});
    const aborted=new AbortController();aborted.abort(secret);
    await expect(client.edCourses({schemaVersion:1,requestId,token:secret},aborted.signal)).rejects.toMatchObject({code:"GUEST_INTERRUPTED"});
    expect(fetchImpl).toHaveBeenCalledTimes(0);
  });
  it.each([
    {name:"original request and course",responseRequestId:requestId,responseCourseId:"12",accepted:true},
    {name:"mutated request ID",responseRequestId:guestUuid(11),responseCourseId:"12",accepted:false},
    {name:"mutated course ID",responseRequestId:requestId,responseCourseId:"13",accepted:false},
  ])("uses the dispatched snapshot after caller mutation: $name",async({responseRequestId,responseCourseId,accepted})=>{
    let finish!:(response:Response)=>void;
    const fixture=sourceFixture("ed-lessons","12"),fetchImpl=vi.fn<typeof fetch>().mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValueOnce(fixture.ack());
    const dto={...base,requestId:responseRequestId,courseId:responseCourseId,lessons:[]},parseSource=vi.fn().mockResolvedValue(dto);
    const input={schemaVersion:1 as const,requestId,token:secret,courseId:"12"};
    const result=createGuestTransientClient({fetchImpl,parseSource}).edLessons(input,signal);
    input.requestId=guestUuid(11);input.courseId="13";finish(fixture.raw());
    if(accepted)await expect(result).resolves.toEqual(dto);else await expect(result).rejects.toMatchObject({code:"INVALID_RESULT"});
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({schemaVersion:2,requestId,token:secret,courseId:"12"});
    expect(parseSource).toHaveBeenCalledOnce();expect(parseSource.mock.calls[0][0]).toEqual({operation:"ed-lessons",requestId,checkedAt,courseId:"12",bytes:expect.any(ArrayBuffer)});
    expect(fetchImpl).toHaveBeenCalledTimes(accepted?2:1);
    if(accepted)expect(fetchImpl.mock.calls[1][0]).toBe("/api/guest/sources/approve");
  });
});
