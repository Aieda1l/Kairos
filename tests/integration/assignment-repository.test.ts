import { expect,it } from "vitest";
import { openDatabase } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import { AssignmentRepository } from "@/lib/db/repositories/assignments";
import { SourceConnectionRepository } from "@/lib/db/repositories/source-connections";

it("upserts idempotently by source connection and external id",()=>{
  const db=openDatabase(":memory:");
  migrate(db);
  const c=new SourceConnectionRepository(db).upsertCanvas("Canvas");
  const repo=new AssignmentRepository(db);
  const item={
    source:"canvas" as const,
    externalId:"event-assignment-1",
    courseId:"1",
    courseName:"CSE 1",
    title:"HW",
    releaseAt:null,
    dueAt:"2026-10-08T06:59:00.000Z",
    lateDueAt:null,
    status:"unknown" as const,
    sourceStatusText:null,
    gradeScore:null,
    gradeMax:null,
    gradeDisplay:null,
    sourceUrl:null,
    sourceUpdatedAt:null,
  };
  expect(repo.upsertMany(c.id,[item],"2026-10-01T00:00:00Z")).toEqual({inserted:1,updated:0});
  expect(repo.upsertMany(c.id,[{...item,dueAt:"2026-10-09T06:59:00.000Z"}],"2026-10-02T00:00:00Z")).toEqual({inserted:0,updated:1});
  expect(repo.list()).toHaveLength(1);
  expect(repo.list()[0]).toMatchObject({
    dueAt:"2026-10-09T06:59:00.000Z",
    releaseAt:null,
    lateDueAt:null,
    sourceStatusText:null,
    gradeScore:null,
    gradeMax:null,
    gradeDisplay:null,
  });
  expect(repo.list()[0].submissionStatus).toBeNull();
  db.close();
});

it("round-trips Gradescope release, late due, source status, and grade metadata",()=>{
  const db=openDatabase(":memory:");
  migrate(db);
  const c=new SourceConnectionRepository(db).upsertGradescope("Gradescope");
  const repo=new AssignmentRepository(db);
  repo.upsertMany(c.id,[{
    source:"gradescope",
    externalId:"4242",
    courseId:"999",
    courseName:"CSE 331",
    title:"Homework 3",
    releaseAt:"2026-10-01T17:00:00.000Z",
    dueAt:"2026-10-08T06:59:00.000Z",
    lateDueAt:"2026-10-10T06:59:00.000Z",
    status:"graded",
    sourceStatusText:"8.5 / 10",
    gradeScore:"8.5",
    gradeMax:"10",
    gradeDisplay:"8.5 / 10",
    sourceUrl:"https://www.gradescope.com/courses/999/assignments/4242",
    sourceUpdatedAt:null,
  }],"2026-10-04T00:00:00.000Z");
  expect(repo.list({source:"gradescope"})[0]).toMatchObject({
    releaseAt:"2026-10-01T17:00:00.000Z",
    lateDueAt:"2026-10-10T06:59:00.000Z",
    sourceStatusText:"8.5 / 10",
    gradeScore:"8.5",
    gradeMax:"10",
    gradeDisplay:"8.5 / 10",
  });
  db.close();
});
