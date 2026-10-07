import {resetE2ECalendarFixture} from "@/lib/calendar/e2e-fixture-fetch";
import {getAuthenticatedE2EFixtureRuntime} from "@/lib/testing/e2e-runtime";

export async function POST(){
  const runtime=await getAuthenticatedE2EFixtureRuntime();
  if(!runtime){
    return new Response("Not found",{status:404});
  }

  for(const table of [
    "source_connections",
    "calendar_connections",
    "app_settings",
    "sync_requests",
    "oauth_requests",
  ]){
    await runtime.db.prepare(`DELETE FROM ${table} WHERE user_id=?`)
      .bind(runtime.userId)
      .run();
  }

  resetE2ECalendarFixture();
  return Response.json({ok:true});
}
