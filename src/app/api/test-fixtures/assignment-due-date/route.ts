import {z} from "zod";
import {getAuthenticatedE2EFixtureRuntime} from "@/lib/testing/e2e-runtime";

const schema=z.object({dueAt:z.string().datetime()}).strict();
const FIXTURE_EXTERNAL_ID="event-assignment-4242";

export async function POST(request:Request){
  const runtime=await getAuthenticatedE2EFixtureRuntime();
  if(!runtime){
    return new Response("Not found",{status:404});
  }

  let body:unknown;
  try{body=await request.json();}catch{body=null;}
  const parsed=schema.safeParse(body);
  if(!parsed.success){
    return Response.json({message:"Invalid fixture due date."},{status:400});
  }

  const now=new Date().toISOString();
  const result=await runtime.db.prepare(
    "UPDATE assignments SET due_at=?,updated_at=? WHERE user_id=? AND source_kind=? AND external_id=?",
  ).bind(
    parsed.data.dueAt,
    now,
    runtime.userId,
    "canvas",
    FIXTURE_EXTERNAL_ID,
  ).run();

  if(result.meta.changes!==1){
    return Response.json({message:"Fixture assignment not found."},{status:404});
  }
  return Response.json({
    ok:true,
    externalId:FIXTURE_EXTERNAL_ID,
    dueAt:parsed.data.dueAt,
  });
}
