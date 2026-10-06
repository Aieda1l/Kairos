import { describe, expect, it } from "vitest";
import { openDatabase } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import { AssignmentRepository } from "@/lib/db/repositories/assignments";
import { CalendarConnectionRepository } from "@/lib/db/repositories/calendar-connections";
import { CalendarCredentialRepository } from "@/lib/db/repositories/calendar-credentials";
import { CalendarEventLinkRepository } from "@/lib/db/repositories/calendar-event-links";
import { SourceConnectionRepository } from "@/lib/db/repositories/source-connections";
import { D1AssignmentRepository } from "@/lib/db/d1/repositories/assignments";
import { D1CalendarConnectionRepository } from "@/lib/db/d1/repositories/calendar-connections";
import { D1CalendarCredentialRepository } from "@/lib/db/d1/repositories/calendar-credentials";
import { D1CalendarEventLinkRepository } from "@/lib/db/d1/repositories/calendar-event-links";
import { D1SourceConnectionRepository } from "@/lib/db/d1/repositories/source-connections";
import type { CredentialKeyring } from "@/lib/security/credential-cipher";
import { ALICE, BOB } from "../helpers/test-users";
import { openD1TestDatabase } from "../helpers/d1-test-db";

function seedAssignment(){
  const db=openDatabase(":memory:");
  migrate(db);
  const source=new SourceConnectionRepository(db).upsertCanvas("Canvas");
  new AssignmentRepository(db).upsertMany(source.id,[{
    source:"canvas",
    externalId:"assignment-1",
    courseId:"123",
    courseName:"CSE 331",
    title:"Homework 3",
    releaseAt:null,
    dueAt:"2026-10-09T06:59:00.000Z",
    lateDueAt:null,
    status:"pending",
    sourceStatusText:null,
    gradeScore:null,
    gradeMax:null,
    gradeDisplay:null,
    sourceUrl:"https://canvas.uw.edu/courses/123/assignments/1",
    sourceUpdatedAt:null,
  }],"2026-10-06T00:00:00.000Z");
  return {db,assignment:new AssignmentRepository(db).list()[0]!};
}

describe("calendar destination repositories",()=>{
  it("stores multiple connections of one provider without exposing credentials",()=>{
    const {db}=seedAssignment();
    const connections=new CalendarConnectionRepository(db);
    const credentials=new CalendarCredentialRepository(db);
    const first=connections.create({provider:"google",label:"Google A",accountLabel:"a@example.com"},new Date("2026-10-06T00:00:00.000Z"));
    const second=connections.create({provider:"google",label:"Google B",accountLabel:"b@example.com"},new Date("2026-10-06T00:01:00.000Z"));
    const refreshToken="fixture-google-refresh-never-echo";
    const appPassword="fixture-icloud-password-never-echo";

    credentials.setOAuthRefreshToken(first.id,refreshToken);
    credentials.setCaldavCredentials(second.id,"student@example.com",appPassword);

    expect(connections.list().map(item=>item.id)).toEqual([first.id,second.id]);
    expect(credentials.getOAuthRefreshToken(first.id)).toBe(refreshToken);
    expect(credentials.getCaldavCredentials(second.id)).toEqual({username:"student@example.com",secret:appPassword});
    expect(JSON.stringify(connections.list())).not.toContain(refreshToken);
    expect(JSON.stringify(connections.list())).not.toContain(appPassword);

    db.close();
  });

  it("preserves the last successful timestamp when a later calendar sync errors",()=>{
    const {db}=seedAssignment();
    const repo=new CalendarConnectionRepository(db);
    const connection=repo.create({provider:"google",label:"Google"},new Date("2026-10-06T00:00:00.000Z"));
    repo.markSyncResult(connection.id,{completedAt:"2026-10-06T01:00:00.000Z",status:"success",errorCode:null});
    repo.markSyncResult(connection.id,{completedAt:"2026-10-06T02:00:00.000Z",status:"error",errorCode:"CALENDAR_NETWORK_ERROR"});
    expect(repo.getById(connection.id)).toMatchObject({
      lastSyncCompletedAt:"2026-10-06T01:00:00.000Z",
      lastSyncStatus:"error",
      lastErrorCode:"CALENDAR_NETWORK_ERROR",
    });
    db.close();
  });

  it("keeps one event link per destination assignment and cascades connection deletion",()=>{
    const {db,assignment}=seedAssignment();
    const connections=new CalendarConnectionRepository(db);
    const credentials=new CalendarCredentialRepository(db);
    const links=new CalendarEventLinkRepository(db);
    const connection=connections.create({provider:"caldav",label:"iCloud"},new Date("2026-10-06T00:00:00.000Z"));

    credentials.setCaldavCredentials(connection.id,"student@example.com","fixture-secret");
    const first=links.ensure(connection.id,assignment.id,"stable-sync-key",new Date("2026-10-06T00:00:00.000Z"));
    const second=links.ensure(connection.id,assignment.id,"different-ignored-key",new Date("2026-10-06T00:05:00.000Z"));
    expect(second.id).toBe(first.id);
    expect(second.syncKey).toBe("stable-sync-key");

    connections.delete(connection.id);
    expect(credentials.getCaldavCredentials(connection.id)).toBeNull();
    expect(links.listByConnection(connection.id)).toEqual([]);

    db.close();
  });
});


const d1Keyring:CredentialKeyring={
  activeKeyId:"k1",
  keys:{k1:new Uint8Array(32).fill(13)},
};

async function seedD1Users(sqlite:ReturnType<typeof openD1TestDatabase>["sqlite"]){
  sqlite.prepare("INSERT INTO users(id,name,email) VALUES (?,?,?)").run(ALICE.id,ALICE.name,ALICE.email);
  sqlite.prepare("INSERT INTO users(id,name,email) VALUES (?,?,?)").run(BOB.id,BOB.name,BOB.email);
}

async function seedD1Assignment(db:ReturnType<typeof openD1TestDatabase>["db"]){
  const source=await new D1SourceConnectionRepository(db,{userId:ALICE.id}).upsertCanvas("Canvas");
  const assignments=new D1AssignmentRepository(db,{userId:ALICE.id});
  await assignments.upsertMany(source.id,[{
    source:"canvas",
    externalId:"d1-assignment-1",
    courseId:"123",
    courseName:"CSE 331",
    title:"Homework 3",
    releaseAt:null,
    dueAt:"2026-10-09T06:59:00.000Z",
    lateDueAt:null,
    status:"pending",
    sourceStatusText:null,
    gradeScore:null,
    gradeMax:null,
    gradeDisplay:null,
    sourceUrl:null,
    sourceUpdatedAt:null,
  }],"2026-10-06T00:00:00.000Z");
  return (await assignments.list())[0]!;
}

describe("tenant-scoped D1 calendar repositories",()=>{
  it("hides known calendar ids and blocks cross-user updates/deletes",async()=>{
    const {db,sqlite,close}=openD1TestDatabase();
    await seedD1Users(sqlite);
    const alice=new D1CalendarConnectionRepository(db,{userId:ALICE.id});
    const bob=new D1CalendarConnectionRepository(db,{userId:BOB.id});
    const connection=await alice.create({provider:"google",label:"Alice Google",accountLabel:"alice@example.invalid"});

    await expect(alice.list()).resolves.toHaveLength(1);
    await expect(bob.list()).resolves.toEqual([]);
    await expect(bob.getById(connection.id)).resolves.toBeNull();
    await expect(bob.updateRemoteCalendar(connection.id,"bob-calendar","Bob")).rejects.toThrow(/not found/i);
    await bob.delete(connection.id);
    await expect(alice.getById(connection.id)).resolves.toMatchObject({label:"Alice Google"});
    close();
  });

  it("encrypts provider-bound OAuth and CalDAV secrets per owner",async()=>{
    const {db,sqlite,close}=openD1TestDatabase();
    await seedD1Users(sqlite);
    const connections=new D1CalendarConnectionRepository(db,{userId:ALICE.id});
    const google=await connections.create({provider:"google",label:"Google"});
    const icloud=await connections.create({provider:"caldav",label:"iCloud"});
    const alice=new D1CalendarCredentialRepository(db,{userId:ALICE.id},d1Keyring);
    const bob=new D1CalendarCredentialRepository(db,{userId:BOB.id},d1Keyring);
    const refresh="alice-google-refresh-token";
    const appPassword="alice-icloud-app-password";

    await alice.setOAuthRefreshToken(google.id,refresh);
    await alice.setCaldavCredentials(icloud.id,"alice@icloud.example",appPassword);

    await expect(alice.getOAuthRefreshToken(google.id)).resolves.toBe(refresh);
    await expect(alice.getCaldavCredentials(icloud.id)).resolves.toEqual({
      username:"alice@icloud.example",
      secret:appPassword,
    });
    await expect(bob.getOAuthRefreshToken(google.id)).resolves.toBeNull();
    await expect(bob.getCaldavCredentials(icloud.id)).resolves.toBeNull();

    const rows=sqlite.prepare(`
      SELECT oauth_refresh_token_envelope,caldav_secret_envelope
      FROM calendar_credentials WHERE user_id=? ORDER BY calendar_connection_id
    `).all(ALICE.id) as Array<{oauth_refresh_token_envelope:string|null;caldav_secret_envelope:string|null}>;
    expect(JSON.stringify(rows)).not.toContain(refresh);
    expect(JSON.stringify(rows)).not.toContain(appPassword);
    expect(rows.some(row=>row.oauth_refresh_token_envelope?.startsWith("v1."))).toBe(true);
    expect(rows.some(row=>row.caldav_secret_envelope?.startsWith("v1."))).toBe(true);

    await expect(bob.setOAuthRefreshToken(google.id,"bob-token")).rejects.toThrow(/foreign key/i);

    sqlite.prepare("UPDATE calendar_connections SET provider='microsoft' WHERE user_id=? AND id=?")
      .run(ALICE.id,google.id);
    await expect(alice.getOAuthRefreshToken(google.id)).rejects.toMatchObject({
      code:"CREDENTIAL_DECRYPT_FAILED",
    });
    close();
  });

  it("scopes event links and lets composite FKs reject cross-user adoption",async()=>{
    const {db,sqlite,close}=openD1TestDatabase();
    await seedD1Users(sqlite);
    const assignment=await seedD1Assignment(db);
    const aliceConnections=new D1CalendarConnectionRepository(db,{userId:ALICE.id});
    const calendar=await aliceConnections.create({provider:"google",label:"Google"});
    const aliceLinks=new D1CalendarEventLinkRepository(db,{userId:ALICE.id});
    const bobLinks=new D1CalendarEventLinkRepository(db,{userId:BOB.id});

    const link=await aliceLinks.ensure(calendar.id,assignment.id,"stable-key",new Date("2026-10-06T00:00:00.000Z"));
    await expect(bobLinks.get(calendar.id,assignment.id)).resolves.toBeNull();
    await expect(bobLinks.listByConnection(calendar.id)).resolves.toEqual([]);

    await bobLinks.markSynced(link.id,"bob-event",null,"hash","2026-10-06T01:00:00.000Z");
    await expect(aliceLinks.get(calendar.id,assignment.id)).resolves.toMatchObject({remoteEventId:null});

    await expect(bobLinks.ensure(calendar.id,assignment.id,"bob-adopt"))
      .rejects.toThrow(/foreign key/i);
    close();
  });
});
