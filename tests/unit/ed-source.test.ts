import { expect, it, vi } from "vitest";
import type { SourceCourse } from "@/lib/sources/types";
import { EdSource } from "@/lib/sources/ed/source";

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

it("implements AssignmentSource for one Ed course",async()=>{
  const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({
    modules:[],
    lessons:[{id:10,course_id:123,title:"Lesson 1",status:"unattempted",is_hidden:false,is_unlisted:false}],
  }),{status:200,headers:{"content-type":"application/json"}}));
  const source=new EdSource("fixture-token",course,fetchImpl as typeof fetch);
  expect(source.kind).toBe("ed");
  await expect(source.testConnection()).resolves.toEqual({ok:true,itemCount:1});
  await expect(source.sync()).resolves.toEqual([expect.objectContaining({externalId:"10",courseId:"123",title:"Lesson 1"})]);
});

it("returns a stable connection error for rejected authentication",async()=>{
  const fetchImpl=vi.fn(async()=>new Response("",{status:401}));
  const source=new EdSource("fixture-token",course,fetchImpl as typeof fetch);
  await expect(source.testConnection()).resolves.toEqual({
    ok:false,
    code:"ED_AUTH_INVALID",
    message:"Ed rejected the API token. Update it and try again.",
  });
});
