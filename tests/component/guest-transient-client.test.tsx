// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {createGuestTransientClient} from "@/lib/guest/sync/transient-client";
import {guestUuid} from "../helpers/guest-fixtures";

const requestId=guestUuid(10),checkedAt="2026-10-24T12:00:00.000Z",secret="guest-secret-marker";
const base={ok:true,schemaVersion:1,requestId,checkedAt};
const signal=new AbortController().signal;
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
    const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(Response.json(response));
    const client=createGuestTransientClient({fetchImpl});
    // The table deliberately covers all concrete typed signatures.
    const invoke=client[method] as (input:typeof cases[number]["input"],signal:AbortSignal)=>Promise<unknown>;
    await expect(invoke(input,signal)).resolves.toEqual(response);
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(path,{method:"POST",credentials:"same-origin",cache:"no-store",redirect:"error",
      headers:{"Content-Type":"application/json"},body:JSON.stringify(input),signal});
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
  ])("rejects uncorrelated, extra or unsafe response fields with fixed copy",async response=>{
    const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(Response.json(response));
    await expect(createGuestTransientClient({fetchImpl}).edCourses({schemaVersion:1,requestId,token:secret},signal)).rejects.toMatchObject({code:"INVALID_RESULT",message:"The source returned an invalid result."});
  });
  it("rejects a schema-valid Ed response for another course",async()=>{
    const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(Response.json({...base,courseId:"13",lessons:[]}));
    await expect(createGuestTransientClient({fetchImpl}).edLessons({schemaVersion:1,requestId,token:secret,courseId:"12"},signal)).rejects.toMatchObject({code:"INVALID_RESULT"});
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
  it.each([requestId,guestUuid(11)])("correlates the response against the dispatched body despite caller mutation (%s)",async responseRequestId=>{
    let finish!:(response:Response)=>void;
    const fetchImpl=vi.fn<typeof fetch>(()=>new Promise(resolve=>{finish=resolve;}));
    const input={schemaVersion:1 as const,requestId,token:secret,courseId:"12"};
    const result=createGuestTransientClient({fetchImpl}).edLessons(input,signal);
    input.requestId=guestUuid(11);input.courseId="13";
    finish(Response.json({...base,requestId:responseRequestId,courseId:"13",lessons:[]}));
    await expect(result).rejects.toMatchObject({code:"INVALID_RESULT"});
  });
});
