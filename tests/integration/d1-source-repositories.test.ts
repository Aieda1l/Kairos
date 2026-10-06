import { describe, expect, it } from "vitest";
import { D1AssignmentRepository } from "@/lib/db/d1/repositories/assignments";
import { D1SettingsRepository } from "@/lib/db/d1/repositories/settings";
import { D1SourceConnectionRepository } from "@/lib/db/d1/repositories/source-connections";
import { D1SourceCourseRepository } from "@/lib/db/d1/repositories/source-courses";
import { D1SourceCredentialRepository } from "@/lib/db/d1/repositories/source-credentials";
import { D1SubmissionStatusRepository } from "@/lib/db/d1/repositories/submission-status";
import type { CredentialKeyring } from "@/lib/security/credential-cipher";
import { ALICE, BOB } from "../helpers/test-users";
import { openD1TestDatabase } from "../helpers/d1-test-db";

const keyring:CredentialKeyring={
  activeKeyId:"k1",
  keys:{k1:new Uint8Array(32).fill(9)},
};

const now="2026-10-06T00:00:00.000Z";

async function seedUsers(sqlite:ReturnType<typeof openD1TestDatabase>["sqlite"]){
  sqlite.prepare("INSERT INTO users(id,name,email) VALUES (?,?,?)")
    .run(ALICE.id,ALICE.name,ALICE.email);
  sqlite.prepare("INSERT INTO users(id,name,email) VALUES (?,?,?)")
    .run(BOB.id,BOB.name,BOB.email);
}

describe("tenant-scoped D1 source repositories",()=>{
  it("allows the same source kind per user and hides known cross-user ids",async()=>{
    const {db,sqlite,close}=openD1TestDatabase();
    await seedUsers(sqlite);
    const alice=new D1SourceConnectionRepository(db,{userId:ALICE.id});
    const bob=new D1SourceConnectionRepository(db,{userId:BOB.id});

    const aliceCanvas=await alice.upsertCanvas("Alice Canvas");
    const bobCanvas=await bob.upsertCanvas("Bob Canvas");

    expect(aliceCanvas.id).not.toBe(bobCanvas.id);
    await expect(alice.getByKind("canvas")).resolves.toMatchObject({label:"Alice Canvas"});
    await expect(bob.getByKind("canvas")).resolves.toMatchObject({label:"Bob Canvas"});
    await expect(bob.getById(aliceCanvas.id)).resolves.toBeNull();

    await bob.markSyncError(aliceCanvas.id,now,"NETWORK_ERROR");
    await expect(alice.getById(aliceCanvas.id)).resolves.toMatchObject({
      lastSyncStatus:"never",
      lastErrorCode:null,
    });
    close();
  });

  it("encrypts credentials and binds them to owner and connection",async()=>{
    const {db,sqlite,close}=openD1TestDatabase();
    await seedUsers(sqlite);
    const aliceConnections=new D1SourceConnectionRepository(db,{userId:ALICE.id});
    const aliceCanvas=await aliceConnections.upsertCanvas("Canvas");
    const aliceCreds=new D1SourceCredentialRepository(db,{userId:ALICE.id},keyring);
    const bobCreds=new D1SourceCredentialRepository(db,{userId:BOB.id},keyring);
    const secret="https://canvas.example.edu/private.ics?token=alice";

    await aliceCreds.setCanvasFeedUrl(aliceCanvas.id,secret);
    await expect(aliceCreds.getCanvasFeedUrl(aliceCanvas.id)).resolves.toBe(secret);
    await expect(bobCreds.getCanvasFeedUrl(aliceCanvas.id)).resolves.toBeNull();

    const row=sqlite.prepare("SELECT canvas_feed_url_envelope FROM source_credentials WHERE user_id=?")
      .get(ALICE.id) as {canvas_feed_url_envelope:string};
    expect(row.canvas_feed_url_envelope).toMatch(/^v1\./);
    expect(row.canvas_feed_url_envelope).not.toContain(secret);

    await expect(bobCreds.setCanvasFeedUrl(aliceCanvas.id,"https://example.invalid/bob.ics"))
      .rejects.toThrow(/foreign key/i);
    close();
  });

  it("keeps discovered course selection independent per user",async()=>{
    const {db,sqlite,close}=openD1TestDatabase();
    await seedUsers(sqlite);
    const aliceSource=await new D1SourceConnectionRepository(db,{userId:ALICE.id}).upsertGradescope("Gradescope");
    const bobSource=await new D1SourceConnectionRepository(db,{userId:BOB.id}).upsertGradescope("Gradescope");
    const aliceCourses=new D1SourceCourseRepository(db,{userId:ALICE.id});
    const bobCourses=new D1SourceCourseRepository(db,{userId:BOB.id});
    const course={externalCourseId:"123",shortName:"CSE 123",fullName:"CSE 123 A",term:"Autumn",year:"2026"};

    await aliceCourses.upsertDiscovered(aliceSource.id,[course],now);
    await bobCourses.upsertDiscovered(bobSource.id,[course],now);
    await aliceCourses.setEnabled(aliceSource.id,["123"]);

    expect(await aliceCourses.listEnabled(aliceSource.id)).toHaveLength(1);
    expect(await bobCourses.listEnabled(bobSource.id)).toHaveLength(0);
    expect(await bobCourses.list(aliceSource.id)).toEqual([]);
    close();
  });

  it("scopes assignment upserts/lists and rejects a cross-user source parent",async()=>{
    const {db,sqlite,close}=openD1TestDatabase();
    await seedUsers(sqlite);
    const aliceSource=await new D1SourceConnectionRepository(db,{userId:ALICE.id}).upsertCanvas("Canvas");
    const bobSource=await new D1SourceConnectionRepository(db,{userId:BOB.id}).upsertCanvas("Canvas");
    const aliceAssignments=new D1AssignmentRepository(db,{userId:ALICE.id});
    const bobAssignments=new D1AssignmentRepository(db,{userId:BOB.id});
    const item={
      source:"canvas" as const,
      externalId:"event-1",
      courseId:"1",
      courseName:"CSE 1",
      title:"Homework",
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

    await expect(aliceAssignments.upsertMany(aliceSource.id,[item],now))
      .resolves.toEqual({inserted:1,updated:0});
    await expect(bobAssignments.list()).resolves.toEqual([]);
    await expect(bobAssignments.upsertMany(aliceSource.id,[item],now))
      .rejects.toThrow(/foreign key/i);

    await bobAssignments.upsertMany(bobSource.id,[{...item,externalId:"event-bob"}],now);
    expect(await bobAssignments.list()).toHaveLength(1);
    expect(await aliceAssignments.list()).toHaveLength(1);
    close();
  });

  it("keeps settings independent and defaults per user",async()=>{
    const {db,sqlite,close}=openD1TestDatabase();
    await seedUsers(sqlite);
    const alice=new D1SettingsRepository(db,{userId:ALICE.id});
    const bob=new D1SettingsRepository(db,{userId:BOB.id});

    await alice.setTimeZone("UTC");
    await alice.setCalendarHideSubmitted(false);

    await expect(alice.getTimeZone()).resolves.toBe("UTC");
    await expect(bob.getTimeZone()).resolves.toBe("America/Los_Angeles");
    await expect(alice.getCalendarHideSubmitted()).resolves.toBe(false);
    await expect(bob.getCalendarHideSubmitted()).resolves.toBe(true);
    close();
  });

  it("writes submission status only for assignments owned by the scoped user",async()=>{
    const {db,sqlite,close}=openD1TestDatabase();
    await seedUsers(sqlite);
    const aliceSource=await new D1SourceConnectionRepository(db,{userId:ALICE.id}).upsertCanvas("Canvas");
    const aliceAssignments=new D1AssignmentRepository(db,{userId:ALICE.id});
    await aliceAssignments.upsertMany(aliceSource.id,[{
      source:"canvas",externalId:"event-1",courseId:"1",courseName:"CSE 1",title:"Homework",
      releaseAt:null,dueAt:null,lateDueAt:null,status:"unknown",sourceStatusText:null,
      gradeScore:null,gradeMax:null,gradeDisplay:null,sourceUrl:null,sourceUpdatedAt:null,
    }],now);
    const assignment=(await aliceAssignments.list())[0];

    const aliceStatuses=new D1SubmissionStatusRepository(db,{userId:ALICE.id});
    const bobStatuses=new D1SubmissionStatusRepository(db,{userId:BOB.id});
    const write={
      assignmentLocalId:assignment.id,
      state:"submitted" as const,
      isLate:false,
      isMissing:false,
      submittedAt:null,
      checkedAt:"2026-10-06T01:00:00.000Z",
      extractorVersion:"canvas-html-v1",
    };

    await expect(aliceStatuses.applyCompletion(aliceSource.id,[write],0,null,now))
      .resolves.toEqual({updated:1,ignoredStale:0});
    await expect(bobStatuses.applyCompletion(aliceSource.id,[write],0,null,now))
      .resolves.toEqual({updated:0,ignoredStale:0});

    expect((await aliceAssignments.list())[0].submissionStatus?.state).toBe("submitted");
    close();
  });
});
