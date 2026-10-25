import { describe,expect,it } from "vitest";
import { guestCanvasFeedRequestSchema,guestCanvasFeedResponseSchema,guestEdCoursesRequestSchema,guestEdCoursesResponseSchema,guestEdLessonsRequestSchema,guestEdLessonsResponseSchema,guestSessionRequestSchema,guestSessionResponseSchema,guestSessionEndRequestSchema,guestApiErrorSchema } from "@/lib/guest/sources/contracts";
import { guestSnapshotFixture,guestUuid } from "../helpers/guest-fixtures";

const requestId=guestUuid(10),checkedAt="2026-10-24T12:00:00.000Z";
const validFeed={schemaVersion:1,requestId,feedUrl:"https://canvas.example.edu/feeds/calendars/user_secret.ics"};
const validEd={schemaVersion:1,requestId,token:"ed-secret",courseId:"12"};

describe("guest source DTOs",()=>{
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
    expect(()=>guestEdLessonsResponseSchema.parse({ok:true,schemaVersion:1,requestId,checkedAt,courseId:"12",lessons:lessons.slice(0,1000).map(row=>({...row,title:"界".repeat(500),sourceStatusText:"界".repeat(500)}))})).toThrow();
  });
  it("defines strict session bootstrap/end and fixed API errors",()=>{
    expect(()=>guestSessionRequestSchema.parse({schemaVersion:1,requestId,turnstileToken:"challenge"})).not.toThrow();
    expect(()=>guestSessionRequestSchema.parse({schemaVersion:1,requestId,turnstileToken:"challenge",userId:"foreign"})).toThrow();
    expect(()=>guestSessionResponseSchema.parse({ok:true,schemaVersion:1,requestId,checkedAt,expiresAt:"2026-10-24T12:30:00.000Z"})).not.toThrow();
    expect(()=>guestSessionResponseSchema.parse({ok:true,schemaVersion:1,requestId,checkedAt,expiresAt:"2026-10-24T11:30:00.000Z"})).toThrow();
    expect(guestSessionEndRequestSchema.parse({})).toEqual({});
    expect(()=>guestSessionEndRequestSchema.parse({token:"secret"})).toThrow();
    expect(()=>guestApiErrorSchema.parse({ok:false,schemaVersion:1,requestId,code:"RATE_LIMITED"})).not.toThrow();
    expect(()=>guestApiErrorSchema.parse({ok:false,schemaVersion:1,requestId,code:"arbitrary secret"})).toThrow();
    expect(()=>guestApiErrorSchema.parse({ok:false,schemaVersion:1,requestId,code:"BAD_REQUEST",message:"upstream secret"})).toThrow();
  });
});
