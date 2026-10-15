import "server-only";
import type {UserScope} from "@/lib/auth/user-scope";
import type {D1DatabaseLike} from "@/lib/db/d1/types";
import type {
  SubmissionStatusSyncState,
  SubmissionStatusWrite,
  SubmissionSyncErrorCode,
} from "@/lib/submission-status/types";

type SyncRow={
  last_attempted_at:string|null;
  last_successful_at:string|null;
  last_error_code:string|null;
  updated_count:number;
  failed_count:number;
};

export class D1SubmissionStatusRepository{
  constructor(
    private readonly db:D1DatabaseLike,
    private readonly scope:UserScope,
  ){}

  private async ownsSource(sourceConnectionId:string):Promise<boolean>{
    return Boolean(await this.db.prepare(
      "SELECT id FROM source_connections WHERE user_id=? AND id=?",
    ).bind(this.scope.userId,sourceConnectionId).first<{id:string}>());
  }

  async getSyncState<TError extends string=SubmissionSyncErrorCode>(
    sourceConnectionId:string,
  ):Promise<SubmissionStatusSyncState<TError>>{
    const row=await this.db.prepare(`
      SELECT last_attempted_at,last_successful_at,last_error_code,updated_count,failed_count
      FROM submission_status_sync
      WHERE user_id=? AND source_connection_id=?
    `).bind(this.scope.userId,sourceConnectionId).first<SyncRow>();

    return {
      lastAttemptedAt:row?.last_attempted_at??null,
      lastSuccessfulAt:row?.last_successful_at??null,
      lastErrorCode:(row?.last_error_code as TError|null|undefined)??null,
      updatedCount:row?.updated_count??0,
      failedCount:row?.failed_count??0,
    };
  }

  async markAttempt(sourceConnectionId:string,attemptedAt:string):Promise<void>{
    if(!await this.ownsSource(sourceConnectionId))return;
    await this.db.prepare(`
      INSERT INTO submission_status_sync(
        user_id,source_connection_id,last_attempted_at,updated_at
      ) VALUES (?,?,?,?)
      ON CONFLICT(user_id,source_connection_id) DO UPDATE SET
        last_attempted_at=excluded.last_attempted_at,
        updated_at=excluded.updated_at
    `).bind(this.scope.userId,sourceConnectionId,attemptedAt,attemptedAt).run();
  }

  async applyCompletion<
    T extends SubmissionStatusWrite,
    TError extends string=SubmissionSyncErrorCode,
  >(
    sourceConnectionId:string,
    results:T[],
    failedCount:number,
    errorCode:TError|null,
    completedAt:string,
    successfulChecksOverride?:number,
  ):Promise<{updated:number;ignoredStale:number}>{
    if(!await this.ownsSource(sourceConnectionId)){
      return {updated:0,ignoredStale:0};
    }

    let updated=0;
    let ignoredStale=0;
    let successfulChecks=successfulChecksOverride??0;

    for(const result of results){
      if(result.errorCode)continue;

      const belongs=await this.db.prepare(`
        SELECT id FROM assignments
        WHERE user_id=? AND id=? AND source_connection_id=?
      `).bind(this.scope.userId,result.assignmentLocalId,sourceConnectionId)
        .first<{id:string}>();
      if(!belongs)continue;

      if(successfulChecksOverride===undefined)successfulChecks++;

      const existing=await this.db.prepare(`
        SELECT checked_at FROM assignment_submission_status
        WHERE user_id=? AND assignment_id=?
      `).bind(this.scope.userId,result.assignmentLocalId)
        .first<{checked_at:string}>();

      if(existing && existing.checked_at>=result.checkedAt){
        ignoredStale++;
        continue;
      }

      await this.db.prepare(`
        INSERT INTO assignment_submission_status(
          user_id,assignment_id,state,is_late,is_missing,submitted_at,checked_at,extractor_version,updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(user_id,assignment_id) DO UPDATE SET
          state=excluded.state,
          is_late=excluded.is_late,
          is_missing=excluded.is_missing,
          submitted_at=excluded.submitted_at,
          checked_at=excluded.checked_at,
          extractor_version=excluded.extractor_version,
          updated_at=excluded.updated_at
      `).bind(
        this.scope.userId,result.assignmentLocalId,result.state,result.isLate?1:0,
        result.isMissing?1:0,result.submittedAt,result.checkedAt,result.extractorVersion,completedAt,
      ).run();
      updated++;
    }

    if(successfulChecks>0){
      await this.db.prepare(`
        INSERT INTO submission_status_sync(
          user_id,source_connection_id,last_successful_at,last_error_code,updated_count,failed_count,updated_at
        ) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(user_id,source_connection_id) DO UPDATE SET
          last_successful_at=excluded.last_successful_at,
          last_error_code=excluded.last_error_code,
          updated_count=excluded.updated_count,
          failed_count=excluded.failed_count,
          updated_at=excluded.updated_at
      `).bind(
        this.scope.userId,sourceConnectionId,completedAt,errorCode,updated,failedCount,completedAt,
      ).run();
    }else{
      await this.db.prepare(`
        INSERT INTO submission_status_sync(
          user_id,source_connection_id,last_error_code,updated_count,failed_count,updated_at
        ) VALUES (?,?,?,?,?,?)
        ON CONFLICT(user_id,source_connection_id) DO UPDATE SET
          last_error_code=excluded.last_error_code,
          updated_count=excluded.updated_count,
          failed_count=excluded.failed_count,
          updated_at=excluded.updated_at
      `).bind(
        this.scope.userId,sourceConnectionId,errorCode,0,failedCount,completedAt,
      ).run();
    }

    return {updated,ignoredStale};
  }
}
