import {resetE2ECalendarFixture} from "@/lib/calendar/e2e-fixture-fetch";
import {getAuthenticatedE2EFixtureRuntime} from "@/lib/testing/e2e-runtime";

export async function POST(request:Request){
  const runtime=await getAuthenticatedE2EFixtureRuntime(request);
  if(!runtime){
    return new Response("Not found",{status:404});
  }

  const tables=[
    "source_connections",
    "calendar_connections",
    "app_settings",
    "sync_requests",
    "oauth_requests",
    // Reset synthetic admission history, retaining all run/ownership metadata.
    "abuse_rate_events",
  ];
  const pending="SELECT 1 FROM operation_locks WHERE user_id=? AND state IN ('running','uncertain')";
  const results=await runtime.db.batch([
    runtime.db.prepare(`SELECT COUNT(*) AS pending FROM (${pending})`).bind(runtime.userId),
    ...tables.map(table=>runtime.db.prepare(`DELETE FROM ${table} WHERE user_id=? AND NOT EXISTS (${pending})`)
      .bind(runtime.userId,runtime.userId)),
  ]);
  const count=results[0]?.results[0]?.pending;
  if(results.some(result=>!result.success)||typeof count!=='number')return Response.json({code:'FIXTURE_RESET_UNAVAILABLE'},{status:503});
  if(count>0)return Response.json({code:'FIXTURE_WORK_PENDING'},{status:409});

  resetE2ECalendarFixture();
  return Response.json({ok:true});
}
