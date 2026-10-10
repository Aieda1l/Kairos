import {expect,it,vi} from "vitest";
import {openD1TestDatabase} from "../helpers/d1-test-db";
import {D1SourceConnectionRepository} from "@/lib/db/d1/repositories/source-connections";
import {D1SourceCredentialRepository} from "@/lib/db/d1/repositories/source-credentials";
import {D1CalendarConnectionRepository} from "@/lib/db/d1/repositories/calendar-connections";
import {D1CalendarCredentialRepository} from "@/lib/db/d1/repositories/calendar-credentials";

const {runtime}=vi.hoisted(()=>({runtime:vi.fn()}));
vi.mock("@/lib/platform/source-api-runtime",()=>({resolveSourceApiRuntime:async()=>({ok:true,runtime:runtime()})}));
vi.mock("@/lib/platform/calendar-runtime",()=>({getCalendarRouteRuntime:async()=>runtime()}));

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
