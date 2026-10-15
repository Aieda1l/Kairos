// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {webcrypto} from "node:crypto";
import {openD1TestDatabase} from "../helpers/d1-test-db";
import {D1SourceConnectionRepository} from "@/lib/db/d1/repositories/source-connections";
import {D1SourceCredentialRepository} from "@/lib/db/d1/repositories/source-credentials";
import {D1CalendarConnectionRepository} from "@/lib/db/d1/repositories/calendar-connections";
import {D1CalendarCredentialRepository} from "@/lib/db/d1/repositories/calendar-credentials";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";

const {runtime,abuse}=vi.hoisted(()=>({runtime:vi.fn(),abuse:vi.fn()}));
vi.mock("@/lib/platform/source-api-runtime",()=>({resolveSourceApiRuntime:async()=>({ok:true,runtime:runtime()})}));
vi.mock("@/lib/platform/calendar-runtime",()=>({getCalendarRouteRuntime:async()=>runtime()}));
vi.mock("@/lib/platform/abuse-runtime",()=>({getAbuseRuntime:abuse}));
beforeEach(()=>{vi.stubGlobal("crypto",webcrypto);localStorage.clear();sessionStorage.clear();});
afterEach(()=>{vi.unstubAllGlobals();document.body.innerHTML="";});

it("source and calendar APIs expose metadata without stored credentials or ciphertext",async()=>{
  const {db,sqlite,close}=openD1TestDatabase();
  const scope={userId:"alice"};
  const keyring={activeKeyId:"v1",keys:{v1:new Uint8Array(32).fill(21)}};
  sqlite.prepare("INSERT INTO users(id,name,email) VALUES ('alice','Alice','alice@example.invalid')").run();
  runtime.mockReturnValue({kind:"hosted",db,scope,keyring});
  const secrets=["https://canvas.example.invalid/private-feed-never-echo.ics","ed-token-never-echo","calendar-refresh-never-echo","icloud-password-never-echo"];
  try{
    const sources=new D1SourceConnectionRepository(db,scope);
    const canvas=await sources.upsertCanvas("Canvas");
    const ed=await sources.upsertEd("Ed");
    const credentials=new D1SourceCredentialRepository(db,scope,keyring);
    await credentials.setCanvasFeedUrl(canvas.id,secrets[0]);
    await credentials.setEdApiToken(ed.id,secrets[1]);
    const calendars=new D1CalendarConnectionRepository(db,scope);
    const google=await calendars.create({provider:"google",label:"Google"});
    const apple=await calendars.create({provider:"caldav",label:"iCloud"});
    const calendarCredentials=new D1CalendarCredentialRepository(db,scope,keyring);
    await calendarCredentials.setOAuthRefreshToken(google.id,secrets[2]);
    await calendarCredentials.setCaldavCredentials(apple.id,"alice@example.invalid",secrets[3]);
    const envelopes=sqlite.prepare(`
      SELECT canvas_feed_url_envelope AS value FROM source_credentials WHERE canvas_feed_url_envelope IS NOT NULL
      UNION ALL SELECT ed_api_token_envelope FROM source_credentials WHERE ed_api_token_envelope IS NOT NULL
      UNION ALL SELECT oauth_refresh_token_envelope FROM calendar_credentials WHERE oauth_refresh_token_envelope IS NOT NULL
      UNION ALL SELECT caldav_secret_envelope FROM calendar_credentials WHERE caldav_secret_envelope IS NOT NULL
    `).all() as Array<{value:string}>;
    const routes=[await import("@/app/api/calendars/route"),await import("@/app/api/sources/ed/courses/route"),await import("@/app/api/sources/gradescope/courses/route")];
    for(const route of routes){
      const response=await route.GET();
      expect(response.status).toBe(200);
      const body=await response.text();
      for(const secret of secrets)expect(body).not.toContain(secret);
      for(const {value} of envelopes)expect(body).not.toContain(value);
    }
  }finally{close();}
});

it("drafts_never_appear_in_public_html_api_storage_or_bridge",async()=>{
  const {db,sqlite,close}=openD1TestDatabase();
  const scope={userId:"privacy-synthetic"};
  const keyring={activeKeyId:"synthetic",keys:{synthetic:new Uint8Array(32).fill(21)}};
  sqlite.prepare("INSERT INTO users(id) VALUES (?)").run(scope.userId);
  runtime.mockReturnValue({kind:"hosted",db,scope,keyring});
  abuse.mockResolvedValue({db,hmacKey:new Uint8Array(32).fill(7),appOrigin:"https://synthetic.invalid",hostname:"synthetic.invalid",turnstileSecret:"synthetic",fetchImpl:fetch});
  const info=vi.spyOn(console,"info").mockImplementation(()=>{});
  const warn=vi.spyOn(console,"warn").mockImplementation(()=>{});
  const candidates=[
    {kind:"canvas",feedUrl:"https://canvas.uw.edu/feeds/calendars/candidate-private-feed.ics"},
    {kind:"ed",token:"candidate-private-token"},
    {kind:"caldav",username:"candidate-private-account@example.invalid",secret:"candidate-private-password"},
  ];
  const privateValues=candidates.flatMap(candidate=>Object.entries(candidate).filter(([key])=>key!=="kind").map(([,value])=>value));
  const routes=import.meta.glob<{PUT:(request:Request)=>Promise<Response>;GET:()=>Promise<Response>}>("../../src/app/api/settings/onboarding/draft/route.ts");
  try{
    const loader=routes["../../src/app/api/settings/onboarding/draft/route.ts"];
    expect(loader).toBeDefined();if(!loader)return;
    const draft=await loader();const outputs:string[]=[];
    for(const candidate of candidates){
      const response=await draft.PUT(new Request("https://synthetic.invalid/api/settings/onboarding/draft",{method:"PUT",body:JSON.stringify(candidate)}));
      expect(response.status).toBe(200);outputs.push(await response.text());
    }
    const envelopes=sqlite.prepare("SELECT value FROM app_settings WHERE user_id=? AND key LIKE 'onboarding_draft:%'").all(scope.userId) as {value:string}[];
    expect(envelopes).toHaveLength(3);
    const stored=JSON.stringify(sqlite.prepare("SELECT * FROM app_settings WHERE user_id=?").all(scope.userId));
    for(const value of privateValues)expect(stored).not.toContain(value);
    const api=[draft,await import("@/app/api/settings/onboarding/route"),await import("@/app/api/calendars/route"),await import("@/app/api/sources/ed/courses/route")];
    for(const route of api){const response=await route.GET();expect(response.status).toBe(200);outputs.push(await response.text());}
    const {default:Home}=await import("@/app/page");
    const html=renderToStaticMarkup(createElement(Home));outputs.push(html);
    document.body.innerHTML=html;
    outputs.push(document.body.innerHTML,JSON.stringify(localStorage),JSON.stringify(sessionStorage));
    const start=await import("@/app/api/sources/gradescope/discover/start/route");
    const response=await start.POST();expect(response.status).toBe(200);outputs.push(await response.text());
    outputs.push(JSON.stringify(sqlite.prepare("SELECT payload_json FROM sync_requests WHERE user_id=?").all(scope.userId)));
    outputs.push(JSON.stringify(info.mock.calls),JSON.stringify(warn.mock.calls));
    for(const output of outputs){
      for(const value of privateValues)expect(output).not.toContain(value);
      for(const {value} of envelopes)expect(output).not.toContain(value);
    }
  }finally{abuse.mockReset();info.mockRestore();warn.mockRestore();close();}
});
