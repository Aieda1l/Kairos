import {afterEach,describe,expect,it,vi} from "vitest";
import {readGuestEdCourses,readGuestEdLessons} from "@/lib/guest/sources/ed";
import {guestEdCoursesResponseSchema,guestEdLessonsResponseSchema} from "@/lib/guest/sources/contracts";
import {checkedAt,edCourses,edLessons,requestId,sourceContext,textResponse,token} from "../helpers/guest-source-fixtures";
const input={schemaVersion:1 as const,requestId,token};
afterEach(()=>vi.useRealTimers());
describe("bounded guest Ed readers",()=>{
  it("serializes the Ed courses output byte bound once",async()=>{
    const original=JSON.stringify;let outputSerializations=0;
    const stringify=vi.spyOn(JSON,"stringify").mockImplementation((...args:Parameters<typeof JSON.stringify>)=>{
      const value=args[0];
      if(value?.ok===true&&value.schemaVersion===1&&value.requestId===requestId&&value.checkedAt===checkedAt&&"courses" in value)outputSerializations++;
      return original(...args);
    });
    try{await readGuestEdCourses(input,sourceContext(async()=>Response.json(edCourses(1))));expect(outputSerializations).toBe(1);}finally{stringify.mockRestore();}
  });
  it("serializes the Ed lessons output byte bound once",async()=>{
    const original=JSON.stringify;let outputSerializations=0;
    const stringify=vi.spyOn(JSON,"stringify").mockImplementation((...args:Parameters<typeof JSON.stringify>)=>{
      const value=args[0];
      if(value?.ok===true&&value.schemaVersion===1&&value.requestId===requestId&&value.checkedAt===checkedAt&&"lessons" in value)outputSerializations++;
      return original(...args);
    });
    try{await readGuestEdLessons({...input,courseId:"12"},sourceContext(async()=>Response.json(edLessons(1))));expect(outputSerializations).toBe(1);}finally{stringify.mockRestore();}
  });
  it("supports 150-course discovery and excludes profile and secret properties structurally",async()=>{
    const result=await readGuestEdCourses(input,sourceContext(async()=>Response.json(edCourses(150))));
    expect(guestEdCoursesResponseSchema.safeParse(result).success).toBe(true);
    expect(result.courses).toHaveLength(150);
    expect(result.courses[0]).toEqual({externalCourseId:"1",shortName:"C1",fullName:"Course 1",term:"Autumn",year:"2026"});
    expect(Object.keys(result).sort()).toEqual(["checkedAt","courses","ok","requestId","schemaVersion"]);
    expect(JSON.stringify(result)).not.toMatch(/private|api_token|email|fixture-token/);
  });
  it("normalizes lessons without profile, course name, or raw provider properties",async()=>{
    const result=await readGuestEdLessons({...input,courseId:"12"},sourceContext(async()=>Response.json(edLessons(1))));
    expect(guestEdLessonsResponseSchema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({ok:true,schemaVersion:1,requestId,checkedAt,courseId:"12"});
    expect(result.lessons[0]).toEqual({source:"ed",externalId:"1",courseId:"12",title:"Lesson 1",releaseAt:null,dueAt:checkedAt,lateDueAt:null,status:"pending",sourceStatusText:"unattempted",gradeScore:null,gradeMax:null,gradeDisplay:null,sourceUrl:null,sourceUpdatedAt:null});
  });
  it("accepts exact course and visible lesson limits",async()=>{
    expect((await readGuestEdCourses(input,sourceContext(async()=>Response.json(edCourses(500))))).courses).toHaveLength(500);
    expect((await readGuestEdLessons({...input,courseId:"12"},sourceContext(async()=>Response.json(edLessons(1000))))).lessons).toHaveLength(1000);
  });
  it("rejects 501 raw courses, 2001 raw lessons, and 1001 visible lessons without truncating",async()=>{
    await expect(readGuestEdCourses(input,sourceContext(async()=>Response.json(edCourses(501))))).rejects.toMatchObject({code:"SOURCE_RESULT_TOO_LARGE"});
    for(const [count,hidden] of [[2001,true],[1001,false]] as const){
      await expect(readGuestEdLessons({...input,courseId:"12"},sourceContext(async()=>Response.json(edLessons(count,{is_hidden:hidden}))))).rejects.toMatchObject({code:"SOURCE_RESULT_TOO_LARGE"});
    }
    expect((await readGuestEdLessons({...input,courseId:"12"},sourceContext(async()=>Response.json(edLessons(2000,{is_hidden:true}))))).lessons).toEqual([]);
  });
  it.each([undefined,"1"])("counts streamed bytes with Content-Length %s",async length=>{
    await expect(readGuestEdCourses(input,sourceContext(async()=>textResponse(" ".repeat(2*1024*1024+1),length?{"content-length":length}:{})))).rejects.toMatchObject({code:"SOURCE_RESULT_TOO_LARGE"});
  });
  it.each([301,302,303,307,308])("never follows an Ed %i redirect or forwards the token",async status=>{
    const requests:string[]=[];
    const result=readGuestEdCourses(input,sourceContext(async(url,init)=>{requests.push(String(url));expect(init?.redirect).toBe("manual");expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${token}`);return new Response(null,{status,headers:{location:"https://elsewhere.invalid/private"}});}));
    await expect(result).rejects.toMatchObject({code:"ED_UPSTREAM_ERROR"});
    expect(requests).toEqual(["https://us.edstem.org/api/user"]);
  });
  it.each([[401,"ED_AUTH_INVALID"],[403,"ED_AUTH_INVALID"],[429,"ED_RATE_LIMITED"],[500,"ED_UPSTREAM_ERROR"]])("maps HTTP %i safely",async(status,code)=>{
    const error=await readGuestEdCourses(input,sourceContext(async()=>new Response(token,{status:status as number}))).catch(error=>error);
    expect(error).toMatchObject({code});expect(String(error)).not.toContain(token);
  });
  it("maps course 404 separately and malformed JSON to parse error",async()=>{
    await expect(readGuestEdLessons({...input,courseId:"12"},sourceContext(async()=>new Response(null,{status:404})))).rejects.toMatchObject({code:"ED_COURSE_UNAVAILABLE"});
    await expect(readGuestEdCourses(input,sourceContext(async()=>textResponse("invalid JSON")))).rejects.toMatchObject({code:"ED_PARSE_ERROR"});
  });
  it("rejects unsafe numeric Ed identifiers before conversion",async()=>{
    const courses=edCourses(1);courses.courses[0].course.id=9007199254740992;
    await expect(readGuestEdCourses(input,sourceContext(async()=>Response.json(courses)))).rejects.toMatchObject({code:"ED_PARSE_ERROR"});
    for(const field of ["id","course_id","module_id"]){
      await expect(readGuestEdLessons({...input,courseId:"12"},sourceContext(async()=>Response.json(edLessons(1,{[field]:9007199254740992}))))).rejects.toMatchObject({code:"ED_PARSE_ERROR"});
    }
  });
  it("keeps 32-digit decimal course IDs as strings and rejects path escapes before dispatch",async()=>{
    const courseId="12345678901234567890123456789012";const requests:string[]=[];
    const context=sourceContext(async url=>{requests.push(String(url));return Response.json(edLessons(1,{course_id:courseId}));});
    expect((await readGuestEdLessons({...input,courseId},context)).lessons[0].courseId).toBe(courseId);
    for(const id of ["../user","1".repeat(33)])await expect(readGuestEdLessons({...input,courseId:id},context)).rejects.toMatchObject({code:"BAD_REQUEST"});
    expect(requests).toEqual([`https://us.edstem.org/api/courses/${courseId}/lessons`]);
  });
  it("does not misclassify provider guards as network failures",async()=>{
    for(const failAt of [1,2]){
      let checks=0;const fetchImpl=vi.fn(async()=>Response.json(edCourses(1)));const context=sourceContext(fetchImpl);
      context.assertProviderCurrent=async()=>{if(++checks===failAt)throw new Error("storage unavailable");};
      await expect(readGuestEdCourses(input,context)).rejects.toMatchObject({code:"SERVICE_UNAVAILABLE"});
      expect(fetchImpl.mock.calls.length).toBe(failAt-1);
    }
  });
  it("aborts a stalled body at the whole operation deadline",async()=>{
    vi.useFakeTimers();const fetchImpl=vi.fn(async()=>new Response(new ReadableStream({pull:()=>new Promise(()=>{}),cancel:()=>new Promise(()=>{})})));
    const pending=readGuestEdCourses(input,sourceContext(fetchImpl)).catch(error=>error);
    await vi.advanceTimersByTimeAsync(15_000);expect(await pending).toMatchObject({code:"ED_NETWORK_ERROR"});expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("checks elapsed time before starting synchronous JSON parsing",async()=>{
    vi.useFakeTimers();const raw=JSON.stringify(edCourses(1));const original=TextDecoder.prototype.decode;
    const decode=vi.spyOn(TextDecoder.prototype,"decode").mockImplementation(function(this:TextDecoder,input,options){
      const text=original.call(this,input,options);if(input===undefined)vi.setSystemTime(Date.now()+15_000);return text;
    });
    const parse=vi.spyOn(JSON,"parse");
    try{
      await expect(readGuestEdCourses(input,sourceContext(async()=>textResponse(raw)))).rejects.toMatchObject({code:"ED_NETWORK_ERROR"});
      expect(parse.mock.calls.some(([text])=>text===raw)).toBe(false);
    }finally{decode.mockRestore();parse.mockRestore();}
  });
  it("rejects oversized escaped JSON output, even when the upstream body fits",async()=>{
    const raw=JSON.stringify({lessons:Array.from({length:1000},(_,i)=>({id:i+1,title:"\\".repeat(500),status:"\\".repeat(500)}))});
    expect(new TextEncoder().encode(raw).length).toBeLessThan(2*1024*1024);
    await expect(readGuestEdLessons({...input,courseId:"12"},sourceContext(async()=>textResponse(raw)))).rejects.toMatchObject({code:"SOURCE_RESULT_TOO_LARGE"});
  });
  it("rejects escaped course discovery output above 512 KiB",async()=>{
    const payload={user:{},courses:Array.from({length:500},(_,i)=>({course:{id:i+1,name:'"'.repeat(240),code:'"'.repeat(160),session:'"'.repeat(80),year:'"'.repeat(16)}}))};
    expect(new TextEncoder().encode(JSON.stringify(payload)).length).toBeLessThan(2*1024*1024);
    await expect(readGuestEdCourses(input,sourceContext(async()=>Response.json(payload)))).rejects.toMatchObject({code:"SOURCE_RESULT_TOO_LARGE"});
  });
  it("cancels an HTTP error body without awaiting stalled cleanup",async()=>{
    let cancelled=false;
    const context=sourceContext(async()=>new Response(new ReadableStream({cancel(){cancelled=true;return new Promise(()=>{});}}),{status:302,headers:{location:"https://elsewhere.invalid"}}));
    await expect(readGuestEdCourses(input,context)).rejects.toMatchObject({code:"ED_UPSTREAM_ERROR"});
    expect(cancelled).toBe(true);
  });
});
