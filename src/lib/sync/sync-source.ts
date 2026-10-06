import "server-only";
import {D1AssignmentRepository} from "@/lib/db/d1/repositories/assignments";
import {D1SourceConnectionRepository} from "@/lib/db/d1/repositories/source-connections";
import {D1SourceCredentialRepository} from "@/lib/db/d1/repositories/source-credentials";
import {CanvasIcalSource} from "@/lib/sources/canvas-ical/source";
import {CanvasSourceError} from "@/lib/sources/canvas-ical/errors";
import {normalizeSourceAssignment} from "@/lib/assignments/normalize";
import {acquireSyncLock} from "./lock";
import {SyncServiceError,type SyncDependencies,type SyncSummary} from "./types";

export async function syncCanvasConnection(
  connectionId:string,
  deps:SyncDependencies,
):Promise<SyncSummary>{
  const release=acquireSyncLock(`${deps.scope.userId}:${connectionId}`);
  if(!release){
    throw new SyncServiceError("SYNC_IN_PROGRESS","A Canvas sync is already running.");
  }

  const now=deps.now??(()=>new Date());
  const connections=new D1SourceConnectionRepository(deps.db,deps.scope);
  const credentials=new D1SourceCredentialRepository(deps.db,deps.scope,deps.keyring);
  const assignments=new D1AssignmentRepository(deps.db,deps.scope);

  try{
    const connection=await connections.getById(connectionId);
    if(!connection || connection.kind!=="canvas"){
      throw new SyncServiceError("CANVAS_NOT_CONFIGURED","Connect Canvas before syncing.");
    }

    const raw=await credentials.getCanvasFeedUrl(connectionId);
    if(!raw){
      throw new SyncServiceError("CANVAS_NOT_CONFIGURED","Connect Canvas before syncing.");
    }

    const started=now().toISOString();
    await connections.markSyncStarted(connectionId,started);

    const source=deps.sourceFactory?.(new URL(raw))
      ??new CanvasIcalSource(new URL(raw));
    const sourceRows=await source.sync();
    const completed=now().toISOString();
    const result=await assignments.upsertMany(
      connectionId,
      sourceRows.map(row=>normalizeSourceAssignment("canvas",row)),
      completed,
    );
    const report=source.getLastParseReport();
    const partial=report.errors.length>0;
    await connections.markSyncSuccess(
      connectionId,
      completed,
      partial?"PARTIAL_PARSE":null,
    );
    return {
      connectionId,
      ...result,
      skipped:report.skipped,
      errors:report.errors,
      partial,
      completedAt:completed,
    };
  }catch(error){
    const scoped=await connections.getById(connectionId);
    if(scoped){
      const completed=now().toISOString();
      const code=error instanceof SyncServiceError||error instanceof CanvasSourceError
        ?error.code
        :"SYNC_FAILED";
      await connections.markSyncError(connectionId,completed,code);
    }
    throw error instanceof Error
      ?error
      :new SyncServiceError("SYNC_FAILED","Canvas sync failed.");
  }finally{
    release();
  }
}
