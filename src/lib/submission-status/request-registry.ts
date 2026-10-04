import "server-only";
import type { CanvasAssignmentLocator } from "@/lib/submission-status/types";

const REQUEST_TTL_MS=10*60*1000;

export type RegisteredSubmissionSyncRequest={
  requestId:string;
  connectionId:string;
  assignments:CanvasAssignmentLocator[];
  startedAt:string;
  expiresAt:number;
};

export class SubmissionSyncRequestRegistry {
  private entries=new Map<string,RegisteredSubmissionSyncRequest>();

  register(requestId:string,connectionId:string,assignments:CanvasAssignmentLocator[],startedAt:string):void {
    this.entries.set(requestId,{
      requestId,
      connectionId,
      assignments:assignments.map(item=>({...item})),
      startedAt,
      expiresAt:Date.parse(startedAt)+REQUEST_TTL_MS,
    });
  }

  consume(requestId:string,nowMs=Date.now()):RegisteredSubmissionSyncRequest|null {
    const entry=this.entries.get(requestId);
    if(!entry)return null;
    this.entries.delete(requestId);
    if(!Number.isFinite(entry.expiresAt)||nowMs>entry.expiresAt)return null;
    return entry;
  }

  clear():void {
    this.entries.clear();
  }
}

const registry=new SubmissionSyncRequestRegistry();

export function registerSubmissionSyncRequest(requestId:string,connectionId:string,assignments:CanvasAssignmentLocator[],startedAt:string):void {
  registry.register(requestId,connectionId,assignments,startedAt);
}

export function consumeSubmissionSyncRequest(requestId:string,nowMs?:number):RegisteredSubmissionSyncRequest|null {
  return registry.consume(requestId,nowMs);
}

export function resetSubmissionSyncRequestRegistryForTests():void {
  registry.clear();
}
