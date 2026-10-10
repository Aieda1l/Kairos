import {beforeEach,expect,it,vi} from "vitest";
import {AuthenticationRequiredError} from "@/lib/auth/user-scope";

const {getRuntime}=vi.hoisted(()=>({getRuntime:vi.fn()}));
vi.mock("@/lib/platform/calendar-runtime",()=>({getCalendarRouteRuntime:getRuntime}));

beforeEach(()=>{getRuntime.mockRejectedValue(new AuthenticationRequiredError());});

it.each([
  ["calendar",{hideSubmitted:true}],
  ["timezone",{timeZone:"America/Los_Angeles"}],
] as const)("returns AUTH_REQUIRED for %s settings after the session ends",async(name,body)=>{
  const route=name==="calendar"
    ?await import("@/app/api/settings/calendar/route")
    :await import("@/app/api/settings/timezone/route");
  for(const response of [await route.GET(),await route.PUT(new Request(`https://mykairos.me/api/settings/${name}`,{
    method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(body),
  }))]){
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({code:"AUTH_REQUIRED",message:"Authentication required."});
  }
});
