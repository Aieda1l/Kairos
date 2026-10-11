import { describe, expect, it } from "vitest";
import { openDatabase } from "../helpers/legacy-db";
import { migrate } from "../helpers/legacy-db";
import { AssignmentRepository } from "@/lib/db/repositories/assignments";
import { SourceConnectionRepository } from "@/lib/db/repositories/source-connections";
import { SourceCourseRepository } from "@/lib/db/repositories/source-courses";
import { SubmissionStatusRepository } from "@/lib/db/repositories/submission-status";
import {
  completeGradescopeSync,
  startGradescopeSync,
  GradescopeSyncServiceError,
} from "@/lib/gradescope/sync-service";
import { resetGradescopeRequestRegistryForTests } from "@/lib/gradescope/request-registry";

const courseRows=[
  {externalCourseId:"123",shortName:"CSE 331",fullName:"Software Design",term:"Autumn",year:"2026"},
  {externalCourseId:"456",shortName:"MATH 308",fullName:"Linear Algebra",term:"Autumn",year:"2026"},
];

function setup(enabled=["123","456"]){
  resetGradescopeRequestRegistryForTests();
  const db=openDatabase(":memory:");
  migrate(db);
  const connection=new SourceConnectionRepository(db).upsertGradescope("Gradescope");
  const courses=new SourceCourseRepository(db);
  courses.upsertDiscovered(connection.id,courseRows,"2026-10-05T04:00:00.000Z");
  courses.setEnabled(connection.id,enabled);
  return {db,connection,courses,assignments:new AssignmentRepository(db),statuses:new SubmissionStatusRepository(db)};
}

const assignment=(overrides:Record<string,unknown>={})=>({
  courseId:"123",
  assignmentId:"9001",
  title:"Homework 1",
  releaseAt:"2026-10-01T16:00:00.000Z",
  dueAt:"2026-10-08T06:59:00.000Z",
  lateDueAt:"2026-10-10T06:59:00.000Z",
  sourceStatusText:"8.50 / 10",
  state:"graded" as const,
  isLate:false,
  isMissing:false,
  submittedAt:null,
  gradeScore:"8.50",
  gradeMax:"10",
  gradeDisplay:"8.50 / 10",
  checkedAt:"2026-10-05T05:05:00.000Z",
  extractorVersion:"gradescope-html-v1",
  ...overrides,
});

describe("Gradescope sync service",()=>{
  it("starts with the exact enabled courses and rejects an empty enabled set",()=>{
    const {db,connection,statuses}=setup(["456","123"]);
    const started=startGradescopeSync(db,new Date("2026-10-05T05:00:00.000Z"));
    expect([...started.courseIds].sort()).toEqual(["123","456"]);
    expect(started.maxCourseBatchSize).toBe(20);
    expect(started.protocolVersion).toBe(1);
    expect(statuses.getSyncState(connection.id).lastAttemptedAt).toBe("2026-10-05T05:00:00.000Z");
    db.close();

    const second=setup([]);
    expect(()=>startGradescopeSync(second.db,new Date("2026-10-05T05:00:00.000Z")))
      .toThrowError(expect.objectContaining({code:"GRADESCOPE_NO_COURSES_ENABLED"}));
    second.db.close();
  });

  it("persists successful course metadata/status/grades and preserves a failed course",()=>{
    const {db,connection,assignments,statuses}=setup();
    assignments.upsertMany(connection.id,[{
      source:"gradescope",externalId:"9900",courseId:"456",courseName:"MATH 308",title:"Existing",
      releaseAt:null,dueAt:"2026-10-09T06:59:00.000Z",lateDueAt:null,status:"submitted",
      sourceStatusText:"Submitted",gradeScore:null,gradeMax:null,gradeDisplay:null,
      sourceUrl:"https://www.gradescope.com/courses/456/assignments/9900",sourceUpdatedAt:null,
    }],"2026-10-04T00:00:00.000Z");
    const existing=assignments.list({source:"gradescope"}).find(item=>item.externalId==="9900")!;
    statuses.applyCompletion(connection.id,[{
      assignmentLocalId:existing.id,state:"submitted",isLate:false,isMissing:false,submittedAt:null,
      checkedAt:"2026-10-04T00:00:00.000Z",extractorVersion:"gradescope-html-v1",
    }],0,null,"2026-10-04T00:00:01.000Z");

    const started=startGradescopeSync(db,new Date("2026-10-05T05:00:00.000Z"));
    const result=completeGradescopeSync(db,{
      requestId:started.requestId,
      batches:[{
        protocolVersion:1,
        requestId:started.requestId,
        courses:[
          {courseId:"123",checkedAt:"2026-10-05T05:05:00.000Z",assignments:[assignment()],errorCode:null,parseDiagnosticCounts:[]},
          {courseId:"456",checkedAt:"2026-10-05T05:05:00.000Z",assignments:[],errorCode:"GRADESCOPE_NETWORK_ERROR",diagnosticCode:"HTTP_5XX",httpStatus:503,parseDiagnosticCounts:[]},
        ],
        errorCode:"PARTIAL_SYNC",
      }],
    },new Date("2026-10-05T05:05:01.000Z"));

    expect(result).toMatchObject({insertedCount:1,updatedCount:0,failedCourseCount:1,lastErrorCode:"PARTIAL_SYNC"});
    const imported=assignments.list({source:"gradescope"}).find(item=>item.externalId==="9001")!;
    expect(imported).toMatchObject({
      courseId:"123",courseName:"CSE 331",title:"Homework 1",
      releaseAt:"2026-10-01T16:00:00.000Z",dueAt:"2026-10-08T06:59:00.000Z",lateDueAt:"2026-10-10T06:59:00.000Z",
      status:"graded",sourceStatusText:"8.50 / 10",gradeScore:"8.50",gradeMax:"10",gradeDisplay:"8.50 / 10",
      sourceUrl:"https://www.gradescope.com/courses/123/assignments/9001",
    });
    expect(imported.submissionStatus?.state).toBe("graded");

    const preserved=assignments.list({source:"gradescope"}).find(item=>item.externalId==="9900")!;
    expect(preserved).toMatchObject({title:"Existing",sourceStatusText:"Submitted"});
    expect(preserved.submissionStatus?.state).toBe("submitted");
    expect(statuses.getSyncState(connection.id).lastSuccessfulAt).toBe("2026-10-05T05:05:01.000Z");
    db.close();
  });

  it("returns anonymous error-code and page-structure diagnostics for failed courses",()=>{
    const {db}=setup();
    const started=startGradescopeSync(db,new Date("2026-10-05T05:00:00.000Z"));
    const result=completeGradescopeSync(db,{
      requestId:started.requestId,
      batches:[{
        protocolVersion:1,
        requestId:started.requestId,
        courses:[
          {courseId:"123",checkedAt:"2026-10-05T05:05:00.000Z",assignments:[assignment()],errorCode:null,parseDiagnosticCounts:[]},
          {
            courseId:"456",
            checkedAt:"2026-10-05T05:05:00.000Z",
            assignments:[],
            errorCode:"GRADESCOPE_PARSE_ERROR",
            parseDiagnosticCounts:[],
            assignmentDiagnostics:{
              courseRootDetected:true,
              tableCount:0,
              roleRowCount:0,
              assignmentLinkCount:0,
              submitButtonCount:0,
              assignmentTableDetected:false,
            },
          },
        ],
        errorCode:"PARTIAL_SYNC",
      }],
    },new Date("2026-10-05T05:05:01.000Z"));

    expect(result.failureErrorCodes).toEqual([{code:"GRADESCOPE_PARSE_ERROR",count:1}]);
    expect(result.failureStructures).toEqual([{
      errorCode:"GRADESCOPE_PARSE_ERROR",
      diagnostics:{
        courseRootDetected:true,
        tableCount:0,
        roleRowCount:0,
        assignmentLinkCount:0,
        submitButtonCount:0,
        assignmentTableDetected:false,
      },
    }]);
    expect(JSON.stringify(result)).not.toContain("456");
    db.close();
  });

  it("rejects a missing or unexpected course result and records invalid-result state",()=>{
    const {db,connection,statuses}=setup();
    const started=startGradescopeSync(db,new Date("2026-10-05T05:00:00.000Z"));
    expect(()=>completeGradescopeSync(db,{
      requestId:started.requestId,
      batches:[{
        protocolVersion:1,requestId:started.requestId,
        courses:[{courseId:"123",checkedAt:"2026-10-05T05:05:00.000Z",assignments:[],errorCode:null,parseDiagnosticCounts:[]}],
        errorCode:null,
      }],
    },new Date("2026-10-05T05:05:01.000Z"))).toThrowError(
      expect.objectContaining({code:"INVALID_RESULT"}) as GradescopeSyncServiceError,
    );
    expect(statuses.getSyncState(connection.id)).toMatchObject({lastSuccessfulAt:null,lastErrorCode:"INVALID_RESULT"});
    db.close();
  });

  it("advances freshness for a successfully checked empty course",()=>{
    const {db,connection,statuses}=setup(["123"]);
    const started=startGradescopeSync(db,new Date("2026-10-05T05:00:00.000Z"));
    completeGradescopeSync(db,{
      requestId:started.requestId,
      batches:[{
        protocolVersion:1,requestId:started.requestId,
        courses:[{courseId:"123",checkedAt:"2026-10-05T05:05:00.000Z",assignments:[],errorCode:null,parseDiagnosticCounts:[]}],
        errorCode:null,
      }],
    },new Date("2026-10-05T05:05:01.000Z"));
    expect(statuses.getSyncState(connection.id).lastSuccessfulAt).toBe("2026-10-05T05:05:01.000Z");
    db.close();
  });

  it("does not let an older Gradescope check overwrite newer metadata or submission state",()=>{
    const {db,assignments}=setup(["123"]);
    const first=startGradescopeSync(db,new Date("2026-10-05T05:00:00.000Z"));
    completeGradescopeSync(db,{
      requestId:first.requestId,
      batches:[{protocolVersion:1,requestId:first.requestId,courses:[{
        courseId:"123",checkedAt:"2026-10-05T05:05:00.000Z",assignments:[assignment({title:"Newer",checkedAt:"2026-10-05T05:05:00.000Z"})],errorCode:null,parseDiagnosticCounts:[],
      }],errorCode:null}],
    },new Date("2026-10-05T05:05:01.000Z"));

    const second=startGradescopeSync(db,new Date("2026-10-05T05:06:00.000Z"));
    completeGradescopeSync(db,{
      requestId:second.requestId,
      batches:[{protocolVersion:1,requestId:second.requestId,courses:[{
        courseId:"123",checkedAt:"2026-10-05T05:04:00.000Z",assignments:[assignment({
          title:"Older",state:"not_submitted",sourceStatusText:"Not Submitted",gradeScore:null,gradeMax:null,gradeDisplay:null,
          checkedAt:"2026-10-05T05:04:00.000Z",
        })],errorCode:null,parseDiagnosticCounts:[],
      }],errorCode:null}],
    },new Date("2026-10-05T05:06:01.000Z"));

    const stored=assignments.list({source:"gradescope"}).find(item=>item.externalId==="9001")!;
    expect(stored.title).toBe("Newer");
    expect(stored.gradeScore).toBe("8.50");
    expect(stored.submissionStatus?.state).toBe("graded");
    expect(stored.submissionStatus?.checkedAt).toBe("2026-10-05T05:05:00.000Z");
    db.close();
  });
});
