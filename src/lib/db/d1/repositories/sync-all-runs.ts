import 'server-only';
import type {D1DatabaseLike} from '@/lib/db/d1/types';
import type {UserScope} from '@/lib/auth/user-scope';
import {AbuseStorageUnavailableError,AbuseSubjectError} from '@/lib/abuse/types';
import type {SyncAllStep} from '@/lib/sync-all/types';

const clock="(CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER))";

export class D1SyncAllRunRepository{
  constructor(private readonly db:D1DatabaseLike,private readonly scope:UserScope){}

  async create(runId:string,steps:SyncAllStep[]):Promise<number>{
    try{
      const row=await this.db.prepare(`INSERT INTO sync_all_runs(user_id,run_id,expires_at_ms,eligible_steps_json)
        VALUES (?,?,${clock}+600000,?) RETURNING expires_at_ms`)
        .bind(this.scope.userId,runId,JSON.stringify(steps)).first<{expires_at_ms:number}>();
      if(!row||!Number.isSafeInteger(row.expires_at_ms))throw new AbuseStorageUnavailableError();
      return row.expires_at_ms;
    }catch{throw new AbuseStorageUnavailableError();}
  }

  async claim(runId:string,step:SyncAllStep):Promise<void>{
    let changes:unknown;
    try{
      const result=await this.db.prepare(`INSERT INTO sync_all_steps(user_id,run_id,step_key,claimed_at_ms)
        SELECT user_id,run_id,?,${clock} FROM sync_all_runs
        WHERE user_id=? AND run_id=? AND expires_at_ms>${clock}
          AND EXISTS(SELECT 1 FROM json_each(eligible_steps_json) WHERE value=?)
        ON CONFLICT(user_id,run_id,step_key) DO NOTHING`)
        .bind(step,this.scope.userId,runId,step).run();
      if(!result.success)throw new AbuseStorageUnavailableError();
      changes=result.meta?.changes;
    }catch{throw new AbuseStorageUnavailableError();}
    if(changes!==1)throw new AbuseSubjectError();
  }
}
