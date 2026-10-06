import type {UserScope} from "@/lib/auth/user-scope";
import type {D1DatabaseLike} from "@/lib/db/d1/types";
import type {CredentialKeyring} from "@/lib/security/credential-cipher";
import type {CanvasIcalSource} from "@/lib/sources/canvas-ical/source";

export type SyncSummary={
  connectionId:string;
  inserted:number;
  updated:number;
  skipped:number;
  errors:string[];
  partial:boolean;
  completedAt:string;
};

export type SyncDependencies={
  db:D1DatabaseLike;
  scope:UserScope;
  keyring:CredentialKeyring;
  now?:()=>Date;
  sourceFactory?:(url:URL)=>Pick<CanvasIcalSource,"sync"|"getLastParseReport">;
};

export class SyncServiceError extends Error{
  constructor(readonly code:string,message:string){
    super(message);
    this.name="SyncServiceError";
  }
}
