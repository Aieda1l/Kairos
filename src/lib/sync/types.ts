import type Database from "better-sqlite3";import type { CanvasIcalSource } from "@/lib/sources/canvas-ical/source";
export type SyncSummary={connectionId:string;inserted:number;updated:number;skipped:number;errors:string[];partial:boolean;completedAt:string};
export type SyncDependencies={db?:Database.Database;now?:()=>Date;sourceFactory?:(url:URL)=>Pick<CanvasIcalSource,"sync"|"getLastParseReport">};
export class SyncServiceError extends Error{constructor(readonly code:string,message:string){super(message);this.name="SyncServiceError";}}
