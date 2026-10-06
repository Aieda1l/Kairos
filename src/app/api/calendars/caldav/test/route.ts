import {z} from "zod";
import {testCaldavCredentials} from "@/lib/calendar/connection-service";
import {CalendarSyncError} from "@/lib/calendar/errors";
const schema=z.object({username:z.string().min(1),secret:z.string().min(1)}).strict();
export async function POST(request:Request){
  let body:unknown;try{body=await request.json();}catch{body=null;}
  const parsed=schema.safeParse(body);if(!parsed.success)return Response.json({code:"INVALID_REQUEST",message:"Enter an Apple Account email and app-specific password."},{status:400});
  try{return Response.json({ok:true,...await testCaldavCredentials(parsed.data.username,parsed.data.secret)});}
  catch(error){
    const e=error instanceof CalendarSyncError?error:new CalendarSyncError("CALENDAR_UPSTREAM_ERROR","Apple Calendar could not be tested.");
    return Response.json({code:e.code,message:e.message},{status:(e.code==="CALENDAR_AUTH_EXPIRED"||e.code==="CALENDAR_AUTH_REQUIRED")?401:502});
  }
}
