import {z} from "zod";
import {getE2EFixtureRuntime} from '@/lib/testing/e2e-runtime';
import {
  deleteE2ECalendarFixtureEvent,
  setE2ECalendarFixtureMode,
} from "@/lib/calendar/e2e-fixture-fetch";

const schema=z.union([
  z.object({mode:z.enum(["normal","network-error"])}).strict(),
  z.object({action:z.literal("delete-event"),eventId:z.string().min(1)}).strict(),
]);

export async function POST(request:Request){
  if(!await getE2EFixtureRuntime(request)){
    return new Response("Not found",{status:404});
  }
  let body:unknown;
  try{body=await request.json();}catch{body=null;}
  const parsed=schema.safeParse(body);
  if(!parsed.success){
    return Response.json({message:"Invalid calendar fixture mode."},{status:400});
  }
  if("mode" in parsed.data){
    setE2ECalendarFixtureMode(parsed.data.mode);
    return Response.json({ok:true,mode:parsed.data.mode});
  }
  return Response.json({
    ok:true,
    deleted:deleteE2ECalendarFixtureEvent(parsed.data.eventId),
  });
}
