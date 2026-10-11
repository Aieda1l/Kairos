import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {AuthenticationRequiredError} from "@/lib/auth/user-scope";
import {D1OnboardingRepository} from "@/lib/db/d1/repositories/onboarding";
import {openD1TestDatabase} from "../helpers/d1-test-db";

const runtime=vi.hoisted(()=>({get:vi.fn()}));
vi.mock("@/lib/platform/calendar-runtime",()=>({getCalendarRouteRuntime:runtime.get}));
let database:ReturnType<typeof openD1TestDatabase>;
beforeEach(()=>{
  database=openD1TestDatabase();
  database.sqlite.exec("INSERT INTO users(id) VALUES ('alice'),('bob');");
  runtime.get.mockReset();
  runtime.get.mockResolvedValue({kind:"hosted",db:database.db,scope:{userId:"alice"}});
});
afterEach(()=>database.close());
const patch=(body:unknown)=>new Request("https://mykairos.me/api/settings/onboarding",{method:"PATCH",body:JSON.stringify(body)});

describe("onboarding settings API",()=>{
  it("GET_initializes_and_returns_only_current_tenant_state",async()=>{
    const route=await import("@/app/api/settings/onboarding/route");
    const response=await route.GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({state:{version:1,revision:0,status:"active",currentStep:"timezone",skipped:[],drafts:{}}});
    expect(await new D1OnboardingRepository(database.db,{userId:"bob"}).get()).toBeNull();
  });

  it("PATCH_returns_conflict_and_keeps_the_winning_progress",async()=>{
    const route=await import("@/app/api/settings/onboarding/route");
    await route.GET();
    const first=await route.PATCH(patch({command:{type:"save-draft",drafts:{timeZone:"UTC"}},expectedRevision:0}));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({state:{revision:1,drafts:{timeZone:"UTC"}}});
    const stale=await route.PATCH(patch({command:{type:"visit",step:"canvas"},expectedRevision:0}));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({code:"ONBOARDING_CONFLICT"});
    expect(await (await route.GET()).json()).toMatchObject({state:{revision:1,currentStep:"timezone",drafts:{timeZone:"UTC"}}});
  });

  it.each([
    {command:{type:"skip",step:"timezone"},expectedRevision:0},
    {command:{type:"save-draft",drafts:{timeZone:"invalid/timezone"}},expectedRevision:0},
    {command:{type:"save-draft",drafts:{token:"fixture-private-token"}},expectedRevision:0},
    {command:{type:"visit",step:"canvas"},expectedRevision:-1},
    {command:{type:"finish"},expectedRevision:0.5},
    {command:{type:"finish"},expectedRevision:Number.MAX_SAFE_INTEGER+1},
    {command:{type:"finish"},expectedRevision:0,userId:"bob"},
    {command:{type:"finish",userId:"bob"},expectedRevision:0},
  ])("PATCH_rejects_invalid_command_without_writing_or_echoing_input: %j",async body=>{
    const route=await import("@/app/api/settings/onboarding/route");
    const response=await route.PATCH(patch(body));
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("fixture-private-token");
    expect(await new D1OnboardingRepository(database.db,{userId:"alice"}).get()).toBeNull();
  });

  it("PATCH_bounds_body_even_without_content_length",async()=>{
    const route=await import("@/app/api/settings/onboarding/route");
    const response=await route.PATCH(new Request("https://mykairos.me/api/settings/onboarding",{
      method:"PATCH",body:" ".repeat(16_385)+JSON.stringify({command:{type:"finish"},expectedRevision:0}),
    }));
    expect(response.status).toBe(413);
    expect(await new D1OnboardingRepository(database.db,{userId:"alice"}).get()).toBeNull();
  });

  it("PATCH_rejects_malformed_JSON",async()=>{
    const route=await import("@/app/api/settings/onboarding/route");
    expect((await route.PATCH(new Request("https://mykairos.me/api/settings/onboarding",{method:"PATCH",body:"{"}))).status).toBe(400);
  });

  it("tenant_state_isolated_across_authenticated_sessions",async()=>{
    const route=await import("@/app/api/settings/onboarding/route");
    await route.PATCH(patch({command:{type:"save-draft",drafts:{edCourseIds:["7"]}},expectedRevision:0}));
    runtime.get.mockResolvedValue({kind:"hosted",db:database.db,scope:{userId:"bob"}});
    expect(await (await route.GET()).json()).toMatchObject({state:{revision:0,drafts:{}}});
    await route.PATCH(patch({command:{type:"visit",step:"firefox"},expectedRevision:0}));
    expect(await new D1OnboardingRepository(database.db,{userId:"alice"}).get()).toMatchObject({revision:1,drafts:{edCourseIds:["7"]}});
  });

  it("GET_and_PATCH_require_authentication",async()=>{
    runtime.get.mockRejectedValue(new AuthenticationRequiredError());
    const route=await import("@/app/api/settings/onboarding/route");
    for(const response of [await route.GET(),await route.PATCH(patch({command:{type:"finish"},expectedRevision:0}))]){
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({code:"AUTH_REQUIRED"});
    }
  });

  it("storage_errors_use_safe_unavailable_response",async()=>{
    database.sqlite.exec("DROP TABLE app_settings;");
    const route=await import("@/app/api/settings/onboarding/route");
    const response=await route.GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({code:"ONBOARDING_UNAVAILABLE",message:"Setup progress is temporarily unavailable."});
  });
});
