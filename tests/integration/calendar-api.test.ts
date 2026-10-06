import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {getDatabase,resetDatabaseSingletonForTests} from "../helpers/legacy-db";
import {migrate} from "../helpers/legacy-db";
import {CalendarConnectionRepository} from "@/lib/db/repositories/calendar-connections";
import {CalendarCredentialRepository} from "@/lib/db/repositories/calendar-credentials";

async function getRoute(){return import("@/app/api/calendars/route");}
async function syncOneRoute(){return import("@/app/api/calendars/[id]/sync/route");}
async function disconnectRoute(){return import("@/app/api/calendars/[id]/disconnect/route");}
async function removeEventsRoute(){return import("@/app/api/calendars/[id]/remove-events/route");}

function request(path:string,body?:unknown){
  return new Request("http://127.0.0.1:3000"+path,{
    method:body===undefined?"POST":"POST",
    headers:{"content-type":"application/json"},
    body:body===undefined?undefined:JSON.stringify(body),
  });
}

describe("calendar destination API",()=>{
  beforeEach(()=>{
    process.env.ASSIGNMENTS_DB_PATH=":memory:";
    resetDatabaseSingletonForTests();
  });
  afterEach(()=>{
    resetDatabaseSingletonForTests();
    vi.restoreAllMocks();
  });

  it("lists safe destination metadata without credentials",async()=>{
    const db=getDatabase();migrate(db);
    const connections=new CalendarConnectionRepository(db);
    const credentials=new CalendarCredentialRepository(db);
    const google=connections.create({provider:"google",label:"Google Calendar"});
    const apple=connections.create({provider:"caldav",label:"Apple iCloud Calendar",accountLabel:"student@example.com"});
    credentials.setOAuthRefreshToken(google.id,"fixture-refresh-never-echo");
    credentials.setCaldavCredentials(apple.id,"student@example.com","fixture-app-password-never-echo");

    const route=await getRoute();
    const response=await route.GET();
    expect(response.status).toBe(200);
    const text=await response.text();
    expect(JSON.parse(text).connections).toHaveLength(2);
    expect(text).not.toContain("fixture-refresh-never-echo");
    expect(text).not.toContain("fixture-app-password-never-echo");
    expect(text).not.toContain("oauth_refresh_token");
    expect(text).not.toContain("caldav_secret");
  });

  it("returns 404 for unknown calendar sync and disconnect ids",async()=>{
    const sync=await syncOneRoute();
    const syncResponse=await sync.POST(request("/api/calendars/missing/sync"),{params:Promise.resolve({id:"missing"})});
    expect(syncResponse.status).toBe(404);

    const disconnect=await disconnectRoute();
    const disconnectResponse=await disconnect.POST(request("/api/calendars/missing/disconnect"),{params:Promise.resolve({id:"missing"})});
    expect(disconnectResponse.status).toBe(404);
  });

  it("disconnect removes only local connection state without provider fetches",async()=>{
    const db=getDatabase();migrate(db);
    const connections=new CalendarConnectionRepository(db);
    const credentials=new CalendarCredentialRepository(db);
    const row=connections.create({provider:"caldav",label:"Apple iCloud Calendar"});
    credentials.setCaldavCredentials(row.id,"student@example.com","fixture-secret");
    const fetchMock=vi.fn();
    vi.stubGlobal("fetch",fetchMock);

    const route=await disconnectRoute();
    const response=await route.POST(request(`/api/calendars/${row.id}/disconnect`),{params:Promise.resolve({id:row.id})});
    expect(response.status).toBe(200);
    expect(connections.getById(row.id)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("remove-events keeps the destination connection and reports zero when no links exist",async()=>{
    const db=getDatabase();migrate(db);
    const connections=new CalendarConnectionRepository(db);
    const row=connections.create({provider:"caldav",label:"Apple iCloud Calendar"});
    connections.updateRemoteCalendar(row.id,"https://p12-caldav.icloud.com/123/calendars/kairos/","Kairos");
    new CalendarCredentialRepository(db).setCaldavCredentials(row.id,"student@example.com","fixture-secret");

    const fetchMock=vi.fn(async()=>new Response(null,{status:200}));
    vi.stubGlobal("fetch",fetchMock);
    const route=await removeEventsRoute();
    const response=await route.POST(request(`/api/calendars/${row.id}/remove-events`),{params:Promise.resolve({id:row.id})});
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({deletedCount:0,failedCount:0});
    expect(connections.getById(row.id)).not.toBeNull();
  });
});
