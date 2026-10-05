import "server-only";
import type Database from "better-sqlite3";
import type { SubmissionStatusSyncState, SubmissionStatusWrite, SubmissionSyncErrorCode } from "@/lib/submission-status/types";

type SyncRow={
  last_attempted_at:string|null;
  last_successful_at:string|null;
  last_error_code:SubmissionSyncErrorCode|null;
  updated_count:number;
  failed_count:number;
};

export class SubmissionStatusRepository {
  constructor(private db:Database.Database){}

  getSyncState(sourceConnectionId:string):SubmissionStatusSyncState {
    const row=this.db.prepare(`
      SELECT last_attempted_at,last_successful_at,last_error_code,updated_count,failed_count
      FROM submission_status_sync WHERE source_connection_id=?
    `).get(sourceConnectionId) as SyncRow|undefined;
    return {
      lastAttemptedAt:row?.last_attempted_at??null,
      lastSuccessfulAt:row?.last_successful_at??null,
      lastErrorCode:row?.last_error_code??null,
      updatedCount:row?.updated_count??0,
      failedCount:row?.failed_count??0,
    };
  }

  markAttempt(sourceConnectionId:string,attemptedAt:string):void {
    this.db.prepare(`
      INSERT INTO submission_status_sync(source_connection_id,last_attempted_at,updated_at)
      VALUES (?,?,?)
      ON CONFLICT(source_connection_id) DO UPDATE SET
        last_attempted_at=excluded.last_attempted_at,
        updated_at=excluded.updated_at
    `).run(sourceConnectionId,attemptedAt,attemptedAt);
  }

  applyCompletion<T extends SubmissionStatusWrite>(
    sourceConnectionId:string,
    results:T[],
    failedCount:number,
    errorCode:SubmissionSyncErrorCode|null,
    completedAt:string,
    successfulChecksOverride?:number,
  ):{updated:number;ignoredStale:number}{
    let updated=0;
    let ignoredStale=0;
    let successfulChecks=successfulChecksOverride??0;
    const belongs=this.db.prepare("SELECT id FROM assignments WHERE id=? AND source_connection_id=?");
    const existing=this.db.prepare("SELECT checked_at FROM assignment_submission_status WHERE assignment_id=?");
    const upsert=this.db.prepare(`
      INSERT INTO assignment_submission_status(
        assignment_id,state,is_late,is_missing,submitted_at,checked_at,extractor_version,updated_at
      ) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(assignment_id) DO UPDATE SET
        state=excluded.state,
        is_late=excluded.is_late,
        is_missing=excluded.is_missing,
        submitted_at=excluded.submitted_at,
        checked_at=excluded.checked_at,
        extractor_version=excluded.extractor_version,
        updated_at=excluded.updated_at
    `);

    const tx=this.db.transaction(()=>{
      for(const result of results){
        if(result.errorCode) continue;
        if(!belongs.get(result.assignmentLocalId,sourceConnectionId)) continue;
        if(successfulChecksOverride===undefined) successfulChecks++;
        const current=existing.get(result.assignmentLocalId) as {checked_at:string}|undefined;
        if(current && current.checked_at>=result.checkedAt){
          ignoredStale++;
          continue;
        }
        upsert.run(
          result.assignmentLocalId,
          result.state,
          result.isLate?1:0,
          result.isMissing?1:0,
          result.submittedAt,
          result.checkedAt,
          result.extractorVersion,
          completedAt,
        );
        updated++;
      }

      if(successfulChecks>0){
        this.db.prepare(`
          INSERT INTO submission_status_sync(
            source_connection_id,last_successful_at,last_error_code,updated_count,failed_count,updated_at
          ) VALUES (?,?,?,?,?,?)
          ON CONFLICT(source_connection_id) DO UPDATE SET
            last_successful_at=excluded.last_successful_at,
            last_error_code=excluded.last_error_code,
            updated_count=excluded.updated_count,
            failed_count=excluded.failed_count,
            updated_at=excluded.updated_at
        `).run(sourceConnectionId,completedAt,errorCode,updated,failedCount,completedAt);
      }else{
        this.db.prepare(`
          INSERT INTO submission_status_sync(
            source_connection_id,last_error_code,updated_count,failed_count,updated_at
          ) VALUES (?,?,?,?,?)
          ON CONFLICT(source_connection_id) DO UPDATE SET
            last_error_code=excluded.last_error_code,
            updated_count=excluded.updated_count,
            failed_count=excluded.failed_count,
            updated_at=excluded.updated_at
        `).run(sourceConnectionId,errorCode,0,failedCount,completedAt);
      }
    });
    tx();
    return {updated,ignoredStale};
  }
}
