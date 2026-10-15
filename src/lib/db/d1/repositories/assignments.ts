import "server-only";
import type {Assignment} from "@/lib/assignments/types";
import type {NormalizedAssignment} from "@/lib/assignments/normalize";
import type {UserScope} from "@/lib/auth/user-scope";
import type {D1DatabaseLike} from "@/lib/db/d1/types";
import type {SourceKind} from "@/lib/sources/types";
import type {SubmissionState} from "@/lib/submission-status/types";

export type D1AssignmentFilters={course?:string;source?:SourceKind;search?:string};

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

const map=(row:Row):Assignment=>({
  id:row.id,
  source:row.source_kind,
  externalId:row.external_id,
  courseId:row.course_id,
  courseName:row.course_name,
  title:row.title,
  releaseAt:row.release_at,
  dueAt:row.due_at,
  lateDueAt:row.late_due_at,
  status:row.status,
  sourceStatusText:row.source_status_text,
  gradeScore:row.grade_score,
  gradeMax:row.grade_max,
  gradeDisplay:row.grade_display,
  sourceUrl:row.source_url,
  sourceUpdatedAt:row.source_updated_at,
  firstSeenAt:row.first_seen_at,
  lastSeenAt:row.last_seen_at,
  submissionStatus:row.submission_checked_at&&row.submission_state&&row.submission_extractor_version?{
    state:row.submission_state,
    isLate:Boolean(row.submission_is_late),
    isMissing:Boolean(row.submission_is_missing),
    submittedAt:row.submission_submitted_at,
    checkedAt:row.submission_checked_at,
    extractorVersion:row.submission_extractor_version,
  }:null,
});

export class D1AssignmentRepository{
  constructor(
    private readonly db:D1DatabaseLike,
    private readonly scope:UserScope,
  ){}

  async upsertMany(
    sourceConnectionId:string,
    assignments:NormalizedAssignment[],
    seenAt:string,
  ):Promise<{inserted:number;updated:number}>{
    let inserted=0;
    let updated=0;

    for(const assignment of assignments){
      const existing=await this.db.prepare(`
        SELECT id FROM assignments
        WHERE user_id=? AND source_connection_id=? AND external_id=?
      `).bind(this.scope.userId,sourceConnectionId,assignment.externalId)
        .first<{id:string}>();

      if(existing){
        await this.db.prepare(`
          UPDATE assignments SET
            source_kind=?,course_id=?,course_name=?,title=?,release_at=?,due_at=?,late_due_at=?,
            status=?,source_status_text=?,grade_score=?,grade_max=?,grade_display=?,source_url=?,
            source_updated_at=?,last_seen_at=?,updated_at=?
          WHERE user_id=? AND source_connection_id=? AND external_id=?
        `).bind(
          assignment.source,assignment.courseId,assignment.courseName,assignment.title,
          assignment.releaseAt,assignment.dueAt,assignment.lateDueAt,assignment.status,
          assignment.sourceStatusText,assignment.gradeScore,assignment.gradeMax,assignment.gradeDisplay,
          assignment.sourceUrl,assignment.sourceUpdatedAt,seenAt,seenAt,
          this.scope.userId,sourceConnectionId,assignment.externalId,
        ).run();
        updated++;
      }else{
        await this.db.prepare(`
          INSERT INTO assignments(
            user_id,id,source_connection_id,source_kind,external_id,course_id,course_name,title,
            release_at,due_at,late_due_at,status,source_status_text,grade_score,grade_max,grade_display,
            source_url,source_updated_at,first_seen_at,last_seen_at,created_at,updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).bind(
          this.scope.userId,crypto.randomUUID(),sourceConnectionId,assignment.source,assignment.externalId,
          assignment.courseId,assignment.courseName,assignment.title,assignment.releaseAt,assignment.dueAt,
          assignment.lateDueAt,assignment.status,assignment.sourceStatusText,assignment.gradeScore,
          assignment.gradeMax,assignment.gradeDisplay,assignment.sourceUrl,assignment.sourceUpdatedAt,
          seenAt,seenAt,seenAt,seenAt,
        ).run();
        inserted++;
      }
    }

    return {inserted,updated};
  }

  async list(filters:D1AssignmentFilters={}):Promise<Assignment[]>{
    const where=["a.user_id = ?"];
    const params:unknown[]=[this.scope.userId];

    if(filters.course){
      where.push("a.course_name = ?");
      params.push(filters.course);
    }
    if(filters.source){
      where.push("a.source_kind = ?");
      params.push(filters.source);
    }
    if(filters.search){
      where.push("(lower(a.title) LIKE ? OR lower(a.course_name) LIKE ?)");
      const q=`%${filters.search.toLowerCase()}%`;
      params.push(q,q);
    }

    const result=await this.db.prepare(`
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
      LEFT JOIN assignment_submission_status s
        ON s.user_id=a.user_id AND s.assignment_id=a.id
      WHERE ${where.join(" AND ")}
      ORDER BY CASE WHEN a.due_at IS NULL THEN 1 ELSE 0 END,
        a.due_at ASC,a.title COLLATE NOCASE ASC
    `).bind(...params).all<Row>();

    return result.results.map(map);
  }
}
