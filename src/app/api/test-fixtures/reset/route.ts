import {resetE2ECalendarFixture} from "@/lib/calendar/e2e-fixture-fetch";
import {getE2EFixtureRuntime} from "@/lib/testing/e2e-runtime";

export async function POST(){
  const runtime=await getE2EFixtureRuntime();
  if(!runtime){
    return new Response("Not found",{status:404});
  }

  await runtime.db.prepare("DELETE FROM users WHERE id=?")
    .bind(runtime.userId)
    .run();
  await runtime.db.prepare(
    "INSERT INTO users(id,name,email) VALUES (?,?,?)",
  ).bind(
    runtime.userId,
    "Kairos E2E",
    "kairos-e2e@example.invalid",
  ).run();

  resetE2ECalendarFixture();
  return Response.json({ok:true});
}
