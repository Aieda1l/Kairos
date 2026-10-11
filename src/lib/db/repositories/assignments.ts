import "server-only";
import crypto from "node:crypto";
import type {LegacyDatabase} from "@/lib/db/legacy-types";
import type { Assignment } from "@/lib/assignments/types";
import type { NormalizedAssignment } from "@/lib/assignments/normalize";
import type { SourceKind } from "@/lib/sources/types";
import type { SubmissionState } from "@/lib/submission-status/types";

export type AssignmentFilters={course?:string;source?:SourceKind;search?:string};

type Row={
  id:string;
  source_kind:SourceKind;
  external_id:string;
  course_id:string|null;
  course_name:string;
  title:string;
  release_at:string|null;
  due_at:string|null;
  late_due_at:string|null;
  status:Assignment["status"];
  source_status_text:string|null;
  grade_score:string|null;
  grade_max:string|null;
  grade_display:string|null;
  source_url:string|null;
  source_updated_at:string|null;
  first_seen_at:string;
  last_seen_at:string;
  submission_state:SubmissionState|null;
  submission_is_late:number|null;
  submission_is_missing:number|null;
  submission_submitted_at:string|null;
  submission_checked_at:string|null;
  submission_extractor_version:string|null;
};

const map=(r:Row):Assignment=>({
  id:r.id,
  source:r.source_kind,
  externalId:r.external_id,
  courseId:r.course_id,
  courseName:r.course_name,
  title:r.title,
  releaseAt:r.release_at,
  dueAt:r.due_at,
  lateDueAt:r.late_due_at,
  status:r.status,
  sourceStatusText:r.source_status_text,
  gradeScore:r.grade_score,
  gradeMax:r.grade_max,
  gradeDisplay:r.grade_display,
  sourceUrl:r.source_url,
  sourceUpdatedAt:r.source_updated_at,
  firstSeenAt:r.first_seen_at,
  lastSeenAt:r.last_seen_at,
  submissionStatus:r.submission_checked_at&&r.submission_state&&r.submission_extractor_version?{
    state:r.submission_state,
    isLate:Boolean(r.submission_is_late),
    isMissing:Boolean(r.submission_is_missing),
    submittedAt:r.submission_submitted_at,
    checkedAt:r.submission_checked_at,
    extractorVersion:r.submission_extractor_version,
  }:null,
});

export class AssignmentRepository{
  constructor(private db:LegacyDatabase){}

  upsertMany(sourceConnectionId:string,assignments:NormalizedAssignment[],seenAt:string):{inserted:number;updated:number}{
    let inserted=0,updated=0;
    const existing=this.db.prepare("SELECT id FROM assignments WHERE source_connection_id=? AND external_id=?");
    const insert=this.db.prepare(`
      INSERT INTO assignments(
        id,source_connection_id,source_kind,external_id,course_id,course_name,title,
        release_at,due_at,late_due_at,status,source_status_text,grade_score,grade_max,grade_display,
        source_url,source_updated_at,first_seen_at,last_seen_at,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    const update=this.db.prepare(`
      UPDATE assignments SET
        source_kind=?,course_id=?,course_name=?,title=?,release_at=?,due_at=?,late_due_at=?,status=?,
        source_status_text=?,grade_score=?,grade_max=?,grade_display=?,source_url=?,source_updated_at=?,
        last_seen_at=?,updated_at=?
      WHERE source_connection_id=? AND external_id=?
    `);
    const tx=this.db.transaction(()=>{
      for(const a of assignments){
        const row=existing.get(sourceConnectionId,a.externalId) as {id:string}|undefined;
        if(row){
          update.run(
            a.source,a.courseId,a.courseName,a.title,a.releaseAt,a.dueAt,a.lateDueAt,a.status,
            a.sourceStatusText,a.gradeScore,a.gradeMax,a.gradeDisplay,a.sourceUrl,a.sourceUpdatedAt,
            seenAt,seenAt,sourceConnectionId,a.externalId,
          );
          updated++;
        }else{
          insert.run(
            crypto.randomUUID(),sourceConnectionId,a.source,a.externalId,a.courseId,a.courseName,a.title,
            a.releaseAt,a.dueAt,a.lateDueAt,a.status,a.sourceStatusText,a.gradeScore,a.gradeMax,a.gradeDisplay,
            a.sourceUrl,a.sourceUpdatedAt,seenAt,seenAt,seenAt,seenAt,
          );
          inserted++;
        }
      }
    });
    tx();
    return {inserted,updated};
  }

  list(filters:AssignmentFilters={}):Assignment[]{
    const where:string[]=[];
    const params:unknown[]=[];
    if(filters.course){where.push("a.course_name = ?");params.push(filters.course);}
    if(filters.source){where.push("a.source_kind = ?");params.push(filters.source);}
    if(filters.search){
      where.push("(lower(a.title) LIKE ? OR lower(a.course_name) LIKE ?)");
      const q=`%${filters.search.toLowerCase()}%`;
      params.push(q,q);
    }
    const sql=`
      SELECT
        a.id,a.source_kind,a.external_id,a.course_id,a.course_name,a.title,
        a.release_at,a.due_at,a.late_due_at,a.status,a.source_status_text,
        a.grade_score,a.grade_max,a.grade_display,
        a.source_url,a.source_updated_at,a.first_seen_at,a.last_seen_at,
        s.state AS submission_state,
        s.is_late AS submission_is_late,
        s.is_missing AS submission_is_missing,
        s.submitted_at AS submission_submitted_at,
        s.checked_at AS submission_checked_at,
        s.extractor_version AS submission_extractor_version
      FROM assignments a
      LEFT JOIN assignment_submission_status s ON s.assignment_id=a.id
      ${where.length?`WHERE ${where.join(" AND ")}`:""}
      ORDER BY CASE WHEN a.due_at IS NULL THEN 1 ELSE 0 END, a.due_at ASC, a.title COLLATE NOCASE ASC
    `;
    return (this.db.prepare(sql).all(...params) as Row[]).map(map);
  }
}
