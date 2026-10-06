import { describe, expect, it } from "vitest";
import { openDatabase } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import { AssignmentRepository } from "@/lib/db/repositories/assignments";
import { CalendarConnectionRepository } from "@/lib/db/repositories/calendar-connections";
import { CalendarCredentialRepository } from "@/lib/db/repositories/calendar-credentials";
import { CalendarEventLinkRepository } from "@/lib/db/repositories/calendar-event-links";
import { SourceConnectionRepository } from "@/lib/db/repositories/source-connections";

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
