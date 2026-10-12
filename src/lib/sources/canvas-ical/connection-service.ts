import {currentProviderWork,withProviderService} from "@/lib/abuse/provider-operation";
import "server-only";
import {z} from "zod";
import type {SourceConnection} from "@/lib/assignments/types";
import {normalizeSourceAssignment} from "@/lib/assignments/normalize";
import {D1AssignmentRepository} from "@/lib/db/d1/repositories/assignments";
import {D1SourceConnectionRepository} from "@/lib/db/d1/repositories/source-connections";
import {D1SourceCredentialRepository} from "@/lib/db/d1/repositories/source-credentials";
import {AssignmentRepository} from "@/lib/db/repositories/assignments";
import {SourceConnectionRepository} from "@/lib/db/repositories/source-connections";
import {SourceCredentialRepository} from "@/lib/db/repositories/source-credentials";
import type {SourceRouteRuntime} from "@/lib/platform/source-api-runtime";
import type {SourceRuntimeContext} from "@/lib/platform/source-runtime";
import type {SyncSummary} from "@/lib/sync/types";
import {CanvasIcalSource} from "./source";
import {CanvasSourceError} from "./errors";
import {validateCanvasFeedUrl} from "./validate-url";

type ConnectInput={feedUrl:string;label?:string};

export const canvasConnectSchema=z.object({
  feedUrl:z.string().min(1),label:z.string().trim().min(1).max(80).optional(),
});

export async function connectCanvas(
  runtime:SourceRuntimeContext|SourceRouteRuntime,
  input:ConnectInput,
):Promise<{connection:SourceConnection;sync:SyncSummary}>{
  if(!("kind" in runtime&&runtime.kind==="legacy")){
    const hosted=runtime as SourceRuntimeContext;
    if(!currentProviderWork(hosted.db,hosted.scope,"canvas","credential"))return withProviderService(hosted.db,hosted.scope,{provider:"canvas",operation:"credential"},()=>connectCanvas(runtime,input));
  }
  input=canvasConnectSchema.parse(input);
  const url=validateCanvasFeedUrl(input.feedUrl);
  const startedAt=new Date().toISOString();
  const source=new CanvasIcalSource(url);
  const rows=(await source.sync()).map(row=>normalizeSourceAssignment("canvas",row));
  const report=source.getLastParseReport();
  if(rows.length===0&&report.errors.length>0){
    throw new CanvasSourceError("INVALID_ICAL","Canvas returned a calendar feed that could not be read.");
  }
  const completedAt=new Date().toISOString();
  const partial=report.errors.length>0;
  const label=input.label??"Canvas";

  if("kind" in runtime&&runtime.kind==="legacy"){
    const connections=new SourceConnectionRepository(runtime.db);
    const credentials=new SourceCredentialRepository(runtime.db);
    const assignments=new AssignmentRepository(runtime.db);
    return runtime.db.transaction(()=>{
      const connection=connections.upsertCanvas(label);
      credentials.setCanvasFeedUrl(connection.id,url.toString());
      const counts=assignments.upsertMany(connection.id,rows,completedAt);
      connections.markSyncStarted(connection.id,startedAt);
      connections.markSyncSuccess(connection.id,completedAt,partial?"PARTIAL_PARSE":null);
      return {
        connection:connections.getByKind("canvas")!,
        sync:{connectionId:connection.id,...counts,...report,partial,completedAt},
      };
    })();
  }

  const hosted=runtime as SourceRuntimeContext;
  const connections=new D1SourceConnectionRepository(hosted.db,hosted.scope);
  const credentials=new D1SourceCredentialRepository(hosted.db,hosted.scope,hosted.keyring);
  const assignments=new D1AssignmentRepository(hosted.db,hosted.scope);
  const existing=await connections.getByKind("canvas");
  const id=existing?.id??crypto.randomUUID();
  const credential=await credentials.prepareCanvasFeedUrl(id,url.toString());
  const results=await hosted.db.batch([
    connections.prepareUpsert(id,"canvas",label,completedAt),
    credential,
    assignments.prepareCountNew(id,rows),
    assignments.prepareUpsertMany(id,rows,completedAt),
    connections.prepareSyncStarted(id,startedAt),
    connections.prepareSyncSuccess(id,completedAt,partial?"PARTIAL_PARSE":null),
  ]);
  const inserted=(results[2]!.results[0] as {inserted:number}).inserted;
  return {
    connection:{id,kind:"canvas",label,enabled:true,lastSyncStartedAt:startedAt,
      lastSyncCompletedAt:completedAt,lastSyncStatus:"success",lastErrorCode:partial?"PARTIAL_PARSE":null},
    sync:{connectionId:id,inserted,updated:rows.length-inserted,...report,partial,completedAt},
  };
}

/** Shared by regular and saved-candidate consumers. */
export async function testCanvasConnection(runtime:SourceRuntimeContext|SourceRouteRuntime,feedUrl:string){
  const work=()=>new CanvasIcalSource(validateCanvasFeedUrl(feedUrl)).testConnection();
  if("kind" in runtime&&runtime.kind==="legacy")return work();
  const hosted=runtime as SourceRuntimeContext;
  return withProviderService(hosted.db,hosted.scope,{provider:"canvas",operation:"credential"},work);
}
