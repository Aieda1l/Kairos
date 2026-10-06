import {z} from "zod";
import {getDatabase} from "@/lib/db/client";
import {migrate} from "@/lib/db/migrate";

const schema=z.object({dueAt:z.string().datetime()}).strict();
const FIXTURE_EXTERNAL_ID="event-assignment-4242";

export async function POST(request:Request){
  if(process.env.E2E_FIXTURES!=="1"){
    return new Response("Not found",{status:404});
  }
  let body:unknown;
  try{body=await request.json();}catch{body=null;}
  const parsed=schema.safeParse(body);
  if(!parsed.success){
    return Response.json({message:"Invalid fixture due date."},{status:400});
  }
  const db=getDatabase();
  migrate(db);
  const now=new Date().toISOString();
  const result=db.prepare(
    "UPDATE assignments SET due_at=?,updated_at=? WHERE source_kind=? AND external_id=?",
  ).run(parsed.data.dueAt,now,"canvas",FIXTURE_EXTERNAL_ID);
  if(result.changes!==1){
    return Response.json({message:"Fixture assignment not found."},{status:404});
  }
  return Response.json({
    ok:true,
    externalId:FIXTURE_EXTERNAL_ID,
    dueAt:parsed.data.dueAt,
  });
}
