import { describe, expect, it } from "vitest";
import {
  gradescopeAssignmentV1Schema,
  gradescopeDiscoverResultV1Schema,
  gradescopeSyncRequestV1Schema,
  gradescopeSyncResultV1Schema,
} from "@/lib/extension-protocol/gradescope";
import { kairosBridgeRequestV1Schema } from "@/lib/extension-protocol/bridge";

const requestId="11111111-1111-4111-8111-111111111111";
const course={
  courseId:"123",
  shortName:"CSE 331",
  fullName:"Software Design",
  term:"Autumn",
  year:"2026",
};
const assignment={
  courseId:"123",
  assignmentId:"456",
  title:"Homework 3",
  releaseAt:"2026-10-01T17:00:00.000Z",
  dueAt:"2026-10-08T06:59:00.000Z",
  lateDueAt:"2026-10-10T06:59:00.000Z",
  sourceStatusText:"8.5 / 10",
  state:"graded",
  isLate:false,
  isMissing:false,
  submittedAt:null,
  gradeScore:"8.5",
  gradeMax:"10",
  gradeDisplay:"8.5 / 10",
  checkedAt:"2026-10-04T20:00:00.000Z",
  extractorVersion:"gradescope-html-v1",
};

describe("Gradescope protocol",()=>{
  it("accepts strict normalized course discovery and enforces the 50-course limit",()=>{
    expect(gradescopeDiscoverResultV1Schema.safeParse({
      protocolVersion:1,requestId,courses:[course],errorCode:null,
      discoveryDiagnostics:{
        accountRootDetected:true,
        createCourseControlDetected:false,
        headings:{courses:1,studentCourses:0,instructorCourses:0,other:0},
        courseListDescendantCount:1,
        courseListDirectCount:1,
        termDescendantCount:1,
        courseAnchorDescendantCount:1,
        shortNameNodeCount:1,
        fullNameNodeCount:1,
      },
    }).success).toBe(true);
    expect(gradescopeDiscoverResultV1Schema.safeParse({
      protocolVersion:1,requestId,
      courses:Array.from({length:51},(_,i)=>({...course,courseId:String(i+1)})),
      errorCode:null,
    }).success).toBe(false);
  });

  it.each([0,1,3,50])("accepts %i discovered courses",count=>{
    expect(gradescopeDiscoverResultV1Schema.safeParse({
      protocolVersion:1,
      requestId,
      courses:Array.from({length:count},(_,i)=>({...course,courseId:String(i+1)})),
      errorCode:null,
    }).success).toBe(true);
  });

  it.each([0,1,7])("accepts a course with %i assignments",count=>{
    expect(gradescopeSyncResultV1Schema.safeParse({
      protocolVersion:1,
      requestId,
      courses:[{
        courseId:"123",
        checkedAt:"2026-10-04T20:00:00.000Z",
        assignments:Array.from({length:count},(_,i)=>({...assignment,assignmentId:String(i+1)})),
        errorCode:null,
      }],
      errorCode:null,
    }).success).toBe(true);
  });

  it("rejects identifying text inside discovery diagnostics",()=>{
    expect(gradescopeDiscoverResultV1Schema.safeParse({
      protocolVersion:1,requestId,courses:[],errorCode:null,
      discoveryDiagnostics:{
        accountRootDetected:true,
        createCourseControlDetected:false,
        headings:{courses:1,studentCourses:0,instructorCourses:0,other:0},
        courseListDescendantCount:1,
        courseListDirectCount:1,
        termDescendantCount:1,
        courseAnchorDescendantCount:1,
        shortNameNodeCount:1,
        fullNameNodeCount:1,
        headingText:"My private course",
      },
    }).success).toBe(false);
  });

  it("accepts at most 20 decimal selected course identifiers",()=>{
    expect(gradescopeSyncRequestV1Schema.safeParse({
      protocolVersion:1,requestId,courseIds:["123","456"],
    }).success).toBe(true);
    expect(gradescopeSyncRequestV1Schema.safeParse({
      protocolVersion:1,requestId,courseIds:["12x"],
    }).success).toBe(false);
    expect(gradescopeSyncRequestV1Schema.safeParse({
      protocolVersion:1,requestId,courseIds:Array.from({length:21},(_,i)=>String(i+1)),
    }).success).toBe(false);
  });

  it.each(["8.5","10","0.25"])("accepts decimal grade %s",(value)=>{
    expect(gradescopeAssignmentV1Schema.safeParse({...assignment,gradeScore:value}).success).toBe(true);
  });

  it.each(["NaN","Infinity","1e3","8 points"])("rejects non-decimal grade %s",(value)=>{
    expect(gradescopeAssignmentV1Schema.safeParse({...assignment,gradeScore:value}).success).toBe(false);
  });

  it("rejects sensitive or arbitrary fields",()=>{
    for(const extra of [
      {url:"https://evil.example"},
      {cookie:"secret"},
      {headers:{authorization:"secret"}},
      {authorization:"secret"},
      {csrfToken:"secret"},
      {html:"<html>private</html>"},
      {body:"private"},
    ]){
      expect(gradescopeAssignmentV1Schema.safeParse({...assignment,...extra}).success).toBe(false);
    }
  });

  it("limits the total normalized assignment payload to 500 records",()=>{
    const courseResult={
      courseId:"123",
      checkedAt:"2026-10-04T20:00:00.000Z",
      assignments:Array.from({length:500},(_,i)=>({...assignment,assignmentId:String(i+1)})),
      errorCode:null,
    };
    expect(gradescopeSyncResultV1Schema.safeParse({
      protocolVersion:1,requestId,courses:[courseResult],errorCode:null,
    }).success).toBe(true);
    expect(gradescopeSyncResultV1Schema.safeParse({
      protocolVersion:1,requestId,
      courses:[{...courseResult,assignments:[...courseResult.assignments,{...assignment,assignmentId:"501"}]}],
      errorCode:null,
    }).success).toBe(false);
  });

  it("accepts both Canvas and Gradescope page bridge requests",()=>{
    expect(kairosBridgeRequestV1Schema.safeParse({
      source:"kairos-page",type:"PING",protocolVersion:1,requestId,
    }).success).toBe(true);
    expect(kairosBridgeRequestV1Schema.safeParse({
      source:"kairos-page",
      type:"GRADESCOPE_DISCOVER_COURSES",
      protocolVersion:1,
      requestId,
      payload:{protocolVersion:1,requestId},
    }).success).toBe(true);
  });
});
