import "server-only";
import type {SourceConnection} from "@/lib/assignments/types";
import type {UserScope} from "@/lib/auth/user-scope";
import type {D1DatabaseLike} from "@/lib/db/d1/types";
import {D1SourceConnectionRepository} from "@/lib/db/d1/repositories/source-connections";
import {D1SourceCredentialRepository} from "@/lib/db/d1/repositories/source-credentials";
import {D1SourceCourseRepository} from "@/lib/db/d1/repositories/source-courses";
import type {CredentialKeyring} from "@/lib/security/credential-cipher";
import type {SourceCourse} from "@/lib/sources/types";
import {EdApiClient} from "@/lib/sources/ed/client";
import {parseEdCourses} from "@/lib/sources/ed/parser";

export type EdDiscoveryServiceCode=
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

async function requireConnectedEd(
  db:D1DatabaseLike,
  scope:UserScope,
  keyring:CredentialKeyring,
):Promise<{connection:SourceConnection;token:string}>{
  const connection=await new D1SourceConnectionRepository(db,scope).getByKind("ed");
  if(!connection){
    throw new EdDiscoveryServiceError(
      "ED_NOT_CONNECTED",
      "Connect Ed before managing courses.",
    );
  }
  const token=await new D1SourceCredentialRepository(db,scope,keyring)
    .getEdApiToken(connection.id);
  if(!token){
    throw new EdDiscoveryServiceError(
      "ED_NOT_CONNECTED",
      "Connect Ed before managing courses.",
    );
  }
  return {connection,token};
}

export async function connectEd(
  db:D1DatabaseLike,
  scope:UserScope,
  keyring:CredentialKeyring,
  token:string,
  fetchImpl:typeof fetch=fetch,
  now:Date=new Date(),
):Promise<{connection:SourceConnection;courses:SourceCourse[]}>{
  const payload=await new EdApiClient(token,fetchImpl).fetchUser();
  const discovered=parseEdCourses(payload);
  const seenAt=now.toISOString();

  const connectionRepo=new D1SourceConnectionRepository(db,scope);
  const credentialRepo=new D1SourceCredentialRepository(db,scope,keyring);
  const courseRepo=new D1SourceCourseRepository(db,scope);

  const connection=await connectionRepo.upsertEd("Ed");
  await credentialRepo.setEdApiToken(connection.id,token);
  await courseRepo.upsertDiscovered(connection.id,discovered,seenAt);
  return {connection,courses:await courseRepo.list(connection.id)};
}

export async function refreshEdCourses(
  db:D1DatabaseLike,
  scope:UserScope,
  keyring:CredentialKeyring,
  fetchImpl:typeof fetch=fetch,
  now:Date=new Date(),
):Promise<{connection:SourceConnection;courses:SourceCourse[]}>{
  const {connection,token}=await requireConnectedEd(db,scope,keyring);
  const payload=await new EdApiClient(token,fetchImpl).fetchUser();
  const discovered=parseEdCourses(payload);
  const courseRepo=new D1SourceCourseRepository(db,scope);
  await courseRepo.upsertDiscovered(connection.id,discovered,now.toISOString());
  return {connection,courses:await courseRepo.list(connection.id)};
}

export async function replaceEnabledEdCourses(
  db:D1DatabaseLike,
  scope:UserScope,
  keyring:CredentialKeyring,
  enabledCourseIds:string[],
):Promise<{connection:SourceConnection;courses:SourceCourse[]}>{
  const {connection}=await requireConnectedEd(db,scope,keyring);
  const courseRepo=new D1SourceCourseRepository(db,scope);
  const discovered=await courseRepo.list(connection.id);
  const known=new Set(discovered.map(course=>course.externalCourseId));
  if(enabledCourseIds.some(courseId=>!known.has(courseId))){
    throw new EdDiscoveryServiceError(
      "INVALID_COURSE_SELECTION",
      "Select only courses discovered from your Ed account.",
    );
  }
  await courseRepo.setEnabled(connection.id,enabledCourseIds);
  return {connection,courses:await courseRepo.list(connection.id)};
}
