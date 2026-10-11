import {expect,it} from "vitest";
import {D1AssignmentRepository} from "@/lib/db/d1/repositories/assignments";
import {D1SourceConnectionRepository} from "@/lib/db/d1/repositories/source-connections";
import {getAssignmentsView} from "@/lib/assignments/queries";
import {ALICE,BOB} from "../helpers/test-users";
import {openD1TestDatabase} from "../helpers/d1-test-db";

function seedUsers(sqlite:ReturnType<typeof openD1TestDatabase>["sqlite"]){
  sqlite.prepare("INSERT INTO users(id,name,email) VALUES (?,?,?)")
    .run(ALICE.id,ALICE.name,ALICE.email);
  sqlite.prepare("INSERT INTO users(id,name,email) VALUES (?,?,?)")
    .run(BOB.id,BOB.name,BOB.email);
}

async function seedAssignment(
  db:ReturnType<typeof openD1TestDatabase>["db"],
  userId:string,
  title:string,
){
  const scope={userId};
  const connection=await new D1SourceConnectionRepository(db,scope)
    .upsertCanvas(`Canvas ${userId}`);
  await new D1AssignmentRepository(db,scope).upsertMany(connection.id,[{
    source:"canvas",
    externalId:`assignment-${userId}`,
    courseId:null,
    courseName:`Course ${userId}`,
    title,
    releaseAt:null,
    dueAt:null,
    lateDueAt:null,
    status:"unknown",
    sourceStatusText:null,
    gradeScore:null,
    gradeMax:null,
    gradeDisplay:null,
    sourceUrl:null,
    sourceUpdatedAt:null,
  }],"2026-10-06T00:00:00.000Z");
}

it("composes D1 filters without crossing tenant scope",async()=>{
  const {db,sqlite,close}=openD1TestDatabase();
  seedUsers(sqlite);
  await seedAssignment(db,ALICE.id,"Alice Essay");
  await seedAssignment(db,BOB.id,"Bob Project");

  const alice=new D1AssignmentRepository(db,{userId:ALICE.id});
  const bob=new D1AssignmentRepository(db,{userId:BOB.id});

  await expect(getAssignmentsView(alice,{
    source:"canvas",
    course:"Course alice",
    search:"ESS",
  })).resolves.toMatchObject([{title:"Alice Essay"}]);

  await expect(getAssignmentsView(bob,{
    source:"canvas",
    search:"project",
  })).resolves.toMatchObject([{title:"Bob Project"}]);

  await expect(getAssignmentsView(bob,{search:"Alice"})).resolves.toEqual([]);
  close();
});
