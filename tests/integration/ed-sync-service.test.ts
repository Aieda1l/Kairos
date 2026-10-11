import { describe, expect, it, vi } from "vitest";
import { openDatabase } from "../helpers/legacy-db";
import { migrate } from "../helpers/legacy-db";
import { SourceConnectionRepository } from "@/lib/db/repositories/source-connections";
import { SourceCredentialRepository } from "@/lib/db/repositories/source-credentials";
import { SourceCourseRepository } from "@/lib/db/repositories/source-courses";
import { AssignmentRepository } from "@/lib/db/repositories/assignments";
import { SubmissionStatusRepository } from "@/lib/db/repositories/submission-status";
import { syncEdConnection } from "@/lib/ed/sync-service";

function setup(courseIds=["123"]){
  const db=openDatabase(":memory:"); migrate(db);
  const connection=new SourceConnectionRepository(db).upsertEd("Ed");
  new SourceCredentialRepository(db).setEdApiToken(connection.id,"fixture-ed-token-never-echo");
  const courses=new SourceCourseRepository(db);
  courses.upsertDiscovered(connection.id,courseIds.map(id=>({
    externalCourseId:id,
    shortName:`CSE ${id}`,
    fullName:`Course ${id}`,
    term:"Autumn",
    year:"2026",
  })),"2026-10-05T10:00:00.000Z");
  courses.setEnabled(connection.id,courseIds);
  return {db,connection};
}

function lessons(...items:unknown[]){
  return new Response(JSON.stringify({modules:[],lessons:items}),{status:200,headers:{"content-type":"application/json"}});
}

describe("syncEdConnection",()=>{
  it("syncs only enabled visible lessons, including undated lessons, and is idempotent",async()=>{
    const {db,connection}=setup(["123","456"]);
    new SourceCourseRepository(db).setEnabled(connection.id,["123"]);
    const fetchImpl=vi.fn(async(input:RequestInfo|URL)=>{
      expect(String(input)).toContain("/courses/123/lessons");
      return lessons(
        {id:10,course_id:123,title:"Dated",status:"unattempted",is_hidden:false,is_unlisted:false,effective_due_at:"2026-10-10T10:00:00Z"},
        {id:11,course_id:123,title:"Undated",status:"attempted",is_hidden:false,is_unlisted:false,due_at:null},
        {id:12,course_id:123,title:"Hidden",status:"unattempted",is_hidden:true,is_unlisted:false},
      );
    });

    const first=await syncEdConnection(db,{fetchImpl:fetchImpl as typeof fetch,now:new Date("2026-10-05T12:00:00Z")});
    expect(first).toMatchObject({insertedCount:2,updatedCount:0,failedCourseCount:0,lastErrorCode:null});
    const rows=new AssignmentRepository(db).list({source:"ed"});
    expect(rows.map(row=>({title:row.title,dueAt:row.dueAt}))).toEqual([
      {title:"Dated",dueAt:"2026-10-10T10:00:00Z"},
      {title:"Undated",dueAt:null},
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const second=await syncEdConnection(db,{fetchImpl:fetchImpl as typeof fetch,now:new Date("2026-10-05T12:05:00Z")});
    expect(second).toMatchObject({insertedCount:0,updatedCount:2,failedCourseCount:0,lastErrorCode:null});
    expect(new AssignmentRepository(db).list({source:"ed"})).toHaveLength(2);
    db.close();
  });

  it("writes completed lessons as resolved submission status and leaves other progress unknown",async()=>{
    const {db}=setup();
    const fetchImpl=vi.fn(async()=>lessons(
      {id:20,course_id:123,title:"Completed",status:"completed",is_hidden:false,is_unlisted:false,effective_due_at:"2026-10-10T10:00:00Z"},
      {id:21,course_id:123,title:"Attempted",status:"attempted",is_hidden:false,is_unlisted:false,effective_due_at:"2026-10-11T10:00:00Z"},
    ));
    const result=await syncEdConnection(db,{fetchImpl:fetchImpl as typeof fetch,now:new Date("2026-10-05T12:00:00Z")});
    expect(result.statusUpdatedCount).toBe(2);
    const rows=new AssignmentRepository(db).list({source:"ed"});
    expect(rows.find(row=>row.externalId==="20")?.submissionStatus).toMatchObject({state:"submitted",isLate:false,isMissing:false,extractorVersion:"ed-api-v1"});
    expect(rows.find(row=>row.externalId==="21")?.submissionStatus).toMatchObject({state:"unknown"});
    db.close();
  });

  it("counts a successful empty course during partial sync and preserves failed-course data",async()=>{
    const {db,connection}=setup(["123","456"]);
    new AssignmentRepository(db).upsertMany(connection.id,[{
      source:"ed",externalId:"old-456",courseId:"456",courseName:"CSE 456",title:"Previously known",
      releaseAt:null,dueAt:"2026-10-20T10:00:00Z",lateDueAt:null,status:"pending",sourceStatusText:"unattempted",
      gradeScore:null,gradeMax:null,gradeDisplay:null,sourceUrl:null,sourceUpdatedAt:null,
    }],"2026-10-04T12:00:00Z");

    const fetchImpl=vi.fn(async(input:RequestInfo|URL)=>{
      const url=String(input);
      if(url.includes("/courses/123/lessons"))return lessons();
      return new Response("",{status:404});
    });

    const result=await syncEdConnection(db,{fetchImpl:fetchImpl as typeof fetch,now:new Date("2026-10-05T12:00:00Z")});
    expect(result).toMatchObject({failedCourseCount:1,lastErrorCode:"PARTIAL_SYNC",lastSuccessfulAt:"2026-10-05T12:00:00.000Z"});
    expect(new AssignmentRepository(db).list({source:"ed"}).find(row=>row.externalId==="old-456")?.title).toBe("Previously known");
    expect(new SourceConnectionRepository(db).getByKind("ed")).toMatchObject({lastSyncStatus:"success",lastErrorCode:"PARTIAL_SYNC"});
    db.close();
  });

  it("preserves all prior data and successful freshness when every course fails",async()=>{
    const {db,connection}=setup(["123"]);
    new AssignmentRepository(db).upsertMany(connection.id,[{
      source:"ed",externalId:"old-123",courseId:"123",courseName:"CSE 123",title:"Saved",
      releaseAt:null,dueAt:null,lateDueAt:null,status:"pending",sourceStatusText:"unattempted",
      gradeScore:null,gradeMax:null,gradeDisplay:null,sourceUrl:null,sourceUpdatedAt:null,
    }],"2026-10-04T12:00:00Z");
    const statuses=new SubmissionStatusRepository(db);
    statuses.markAttempt(connection.id,"2026-10-04T12:00:00Z");
    statuses.applyCompletion(connection.id,[],0,null,"2026-10-04T12:00:01Z",1);

    const fetchImpl=vi.fn(async()=>new Response("",{status:429}));
    const result=await syncEdConnection(db,{fetchImpl:fetchImpl as typeof fetch,now:new Date("2026-10-05T12:00:00Z")});
    expect(result).toMatchObject({failedCourseCount:1,lastErrorCode:"ED_RATE_LIMITED",lastSuccessfulAt:"2026-10-04T12:00:01Z"});
    expect(new AssignmentRepository(db).list({source:"ed"}).find(row=>row.externalId==="old-123")?.title).toBe("Saved");
    expect(new SourceConnectionRepository(db).getByKind("ed")).toMatchObject({lastSyncStatus:"error",lastErrorCode:"ED_RATE_LIMITED"});
    db.close();
  });

  it("rejects missing configuration and zero enabled courses",async()=>{
    const db=openDatabase(":memory:"); migrate(db);
    await expect(syncEdConnection(db)).rejects.toMatchObject({code:"ED_NOT_CONNECTED"});

    const connection=new SourceConnectionRepository(db).upsertEd("Ed");
    new SourceCredentialRepository(db).setEdApiToken(connection.id,"token");
    await expect(syncEdConnection(db)).rejects.toMatchObject({code:"ED_NO_COURSES_ENABLED"});
    db.close();
  });
});
