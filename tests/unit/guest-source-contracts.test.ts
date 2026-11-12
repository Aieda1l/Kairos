import { describe,expect,it } from "vitest";
import { validateGuestCanvasFeedResponse,validateGuestEdCoursesResponse,validateGuestEdLessonsResponse,guestCanvasFeedRequestSchema,guestCanvasFeedResponseSchema,guestEdCoursesRequestSchema,guestEdCoursesResponseSchema,guestEdLessonsRequestSchema,guestEdLessonsResponseSchema,guestSessionRequestSchema,guestSessionResponseSchema,guestSessionEndRequestSchema,guestApiErrorSchema } from "@/lib/guest/sources/contracts";
import {GUEST_ED_COURSES_MAX_OUTPUT_BYTES,guestJsonBytes} from "@/lib/guest/limits";
import { guestSnapshotFixture,guestUuid } from "../helpers/guest-fixtures";

const requestId=guestUuid(10),checkedAt="2026-10-24T12:00:00.000Z";
const validFeed={schemaVersion:1,requestId,feedUrl:"https://canvas.example.edu/feeds/calendars/user_secret.ics"};
const validEd={schemaVersion:1,requestId,token:"ed-secret",courseId:"12"};

describe("guest source DTOs",()=>{
  it("bounds the returned clone when nonenumerable toJSON conceals oversized courses",()=>{
    const response={ok:true,schemaVersion:1,requestId,checkedAt,courses:Array.from({length:500},(_,i)=>({externalCourseId:String(i),shortName:"\u754c".repeat(160),fullName:"\u754c".repeat(240),term:"\u754c".repeat(80),year:"\u754c".repeat(16)}))};
    expect(guestJsonBytes(response)).toBeGreaterThan(GUEST_ED_COURSES_MAX_OUTPUT_BYTES);
    Object.defineProperty(response,"toJSON",{value:()=>({}),enumerable:false});
    expect(guestJsonBytes(response)).toBe(2);
    expect(guestEdCoursesResponseSchema.safeParse(response).success).toBe(false);
    expect(validateGuestEdCoursesResponse(response)).toEqual({success:false,reason:"oversize"});
  });
  it("bounds the returned clone when a courses getter changes between reads",()=>{
    const oversized=Array.from({length:500},(_,i)=>({externalCourseId:String(i),shortName:"\u754c".repeat(160),fullName:"\u754c".repeat(240),term:"\u754c".repeat(80),year:"\u754c".repeat(16)}));
    let reads=0;
    const response={ok:true,schemaVersion:1,requestId,checkedAt,get courses(){return ++reads===1?[]:oversized;}};
    const validated=validateGuestEdCoursesResponse(response);
    expect(reads).toBeGreaterThan(0);
    if(validated.success){
      expect(guestJsonBytes(validated.data)).toBeLessThanOrEqual(GUEST_ED_COURSES_MAX_OUTPUT_BYTES);
      expect(guestEdCoursesResponseSchema.safeParse(validated.data).success).toBe(true);
    }
  });
  it("retains oversize precedence for ordinary invalid JSON DTOs",()=>{
    const response={ok:true,schemaVersion:1,requestId,checkedAt,courses:[],secret:"x".repeat(GUEST_ED_COURSES_MAX_OUTPUT_BYTES)};
    expect(guestEdCoursesResponseSchema.safeParse(response).success).toBe(false);
    expect(validateGuestEdCoursesResponse(response)).toEqual({success:false,reason:"oversize"});
  });
  it("keeps server helpers and public schemas aligned on strict shapes and returns validated clones",()=>{
    const {id,firstSeenAt,lastSeenAt,metadataCheckedAt,sourceConnectionId,...assignment}=guestSnapshotFixture().assignments[0];
    void id;void firstSeenAt;void lastSeenAt;void metadataCheckedAt;void sourceConnectionId;
    const envelope={ok:true,schemaVersion:1,requestId,checkedAt};
    const canvas={...envelope,assignments:[assignment],report:{skippedCount:0,malformedCount:0,partial:false}};
    const course={externalCourseId:"12",shortName:"Math",fullName:"Mathematics",term:null,year:null};
    const courses={...envelope,courses:[course]};
    const {courseName,...fields}=assignment;void courseName;
    const lesson={...fields,source:"ed",sourceUrl:null};
    const lessons={...envelope,courseId:"12",lessons:[lesson]};
    const cases=[
      {schema:guestCanvasFeedResponseSchema,validate:validateGuestCanvasFeedResponse,valid:canvas,invalid:[
        {...canvas,assignments:[{...assignment,sourceUrl:"https://canvas.uw.edu/feeds/private.ics?token=secret"}]},
        {...canvas,assignments:[{...assignment,sourceUrl:"http://canvas.uw.edu/courses/12/assignments/1"}]},
        ...["https://canvas.uw.edu/courses/12/assignments/1?token=secret","https://canvas.uw.edu/courses/13/assignments/1","https://canvas.uw.edu:443/courses/12/assignments/1"].map(sourceUrl=>({...canvas,assignments:[{...assignment,sourceUrl}]})),
        {...canvas,assignments:[assignment,assignment]},
        ...[{skippedCount:0,malformedCount:1,partial:true},{skippedCount:1,malformedCount:0,partial:true},{skippedCount:1,malformedCount:1,partial:false},{skippedCount:5000,malformedCount:0,partial:false}].map(report=>({...canvas,report})),
      ]},
      {schema:guestEdCoursesResponseSchema,validate:validateGuestEdCoursesResponse,valid:courses,invalid:[{...courses,courses:[course,course]},{...courses,courses:[{...course,email:"private@example.com"}]}]},
      {schema:guestEdLessonsResponseSchema,validate:validateGuestEdLessonsResponse,valid:lessons,invalid:[{...lessons,lessons:[lesson,lesson]},{...lessons,lessons:[{...lesson,courseId:"13"}]},{...lessons,lessons:[{...lesson,sourceUrl:"https://edstem.org/us/courses/12/lessons/1"}]}]},
    ];
    for(const {schema,validate,valid,invalid} of cases){
      const parsed=validate(valid);expect(parsed.success).toBe(true);
      if(parsed.success){expect(parsed.data).toEqual(schema.parse(valid));expect(parsed.data).not.toBe(valid);}
      for(const value of [...invalid,{...valid,secret:"private"}]){
        expect(schema.safeParse(value).success).toBe(false);
        expect(validate(value)).toEqual({success:false,reason:"invalid"});
      }
    }
    const partial={...canvas,report:{skippedCount:2,malformedCount:1,partial:true}};
    expect(validateGuestCanvasFeedResponse(partial).success).toBe(guestCanvasFeedResponseSchema.safeParse(partial).success);
  });
  it("agrees at exact escaped and multibyte UTF-8 output byte boundaries and preserves oversize precedence",()=>{
    const response={ok:true,schemaVersion:1,requestId,checkedAt,courses:Array.from({length:500},(_,i)=>({externalCourseId:String(i),shortName:"x".repeat(160),fullName:"x".repeat(240),term:"x".repeat(80),year:"x".repeat(16)}))};
    // Grow valid strings using JSON escapes (six bytes) and Unicode (two bytes).
    let remaining=GUEST_ED_COURSES_MAX_OUTPUT_BYTES-guestJsonBytes(response);
    for(const course of response.courses){
      for(const field of ["shortName","fullName","term","year"] as const){
        course[field]=Array.from(course[field],char=>{
          if(remaining>=5){remaining-=5;return "\u0000";}
          if(remaining>0){remaining--;return "\u00e9";}
          return char;
        }).join("");
      }
    }
    expect(remaining).toBe(0);expect(guestJsonBytes(response)).toBe(GUEST_ED_COURSES_MAX_OUTPUT_BYTES);
    expect(guestEdCoursesResponseSchema.safeParse(response).success).toBe(true);
    expect(validateGuestEdCoursesResponse(response).success).toBe(true);
    const last=response.courses.at(-1)!;last.year="\u00e9"+last.year.slice(1);
    expect(guestJsonBytes(response)).toBe(GUEST_ED_COURSES_MAX_OUTPUT_BYTES+1);
    expect(guestEdCoursesResponseSchema.safeParse(response).success).toBe(false);
    expect(validateGuestEdCoursesResponse(response)).toEqual({success:false,reason:"oversize"});
    expect(validateGuestEdCoursesResponse({...response,secret:"private"})).toEqual({success:false,reason:"oversize"});
  });
  it("accepts only the versioned public credential/resource request fields",()=>{
    expect(guestCanvasFeedRequestSchema.parse(validFeed)).toEqual(validFeed);
    expect(guestEdCoursesRequestSchema.parse({schemaVersion:1,requestId,token:"ed-secret"})).toHaveProperty("token","ed-secret");
    expect(guestEdLessonsRequestSchema.parse(validEd)).toEqual(validEd);
    expect(()=>guestCanvasFeedRequestSchema.parse({...validFeed,userId:"foreign"})).toThrow();
    expect(()=>guestEdLessonsRequestSchema.parse({...validEd,connectionId:guestUuid(2)})).toThrow();
    expect(()=>guestEdLessonsRequestSchema.parse({...validEd,courseId:"1/../2"})).toThrow();
    expect(()=>guestEdLessonsRequestSchema.parse({...validEd,schemaVersion:2})).toThrow();
  });
  it("pins 4096/4097 secret characters and 32/33 decimal course digits",()=>{
    expect(()=>guestEdLessonsRequestSchema.parse({...validEd,token:"s".repeat(4096),courseId:"1".repeat(32)})).not.toThrow();
    for(const token of ["","s".repeat(4097)])expect(()=>guestEdLessonsRequestSchema.parse({...validEd,token})).toThrow();
    expect(()=>guestEdLessonsRequestSchema.parse({...validEd,courseId:"1".repeat(33)})).toThrow();
    const prefix="https://canvas.example.edu/feeds/calendars/";
    expect(()=>guestCanvasFeedRequestSchema.parse({...validFeed,feedUrl:prefix+"s".repeat(4096-prefix.length-4)+".ics"})).not.toThrow();
    expect(()=>guestCanvasFeedRequestSchema.parse({...validFeed,feedUrl:prefix+"s".repeat(4097-prefix.length-4)+".ics"})).toThrow();
  });
  it("enforces the UTF-8 request budget even for valid character counts",()=>{
    expect(()=>guestEdLessonsRequestSchema.parse({...validEd,token:"😀".repeat(2048)})).not.toThrow();
    expect(()=>guestEdLessonsRequestSchema.parse({...validEd,token:"\\".repeat(4096)})).not.toThrow();
    // JSON escaping and multi-byte Unicode both count toward the portable byte budget.
    expect(()=>guestEdLessonsRequestSchema.parse({...validEd,token:"\u0000".repeat(4096)})).toThrow();
  });
  it("validates Canvas parse report counts and partial state without source error text",()=>{
    const response={ok:true,schemaVersion:1,requestId,checkedAt,assignments:[],report:{skippedCount:2,malformedCount:1,partial:true}};
    expect(()=>guestCanvasFeedResponseSchema.parse(response)).not.toThrow();
    for(const report of [
      {skippedCount:0,malformedCount:1,partial:true},
      {skippedCount:2,malformedCount:0,partial:true},
      {skippedCount:2,malformedCount:1,partial:false},
      {skippedCount:5001,malformedCount:0,partial:false},
      {...response.report,errors:["secret upstream detail"]},
    ])expect(()=>guestCanvasFeedResponseSchema.parse({...response,report})).toThrow();
  });
  it("keeps normalized success responses free of local identity and raw profile data",()=>{
    const {id,firstSeenAt,lastSeenAt,metadataCheckedAt,sourceConnectionId,...assignment}=guestSnapshotFixture().assignments[0];
    const canvas={ok:true,schemaVersion:1,requestId,checkedAt,assignments:[assignment],report:{skippedCount:0,malformedCount:0,partial:false}};
    expect(()=>guestCanvasFeedResponseSchema.parse(canvas)).not.toThrow();
    expect(()=>guestCanvasFeedResponseSchema.parse({...canvas,assignments:[{...assignment,id}]})).toThrow();
    const courses={ok:true,schemaVersion:1,requestId,checkedAt,courses:[{externalCourseId:"12",shortName:"Math",fullName:"Mathematics",term:null,year:null}]};
    expect(()=>guestEdCoursesResponseSchema.parse(courses)).not.toThrow();
    expect(()=>guestEdCoursesResponseSchema.parse({...courses,user:{email:"private@example.com"}})).toThrow();
    const {courseName,...lesson}=assignment;
    const lessons={ok:true,schemaVersion:1,requestId,checkedAt,courseId:"12",lessons:[{...lesson,source:"ed",sourceUrl:null}]};
    expect(()=>guestEdLessonsResponseSchema.parse(lessons)).not.toThrow();
    expect(()=>guestEdLessonsResponseSchema.parse({...lessons,lessons:[{...lessons.lessons[0],courseId:"13"}]})).toThrow();
    expect(()=>guestEdLessonsResponseSchema.parse({...lessons,lessons:[{...lessons.lessons[0],courseName}]})).toThrow();
    void firstSeenAt;void lastSeenAt;void metadataCheckedAt;void sourceConnectionId;
  });
  it("rejects oversized result lists and output bytes",()=>{
    const course={externalCourseId:"1",shortName:null,fullName:"Math",term:null,year:null};
    expect(()=>guestEdCoursesResponseSchema.parse({ok:true,schemaVersion:1,requestId,checkedAt,courses:Array.from({length:501},(_,i)=>({...course,externalCourseId:String(i)}))})).toThrow();
    const {id,firstSeenAt,lastSeenAt,metadataCheckedAt,sourceConnectionId,...assignment}=guestSnapshotFixture().assignments[0];
    const response={ok:true,schemaVersion:1,requestId,checkedAt,report:{skippedCount:0,malformedCount:0,partial:false},assignments:Array.from({length:2000},(_,i)=>({...assignment,externalId:`event-${i}`,title:"界".repeat(500),courseName:"界".repeat(240)}))};
    expect(()=>guestCanvasFeedResponseSchema.parse(response)).toThrow();
    expect(validateGuestCanvasFeedResponse(response)).toEqual({success:false,reason:"oversize"});
    expect(validateGuestCanvasFeedResponse({...response,secret:"private"})).toEqual({success:false,reason:"oversize"});
    expect(()=>guestCanvasFeedResponseSchema.parse({...response,assignments:Array.from({length:2001},(_,i)=>({...assignment,externalId:`event-${i}`}))})).toThrow();
    void id;void firstSeenAt;void lastSeenAt;void metadataCheckedAt;void sourceConnectionId;
  });
  it("accepts exact Ed result counts and rejects lesson overflow or large discovered-course bytes",()=>{
    const course={externalCourseId:"1",shortName:null,fullName:"Math",term:null,year:null};
    const courses=Array.from({length:500},(_,i)=>({...course,externalCourseId:String(i)}));
    expect(guestEdCoursesResponseSchema.parse({ok:true,schemaVersion:1,requestId,checkedAt,courses}).courses).toHaveLength(500);
    expect(()=>guestEdCoursesResponseSchema.parse({ok:true,schemaVersion:1,requestId,checkedAt,courses:courses.map(row=>({...row,shortName:"界".repeat(160),fullName:"界".repeat(240),term:"界".repeat(80),year:"界".repeat(16)}))})).toThrow();
    const lessons=Array.from({length:1001},(_,i)=>({source:"ed",externalId:String(i),courseId:"12",title:"Lesson",releaseAt:null,dueAt:null,lateDueAt:null,status:"unknown",sourceStatusText:null,gradeScore:null,gradeMax:null,gradeDisplay:null,sourceUrl:null,sourceUpdatedAt:null}));
    expect(guestEdLessonsResponseSchema.parse({ok:true,schemaVersion:1,requestId,checkedAt,courseId:"12",lessons:lessons.slice(0,1000)}).lessons).toHaveLength(1000);
    expect(()=>guestEdLessonsResponseSchema.parse({ok:true,schemaVersion:1,requestId,checkedAt,courseId:"12",lessons})).toThrow();
    const oversizedLessons={ok:true,schemaVersion:1,requestId,checkedAt,courseId:"12",lessons:lessons.slice(0,1000).map(row=>({...row,title:"界".repeat(500),sourceStatusText:"界".repeat(500)}))};
    expect(()=>guestEdLessonsResponseSchema.parse(oversizedLessons)).toThrow();
    expect(validateGuestEdLessonsResponse(oversizedLessons)).toEqual({success:false,reason:"oversize"});
    expect(validateGuestEdLessonsResponse({...oversizedLessons,secret:"private"})).toEqual({success:false,reason:"oversize"});
  });
  it("defines strict session bootstrap/end",()=>{
    expect(()=>guestSessionRequestSchema.parse({schemaVersion:1,requestId,turnstileToken:"challenge"})).not.toThrow();
    expect(()=>guestSessionRequestSchema.parse({schemaVersion:1,requestId,turnstileToken:"challenge",userId:"foreign"})).toThrow();
    expect(()=>guestSessionResponseSchema.parse({ok:true,schemaVersion:1,requestId,checkedAt,expiresAt:"2026-10-24T12:30:00.000Z"})).not.toThrow();
    expect(()=>guestSessionResponseSchema.parse({ok:true,schemaVersion:1,requestId,checkedAt,expiresAt:"2026-10-24T11:30:00.000Z"})).toThrow();
    expect(guestSessionEndRequestSchema.parse({})).toEqual({});
    expect(()=>guestSessionEndRequestSchema.parse({token:"secret"})).toThrow();
  });
  it("accepts fixed API error copy with optional bounded retry advice",()=>{
    const error={ok:false,code:"RATE_LIMITED",message:"Too many requests. Try again later."};
    expect(guestApiErrorSchema.parse(error)).toEqual(error);
    for(const retryAfterSeconds of [1,3600]){
      expect(guestApiErrorSchema.parse({...error,retryAfterSeconds})).toEqual({...error,retryAfterSeconds});
    }
    expect(guestApiErrorSchema.parse({ok:false,code:"BAD_REQUEST",message:"This request could not be read."})).toEqual({ok:false,code:"BAD_REQUEST",message:"This request could not be read."});
  });
  it("rejects missing or mismatched error copy, unknown codes and extra envelope fields",()=>{
    const error={ok:false,code:"RATE_LIMITED",message:"Too many requests. Try again later."};
    expect(()=>guestApiErrorSchema.parse({ok:false,code:"RATE_LIMITED"})).toThrow();
    expect(()=>guestApiErrorSchema.parse({ok:false,schemaVersion:1,requestId,code:"RATE_LIMITED"})).toThrow();
    expect(()=>guestApiErrorSchema.parse({...error,message:"upstream secret"})).toThrow();
    expect(()=>guestApiErrorSchema.parse({...error,code:"BAD_REQUEST"})).toThrow();
    expect(()=>guestApiErrorSchema.parse({...error,code:"arbitrary secret"})).toThrow();
    expect(()=>guestApiErrorSchema.parse({...error,schemaVersion:1})).toThrow();
    expect(()=>guestApiErrorSchema.parse({...error,requestId})).toThrow();
  });
  it.each([0,-1,1.5,3601,Number.MAX_SAFE_INTEGER+1,Infinity,NaN,"30",null])("rejects invalid retry advice %s",retryAfterSeconds=>{
    expect(()=>guestApiErrorSchema.parse({ok:false,code:"RATE_LIMITED",message:"Too many requests. Try again later.",retryAfterSeconds})).toThrow();
  });
});
