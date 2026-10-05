import "server-only";
import type Database from "better-sqlite3";
import type { SourceConnection } from "@/lib/assignments/types";
import type { SourceCourse } from "@/lib/sources/types";
import { SourceConnectionRepository } from "@/lib/db/repositories/source-connections";
import { SourceCredentialRepository } from "@/lib/db/repositories/source-credentials";
import { SourceCourseRepository } from "@/lib/db/repositories/source-courses";
import { EdApiClient } from "@/lib/sources/ed/client";
import { parseEdCourses } from "@/lib/sources/ed/parser";

export type EdDiscoveryServiceCode =
  | "ED_NOT_CONNECTED"
  | "INVALID_COURSE_SELECTION";

export class EdDiscoveryServiceError extends Error{
  constructor(public readonly code:EdDiscoveryServiceCode,message:string){
    super(message);
    this.name="EdDiscoveryServiceError";
  }
}

export async function testEdConnection(
  token:string,
  fetchImpl:typeof fetch=fetch,
):Promise<{ok:true;itemCount:number}>{
  const payload=await new EdApiClient(token,fetchImpl).fetchUser();
  return {ok:true,itemCount:parseEdCourses(payload).length};
}

export async function connectEd(
  db:Database.Database,
  token:string,
  fetchImpl:typeof fetch=fetch,
  now:Date=new Date(),
):Promise<{connection:SourceConnection;courses:SourceCourse[]}>{
  const payload=await new EdApiClient(token,fetchImpl).fetchUser();
  const discovered=parseEdCourses(payload);
  const seenAt=now.toISOString();
  const connectionRepo=new SourceConnectionRepository(db);
  const credentialRepo=new SourceCredentialRepository(db);
  const courseRepo=new SourceCourseRepository(db);
  let connection!:SourceConnection;
  db.transaction(()=>{
    connection=connectionRepo.upsertEd("Ed");
    credentialRepo.setEdApiToken(connection.id,token);
    courseRepo.upsertDiscovered(connection.id,discovered,seenAt);
  })();
  return {connection,courses:courseRepo.list(connection.id)};
}

function requireConnectedEd(db:Database.Database):{connection:SourceConnection;token:string}{
  const connection=new SourceConnectionRepository(db).getByKind("ed");
  if(!connection){
    throw new EdDiscoveryServiceError("ED_NOT_CONNECTED","Connect Ed before managing courses.");
  }
  const token=new SourceCredentialRepository(db).getEdApiToken(connection.id);
  if(!token){
    throw new EdDiscoveryServiceError("ED_NOT_CONNECTED","Connect Ed before managing courses.");
  }
  return {connection,token};
}

export async function refreshEdCourses(
  db:Database.Database,
  fetchImpl:typeof fetch=fetch,
  now:Date=new Date(),
):Promise<{connection:SourceConnection;courses:SourceCourse[]}>{
  const {connection,token}=requireConnectedEd(db);
  const payload=await new EdApiClient(token,fetchImpl).fetchUser();
  const discovered=parseEdCourses(payload);
  const courseRepo=new SourceCourseRepository(db);
  courseRepo.upsertDiscovered(connection.id,discovered,now.toISOString());
  return {connection,courses:courseRepo.list(connection.id)};
}

export function replaceEnabledEdCourses(
  db:Database.Database,
  enabledCourseIds:string[],
):{connection:SourceConnection;courses:SourceCourse[]}{
  const {connection}=requireConnectedEd(db);
  const courseRepo=new SourceCourseRepository(db);
  const discovered=courseRepo.list(connection.id);
  const known=new Set(discovered.map(course=>course.externalCourseId));
  if(enabledCourseIds.some(courseId=>!known.has(courseId))){
    throw new EdDiscoveryServiceError(
      "INVALID_COURSE_SELECTION",
      "Select only courses discovered from your Ed account.",
    );
  }
  courseRepo.setEnabled(connection.id,enabledCourseIds);
  return {connection,courses:courseRepo.list(connection.id)};
}
