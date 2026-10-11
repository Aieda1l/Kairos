import "server-only";
import {AbuseStorageUnavailableError,type ControlKey} from "@/lib/abuse/types";
import type {D1DatabaseLike} from "@/lib/db/d1/types";

export const CONTROL_KEYS:readonly ControlKey[]=Object.freeze([
  "auth:initiation","auth:google","auth:microsoft-entra-id",
  "provider:canvas","provider:gradescope","provider:ed","provider:google","provider:microsoft","provider:caldav",
]);
export class D1AbuseControlRepository{
  constructor(private readonly db:D1DatabaseLike){}
  async get(key:ControlKey):Promise<{enabled:boolean;version:number}>{
    try{
      if(!CONTROL_KEYS.includes(key))throw new AbuseStorageUnavailableError();
      const row=await this.db.prepare("SELECT enabled,version FROM abuse_controls WHERE control_key=?")
        .bind(key).first<{enabled:number;version:number}>();
      if(!row||(row.enabled!==0&&row.enabled!==1)||!Number.isSafeInteger(row.version)||row.version<0)throw new AbuseStorageUnavailableError();
      return {enabled:row.enabled===1,version:row.version};
    }catch{throw new AbuseStorageUnavailableError();}
  }
}
