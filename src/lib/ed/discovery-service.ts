import "server-only";
import type {LegacyDatabase} from "@/lib/db/legacy-types";
import type {SourceConnection} from "@/lib/assignments/types";
import type {UserScope} from "@/lib/auth/user-scope";
import type {D1DatabaseLike} from "@/lib/db/d1/types";
import {D1SourceConnectionRepository} from "@/lib/db/d1/repositories/source-connections";
import {D1SourceCredentialRepository} from "@/lib/db/d1/repositories/source-credentials";
import {D1SourceCourseRepository} from "@/lib/db/d1/repositories/source-courses";
import {SourceConnectionRepository} from "@/lib/db/repositories/source-connections";
import {SourceCredentialRepository} from "@/lib/db/repositories/source-credentials";
import {SourceCourseRepository} from "@/lib/db/repositories/source-courses";
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

async function requireConnectedEdHosted(
  db:D1DatabaseLike,
  scope:UserScope,
  keyring:CredentialKeyring,
):Promise<{connection:SourceConnection;token:string}>{
  const connection=await new D1SourceConnectionRepository(db,scope).getByKind("ed");
  if(!connection){
    throw new EdDiscoveryServiceError("ED_NOT_CONNECTED","Connect Ed before managing courses.");
  }
  const token=await new D1SourceCredentialRepository(db,scope,keyring).getEdApiToken(connection.id);
  if(!token){
    throw new EdDiscoveryServiceError("ED_NOT_CONNECTED","Connect Ed before managing courses.");
  }
  return {connection,token};
}

function requireConnectedEdLegacy(
  db:LegacyDatabase,
):{connection:SourceConnection;token:string}{
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

export function connectEd(
  db:LegacyDatabase,
  token:string,
  fetchImpl?:typeof fetch,
  now?:Date,
):Promise<{connection:SourceConnection;courses:SourceCourse[]}>;
export function connectEd(
  db:D1DatabaseLike,
  scope:UserScope,
  keyring:CredentialKeyring,
  token:string,
  fetchImpl?:typeof fetch,
  now?:Date,
):Promise<{connection:SourceConnection;courses:SourceCourse[]}>;
export async function connectEd(
  db:LegacyDatabase|D1DatabaseLike,
  arg2:string|UserScope,
  arg3?:typeof fetch|CredentialKeyring,
  arg4?:Date|string,
  arg5?:typeof fetch,
  arg6?:Date,
):Promise<{connection:SourceConnection;courses:SourceCourse[]}>{
  if(typeof arg2==="string"){
    const legacyDb=db as LegacyDatabase;
    const token=arg2;
    const fetchImpl=(arg3 as typeof fetch|undefined)??fetch;
    const now=arg4 instanceof Date?arg4:new Date();
    const payload=await new EdApiClient(token,fetchImpl).fetchUser();
    const discovered=parseEdCourses(payload);
    const seenAt=now.toISOString();
    const connectionRepo=new SourceConnectionRepository(legacyDb);
    const credentialRepo=new SourceCredentialRepository(legacyDb);
    const courseRepo=new SourceCourseRepository(legacyDb);
    let connection!:SourceConnection;
    legacyDb.transaction(()=>{
      connection=connectionRepo.upsertEd("Ed");
      credentialRepo.setEdApiToken(connection.id,token);
      courseRepo.upsertDiscovered(connection.id,discovered,seenAt);
    })();
    return {connection,courses:courseRepo.list(connection.id)};
  }

  const hostedDb=db as D1DatabaseLike;
  const scope=arg2;
  const keyring=arg3 as CredentialKeyring;
  const token=arg4 as string;
  const fetchImpl=arg5??fetch;
  const now=arg6??new Date();
  const payload=await new EdApiClient(token,fetchImpl).fetchUser();
  const discovered=parseEdCourses(payload);
  const seenAt=now.toISOString();
  const connectionRepo=new D1SourceConnectionRepository(hostedDb,scope);
  const credentialRepo=new D1SourceCredentialRepository(hostedDb,scope,keyring);
  const courseRepo=new D1SourceCourseRepository(hostedDb,scope);
  const connection=await connectionRepo.upsertEd("Ed");
  await credentialRepo.setEdApiToken(connection.id,token);
  await courseRepo.upsertDiscovered(connection.id,discovered,seenAt);
  return {connection,courses:await courseRepo.list(connection.id)};
}

export function refreshEdCourses(
  db:LegacyDatabase,
  fetchImpl?:typeof fetch,
  now?:Date,
):Promise<{connection:SourceConnection;courses:SourceCourse[]}>;
export function refreshEdCourses(
  db:D1DatabaseLike,
  scope:UserScope,
  keyring:CredentialKeyring,
  fetchImpl?:typeof fetch,
  now?:Date,
):Promise<{connection:SourceConnection;courses:SourceCourse[]}>;
export async function refreshEdCourses(
  db:LegacyDatabase|D1DatabaseLike,
  arg2?:typeof fetch|UserScope,
  arg3?:Date|CredentialKeyring,
  arg4?:typeof fetch,
  arg5?:Date,
):Promise<{connection:SourceConnection;courses:SourceCourse[]}>{
  if(typeof arg2==="function"||arg2===undefined){
    const legacyDb=db as LegacyDatabase;
    const {connection,token}=requireConnectedEdLegacy(legacyDb);
    const payload=await new EdApiClient(token,arg2??fetch).fetchUser();
    const discovered=parseEdCourses(payload);
    const courseRepo=new SourceCourseRepository(legacyDb);
    courseRepo.upsertDiscovered(connection.id,discovered,(arg3 instanceof Date?arg3:new Date()).toISOString());
    return {connection,courses:courseRepo.list(connection.id)};
  }

  const hostedDb=db as D1DatabaseLike;
  const scope=arg2;
  const keyring=arg3 as CredentialKeyring;
  const {connection,token}=await requireConnectedEdHosted(hostedDb,scope,keyring);
  const payload=await new EdApiClient(token,arg4??fetch).fetchUser();
  const courseRepo=new D1SourceCourseRepository(hostedDb,scope);
  await courseRepo.upsertDiscovered(
    connection.id,
    parseEdCourses(payload),
    (arg5??new Date()).toISOString(),
  );
  return {connection,courses:await courseRepo.list(connection.id)};
}

export function replaceEnabledEdCourses(
  db:LegacyDatabase,
  enabledCourseIds:string[],
):{connection:SourceConnection;courses:SourceCourse[]};
export function replaceEnabledEdCourses(
  db:D1DatabaseLike,
  scope:UserScope,
  keyring:CredentialKeyring,
  enabledCourseIds:string[],
):Promise<{connection:SourceConnection;courses:SourceCourse[]}>;
export function replaceEnabledEdCourses(
  db:LegacyDatabase|D1DatabaseLike,
  arg2:string[]|UserScope,
  arg3?:CredentialKeyring,
  arg4?:string[],
):{connection:SourceConnection;courses:SourceCourse[]}|Promise<{connection:SourceConnection;courses:SourceCourse[]}>{
  if(Array.isArray(arg2)){
    const legacyDb=db as LegacyDatabase;
    const {connection}=requireConnectedEdLegacy(legacyDb);
    const courseRepo=new SourceCourseRepository(legacyDb);
    const discovered=courseRepo.list(connection.id);
    const known=new Set(discovered.map(course=>course.externalCourseId));
    if(arg2.some(courseId=>!known.has(courseId))){
      throw new EdDiscoveryServiceError(
        "INVALID_COURSE_SELECTION",
        "Select only courses discovered from your Ed account.",
      );
    }
    courseRepo.setEnabled(connection.id,arg2);
    return {connection,courses:courseRepo.list(connection.id)};
  }

  return (async()=>{
    const hostedDb=db as D1DatabaseLike;
    const scope=arg2;
    const {connection}=await requireConnectedEdHosted(hostedDb,scope,arg3!);
    const courseRepo=new D1SourceCourseRepository(hostedDb,scope);
    const discovered=await courseRepo.list(connection.id);
    const known=new Set(discovered.map(course=>course.externalCourseId));
    const enabledCourseIds=arg4??[];
    if(enabledCourseIds.some(courseId=>!known.has(courseId))){
      throw new EdDiscoveryServiceError(
        "INVALID_COURSE_SELECTION",
        "Select only courses discovered from your Ed account.",
      );
    }
    await courseRepo.setEnabled(connection.id,enabledCourseIds);
    return {connection,courses:await courseRepo.list(connection.id)};
  })();
}
