import {
  getE2ECalendarFixtureState,
} from "@/lib/calendar/e2e-fixture-fetch";

export async function GET(){
  if(process.env.E2E_FIXTURES!=="1"){
    return new Response("Not found",{status:404});
  }
  return Response.json(getE2ECalendarFixtureState(),{
    headers:{"cache-control":"no-store"},
  });
}
