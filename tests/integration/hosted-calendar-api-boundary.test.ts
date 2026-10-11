import {beforeEach,describe,expect,it,vi} from "vitest";
import {AuthenticationRequiredError} from "@/lib/auth/user-scope";
import {D1CalendarConnectionRepository} from "@/lib/db/d1/repositories/calendar-connections";
import {D1SettingsRepository} from "@/lib/db/d1/repositories/settings";
import type {CredentialKeyring} from "@/lib/security/credential-cipher";
import {ALICE,BOB} from "../helpers/test-users";
import {openD1TestDatabase} from "../helpers/d1-test-db";

const runtime=vi.hoisted(()=>({
  get:vi.fn(),
}));

vi.mock("@/lib/platform/calendar-runtime",()=>({
  getCalendarRouteRuntime:runtime.get,
  getCalendarRuntimeContext:runtime.get,
  resolveCalendarRuntimeContext:runtime.get,
  shouldUseLegacyCalendarRuntime:()=>false,
}));

const keyring:CredentialKeyring={
  activeKeyId:"k1",
  keys:{k1:new Uint8Array(32).fill(31)},
};

function seedUsers(sqlite:ReturnType<typeof openD1TestDatabase>["sqlite"]){
  sqlite.prepare("INSERT INTO users(id,name,email) VALUES (?,?,?)")
    .run(ALICE.id,ALICE.name,ALICE.email);
  sqlite.prepare("INSERT INTO users(id,name,email) VALUES (?,?,?)")
    .run(BOB.id,BOB.name,BOB.email);
}

function hosted(
  db:ReturnType<typeof openD1TestDatabase>["db"],
  userId:string,
){
  return {kind:"hosted" as const,db,scope:{userId},keyring};
}

describe("hosted calendar API tenant boundary",()=>{
  beforeEach(()=>{
    runtime.get.mockReset();
  });

  it("lists only the authenticated user's destinations",async()=>{
    const {db,sqlite,close}=openD1TestDatabase();
    seedUsers(sqlite);
    await new D1CalendarConnectionRepository(db,{userId:ALICE.id})
      .create({provider:"google",label:"Alice Google"});
    await new D1CalendarConnectionRepository(db,{userId:BOB.id})
      .create({provider:"microsoft",label:"Bob Outlook"});
    runtime.get.mockResolvedValue(hosted(db,BOB.id));

    const route=await import("@/app/api/calendars/route");
    const response=await route.GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      connections:[{label:"Bob Outlook",provider:"microsoft"}],
    });
    close();
  });

  it("returns the same 404 for Alice's exact destination id from Bob's session",async()=>{
    const {db,sqlite,close}=openD1TestDatabase();
    seedUsers(sqlite);
    const alice=await new D1CalendarConnectionRepository(db,{userId:ALICE.id})
      .create({provider:"google",label:"Alice Google"});
    runtime.get.mockResolvedValue(hosted(db,BOB.id));

    const route=await import("@/app/api/calendars/[id]/disconnect/route");
    const response=await route.POST(
      new Request("https://mykairos.me/api/calendars/x/disconnect",{method:"POST"}),
      {params:Promise.resolve({id:alice.id})},
    );
    expect(response.status).toBe(404);
    await expect(new D1CalendarConnectionRepository(db,{userId:ALICE.id})
      .getById(alice.id)).resolves.not.toBeNull();
    close();
  });

  it("reads and writes settings only for the authenticated user",async()=>{
    const {db,sqlite,close}=openD1TestDatabase();
    seedUsers(sqlite);
    await new D1SettingsRepository(db,{userId:ALICE.id}).setTimeZone("UTC");
    await new D1SettingsRepository(db,{userId:ALICE.id}).setCalendarHideSubmitted(false);
    runtime.get.mockResolvedValue(hosted(db,BOB.id));

    const timezone=await import("@/app/api/settings/timezone/route");
    expect(await (await timezone.GET()).json()).toEqual({
      timeZone:"America/Los_Angeles",
    });
    const tzPut=await timezone.PUT(new Request("https://mykairos.me/api/settings/timezone",{
      method:"PUT",
      body:JSON.stringify({timeZone:"America/New_York"}),
    }));
    expect(tzPut.status).toBe(200);

    const calendar=await import("@/app/api/settings/calendar/route");
    expect(await (await calendar.GET()).json()).toEqual({hideSubmitted:true});
    const calPut=await calendar.PUT(new Request("https://mykairos.me/api/settings/calendar",{
      method:"PUT",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({hideSubmitted:false}),
    }));
    expect(calPut.status).toBe(200);

    await expect(new D1SettingsRepository(db,{userId:ALICE.id}).getTimeZone())
      .resolves.toBe("UTC");
    await expect(new D1SettingsRepository(db,{userId:ALICE.id}).getCalendarHideSubmitted())
      .resolves.toBe(false);
    close();
  });

  it("returns a stable 401 when the hosted session is absent",async()=>{
    runtime.get.mockRejectedValue(new AuthenticationRequiredError());
    const route=await import("@/app/api/calendars/route");
    const response=await route.GET();
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code:"AUTH_REQUIRED",
      message:"Authentication required.",
    });
  });
});
