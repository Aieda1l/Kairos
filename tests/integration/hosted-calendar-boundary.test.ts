import {describe,expect,it,vi} from "vitest";
import type {CalendarDestinationAdapter} from "@/lib/calendar/adapter";
import {
  disconnectCalendar,
  removeManagedCalendarEvents,
} from "@/lib/calendar/connection-service";
import {
  reconcileAllCalendars,
  reconcileCalendarConnection,
} from "@/lib/calendar/reconcile";
import {reconcileCalendarsAfterSourceWrite} from "@/lib/calendar/post-source-sync";
import {D1AssignmentRepository} from "@/lib/db/d1/repositories/assignments";
import {D1CalendarConnectionRepository} from "@/lib/db/d1/repositories/calendar-connections";
import {D1CalendarEventLinkRepository} from "@/lib/db/d1/repositories/calendar-event-links";
import {D1SettingsRepository} from "@/lib/db/d1/repositories/settings";
import {D1SourceConnectionRepository} from "@/lib/db/d1/repositories/source-connections";
import type {CredentialKeyring} from "@/lib/security/credential-cipher";
import {ALICE,BOB} from "../helpers/test-users";
import {openD1TestDatabase} from "../helpers/d1-test-db";

const keyring:CredentialKeyring={
  activeKeyId:"k1",
  keys:{k1:new Uint8Array(32).fill(27)},
};

function seedUsers(sqlite:ReturnType<typeof openD1TestDatabase>["sqlite"]){
  sqlite.prepare("INSERT INTO users(id,name,email) VALUES (?,?,?)")
    .run(ALICE.id,ALICE.name,ALICE.email);
  sqlite.prepare("INSERT INTO users(id,name,email) VALUES (?,?,?)")
    .run(BOB.id,BOB.name,BOB.email);
}

async function seedAssignment(
  db:ReturnType<typeof openD1TestDatabase>["db"],
  userId:string,
  suffix:string,
){
  const scope={userId};
  const source=await new D1SourceConnectionRepository(db,scope).upsertCanvas(`Canvas ${suffix}`);
  const assignments=new D1AssignmentRepository(db,scope);
  await assignments.upsertMany(source.id,[{
    source:"canvas",
    externalId:`event-${suffix}`,
    courseId:"123",
    courseName:`CSE ${suffix}`,
    title:`Homework ${suffix}`,
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

function adapterFactory(){
  const calls:string[]=[];
  const adapter:CalendarDestinationAdapter={
    provider:"google",
    async testConnection(){},
    async ensureCalendar(){return {remoteCalendarId:"remote",name:"Kairos"};},
    async getEvent(){return null;},
    async createEvent(_calendarId,projection){
      calls.push(projection.assignmentId);
      return {remoteEventId:`remote-${projection.assignmentId}`,etag:"etag"};
    },
    async updateEvent(_calendarId,eventId,projection){
      calls.push(projection.assignmentId);
      return {remoteEventId:eventId,etag:"etag-2"};
    },
    async deleteEvent(){},
  };
  return {
    calls,
    factory:vi.fn(async()=>adapter),
  };
}

describe("hosted calendar tenant boundary",()=>{
  it("treats Alice's exact destination id as missing from Bob's scope",async()=>{
    const {db,sqlite,close}=openD1TestDatabase();
    seedUsers(sqlite);
    const aliceConnections=new D1CalendarConnectionRepository(db,{userId:ALICE.id});
    const alice=await aliceConnections.create({provider:"google",label:"Alice Google"});
    await aliceConnections.updateRemoteCalendar(alice.id,"alice-remote","Kairos");

    const adapters=adapterFactory();
    await expect(reconcileCalendarConnection(
      db,{userId:BOB.id},alice.id,{
        adapterFactory:adapters.factory,
        now:new Date("2026-10-06T01:00:00.000Z"),
      },
    )).rejects.toThrow(/not found/i);
    expect(adapters.factory).not.toHaveBeenCalled();

    await expect(disconnectCalendar(db,{userId:BOB.id},alice.id)).resolves.toBe(false);
    await expect(aliceConnections.getById(alice.id)).resolves.not.toBeNull();

    await expect(removeManagedCalendarEvents(
      db,{userId:BOB.id},keyring,alice.id,{adapterFactory:adapters.factory},
    )).rejects.toMatchObject({code:"CALENDAR_CONFIG_MISSING"});
    close();
  });

  it("sync-all reconciles only the caller's enabled destinations and assignments",async()=>{
    const {db,sqlite,close}=openD1TestDatabase();
    seedUsers(sqlite);
    await seedAssignment(db,ALICE.id,"alice");
    const bobAssignment=await seedAssignment(db,BOB.id,"bob");

    const aliceRepo=new D1CalendarConnectionRepository(db,{userId:ALICE.id});
    const bobRepo=new D1CalendarConnectionRepository(db,{userId:BOB.id});
    const alice=await aliceRepo.create({provider:"google",label:"Alice"});
    const bob=await bobRepo.create({provider:"google",label:"Bob"});
    await aliceRepo.updateRemoteCalendar(alice.id,"alice-remote","Kairos");
    await bobRepo.updateRemoteCalendar(bob.id,"bob-remote","Kairos");

    const adapters=adapterFactory();
    const result=await reconcileAllCalendars(
      db,{userId:BOB.id},{
        adapterFactory:adapters.factory,
        now:new Date("2026-10-06T01:00:00.000Z"),
      },
    );

    expect(result.results.map(item=>item.connectionId)).toEqual([bob.id]);
    expect(adapters.calls).toEqual([bobAssignment.id]);
    await expect(new D1CalendarEventLinkRepository(db,{userId:ALICE.id})
      .listByConnection(alice.id)).resolves.toEqual([]);
    close();
  });

  it("post-source reconciliation stays inside the source user's tenant",async()=>{
    const {db,sqlite,close}=openD1TestDatabase();
    seedUsers(sqlite);
    await seedAssignment(db,ALICE.id,"alice");
    const bobAssignment=await seedAssignment(db,BOB.id,"bob");

    const aliceRepo=new D1CalendarConnectionRepository(db,{userId:ALICE.id});
    const bobRepo=new D1CalendarConnectionRepository(db,{userId:BOB.id});
    const alice=await aliceRepo.create({provider:"google",label:"Alice"});
    const bob=await bobRepo.create({provider:"google",label:"Bob"});
    await aliceRepo.updateRemoteCalendar(alice.id,"alice-remote","Kairos");
    await bobRepo.updateRemoteCalendar(bob.id,"bob-remote","Kairos");

    const adapters=adapterFactory();
    await reconcileCalendarsAfterSourceWrite(
      db,{userId:BOB.id},keyring,{
        defer:false,
        changed:true,
        adapterFactory:adapters.factory,
      },
    );

    expect(adapters.calls).toEqual([bobAssignment.id]);
    close();
  });

  it("keeps calendar settings independent per user during hosted reconciliation",async()=>{
    const {db,sqlite,close}=openD1TestDatabase();
    seedUsers(sqlite);
    const aliceAssignment=await seedAssignment(db,ALICE.id,"alice");
    const bobAssignment=await seedAssignment(db,BOB.id,"bob");

    sqlite.prepare(
      "UPDATE assignments SET status='submitted' WHERE user_id=? AND id=?",
    ).run(ALICE.id,aliceAssignment.id);
    sqlite.prepare(
      "UPDATE assignments SET status='submitted' WHERE user_id=? AND id=?",
    ).run(BOB.id,bobAssignment.id);

    await new D1SettingsRepository(db,{userId:ALICE.id}).setCalendarHideSubmitted(false);

    const aliceRepo=new D1CalendarConnectionRepository(db,{userId:ALICE.id});
    const bobRepo=new D1CalendarConnectionRepository(db,{userId:BOB.id});
    const alice=await aliceRepo.create({provider:"google",label:"Alice"});
    const bob=await bobRepo.create({provider:"google",label:"Bob"});
    await aliceRepo.updateRemoteCalendar(alice.id,"alice-remote","Kairos");
    await bobRepo.updateRemoteCalendar(bob.id,"bob-remote","Kairos");

    const aliceAdapters=adapterFactory();
    const bobAdapters=adapterFactory();
    await reconcileAllCalendars(db,{userId:ALICE.id},{
      adapterFactory:aliceAdapters.factory,
      now:new Date("2026-10-06T01:00:00.000Z"),
    });
    await reconcileAllCalendars(db,{userId:BOB.id},{
      adapterFactory:bobAdapters.factory,
      now:new Date("2026-10-06T01:00:00.000Z"),
    });

    expect(aliceAdapters.calls).toEqual([aliceAssignment.id]);
    expect(bobAdapters.calls).toEqual([]);
    close();
  });
});
