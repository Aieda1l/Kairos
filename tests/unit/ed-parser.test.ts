import { describe, expect, it } from "vitest";
import type { SourceCourse } from "@/lib/sources/types";
import { parseEdCourses, parseEdLessons } from "@/lib/sources/ed/parser";
import { EdSourceError } from "@/lib/sources/ed/errors";

const course:SourceCourse={
  id:"local-course",
  sourceConnectionId:"ed-connection",
  externalCourseId:"123",
  shortName:"CSE 331",
  fullName:"Software Design",
  term:"Autumn",
  year:"2026",
  enabled:true,
  firstSeenAt:"",
  lastSeenAt:"",
};

describe("parseEdCourses",()=>{
  it("parses the observed /api/user enrollment shape",()=>{
    const result=parseEdCourses({
      user:{id:7,name:"Student"},
      courses:[{
        course:{id:123,code:"CSE 331",name:"Software Design",year:"2026",session:"Autumn",status:"active"},
        role:{role:"student"},
      }],
    });
    expect(result).toEqual([{
      externalCourseId:"123",
      shortName:"CSE 331",
      fullName:"Software Design",
      term:"Autumn",
      year:"2026",
    }]);
  });

  it("accepts zero courses and skips malformed sibling enrollments",()=>{
    expect(parseEdCourses({user:{id:7},courses:[]})).toEqual([]);
    expect(parseEdCourses({
      user:{id:7},
      courses:[
        {course:{id:null,name:"Broken"},role:{role:"student"}},
        {course:{id:456,code:"CSE 456",name:"Valid",year:"2026",session:"Autumn"},role:{role:"student"}},
      ],
    })).toEqual([{
      externalCourseId:"456",
      shortName:"CSE 456",
      fullName:"Valid",
      term:"Autumn",
      year:"2026",
    }]);
  });

  it("fails closed on an unrecognized user payload",()=>{
    expect(()=>parseEdCourses({user:{id:7}})).toThrowError(EdSourceError);
    try{parseEdCourses({user:{id:7}});}catch(error){expect(error).toMatchObject({code:"ED_PARSE_ERROR"});}
  });
});

describe("parseEdLessons",()=>{
  it("normalizes visible lessons and prefers effective dates",()=>{
    const result=parseEdLessons({
      modules:[{id:8,course_id:123,name:"Week 1"}],
      lessons:[{
        id:10,
        course_id:123,
        module_id:8,
        title:"Lesson 1",
        status:"completed",
        state:"active",
        is_hidden:false,
        is_unlisted:false,
        available_at:"2026-10-01T10:00:00Z",
        effective_available_at:"2026-10-02T10:00:00Z",
        due_at:"2026-10-10T10:00:00Z",
        effective_due_at:"2026-10-11T10:00:00Z",
        updated_at:"2026-10-03T10:00:00Z",
      }],
    },course);
    expect(result).toEqual([{
      externalId:"10",
      courseId:"123",
      courseName:"CSE 331",
      title:"Lesson 1",
      releaseAt:"2026-10-02T10:00:00Z",
      dueAt:"2026-10-11T10:00:00Z",
      lateDueAt:null,
      status:"submitted",
      sourceStatusText:"completed",
      gradeScore:null,
      gradeMax:null,
      gradeDisplay:null,
      sourceUrl:null,
      sourceUpdatedAt:"2026-10-03T10:00:00Z",
    }]);
  });

  it("imports undated attempted/unattempted lessons and maps unknown progress conservatively",()=>{
    const result=parseEdLessons({modules:[],lessons:[
      {id:11,course_id:123,title:"Attempted",status:"attempted",state:"active",is_hidden:false,is_unlisted:false,due_at:null},
      {id:12,course_id:123,title:"Unattempted",status:"unattempted",state:"scheduled",is_hidden:false,is_unlisted:false},
      {id:13,course_id:123,title:"Mystery",status:"mystery",state:"active",is_hidden:false,is_unlisted:false},
    ]},course);
    expect(result.map(item=>({id:item.externalId,status:item.status,dueAt:item.dueAt,sourceStatusText:item.sourceStatusText}))).toEqual([
      {id:"11",status:"pending",dueAt:null,sourceStatusText:"attempted"},
      {id:"12",status:"pending",dueAt:null,sourceStatusText:"unattempted"},
      {id:"13",status:"unknown",dueAt:null,sourceStatusText:"mystery"},
    ]);
  });

  it("excludes hidden/unlisted and skips malformed lessons without dropping valid siblings",()=>{
    const result=parseEdLessons({modules:[],lessons:[
      {id:20,course_id:123,title:"Hidden",status:"unattempted",is_hidden:true,is_unlisted:false},
      {id:21,course_id:123,title:"Unlisted",status:"unattempted",is_hidden:false,is_unlisted:true},
      {course_id:123,title:"No id",status:"unattempted",is_hidden:false,is_unlisted:false},
      {id:22,course_id:123,title:"Visible",state:"scheduled",is_hidden:false,is_unlisted:false},
    ]},course);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({externalId:"22",title:"Visible",status:"unknown",sourceStatusText:"scheduled"});
  });

  it("accepts a successful empty lessons collection and fails closed on unknown top-level shapes",()=>{
    expect(parseEdLessons({modules:[],lessons:[]},course)).toEqual([]);
    expect(()=>parseEdLessons({modules:[]},course)).toThrowError(EdSourceError);
  });
});
