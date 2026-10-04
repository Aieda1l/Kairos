import {z} from "zod";import {getDatabase} from "@/lib/db/client";import {migrate} from "@/lib/db/migrate";import {SettingsRepository} from "@/lib/db/repositories/settings";
const schema=z.object({timeZone:z.string().min(1).max(100)});
function repo(){const db=getDatabase();migrate(db);return new SettingsRepository(db);}
export async function GET(){return Response.json({timeZone:repo().getTimeZone()});}
export async function PUT(request:Request){let body:unknown;try{body=await request.json();}catch{return Response.json({code:"INVALID_REQUEST",message:"Choose a valid timezone."},{status:400});}const parsed=schema.safeParse(body);if(!parsed.success)return Response.json({code:"INVALID_REQUEST",message:"Choose a valid timezone."},{status:400});try{repo().setTimeZone(parsed.data.timeZone);return Response.json({timeZone:parsed.data.timeZone});}catch{return Response.json({code:"INVALID_TIMEZONE",message:"Choose a valid IANA timezone."},{status:400});}}
