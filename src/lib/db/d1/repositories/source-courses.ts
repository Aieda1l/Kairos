import "server-only";
import type {UserScope} from "@/lib/auth/user-scope";
import type {D1DatabaseLike} from "@/lib/db/d1/types";
import type {DiscoveredSourceCourse,SourceCourse} from "@/lib/sources/types";

type Row={
  id:string;
  source_connection_id:string;
  external_course_id:string;
  short_name:string|null;
  full_name:string;
  term:string|null;
  year:string|null;
  enabled:number;
  first_seen_at:string;
  last_seen_at:string;
};

const map=(row:Row):SourceCourse=>({
  id:row.id,
  sourceConnectionId:row.source_connection_id,
  externalCourseId:row.external_course_id,
  shortName:row.short_name,
  fullName:row.full_name,
  term:row.term,
  year:row.year,
  enabled:Boolean(row.enabled),
  firstSeenAt:row.first_seen_at,
  lastSeenAt:row.last_seen_at,
});

export class D1SourceCourseRepository{
  constructor(
    private readonly db:D1DatabaseLike,
    private readonly scope:UserScope,
  ){}

  async upsertDiscovered(
    sourceConnectionId:string,
    courses:DiscoveredSourceCourse[],
    seenAt:string,
  ):Promise<void>{
    for(const course of courses){
      const existing=await this.db.prepare(`
        SELECT id FROM source_courses
        WHERE user_id=? AND source_connection_id=? AND external_course_id=?
      `).bind(this.scope.userId,sourceConnectionId,course.externalCourseId)
        .first<{id:string}>();

      if(existing){
        await this.db.prepare(`
          UPDATE source_courses
          SET short_name=?,full_name=?,term=?,year=?,last_seen_at=?,updated_at=?
          WHERE user_id=? AND source_connection_id=? AND external_course_id=?
        `).bind(
          course.shortName,course.fullName,course.term,course.year,seenAt,seenAt,
          this.scope.userId,sourceConnectionId,course.externalCourseId,
        ).run();
      }else{
        await this.db.prepare(`
          INSERT INTO source_courses(
            user_id,id,source_connection_id,external_course_id,short_name,full_name,
            term,year,enabled,first_seen_at,last_seen_at,updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        `).bind(
          this.scope.userId,crypto.randomUUID(),sourceConnectionId,course.externalCourseId,
          course.shortName,course.fullName,course.term,course.year,0,seenAt,seenAt,seenAt,
        ).run();
      }
    }
  }

  private async listWhere(sourceConnectionId:string,enabledOnly:boolean):Promise<SourceCourse[]>{
    const result=await this.db.prepare(`
      SELECT id,source_connection_id,external_course_id,short_name,full_name,term,year,enabled,first_seen_at,last_seen_at
      FROM source_courses
      WHERE user_id=? AND source_connection_id=? ${enabledOnly?"AND enabled=1":""}
      ORDER BY full_name COLLATE NOCASE, external_course_id
    `).bind(this.scope.userId,sourceConnectionId).all<Row>();
    return result.results.map(map);
  }

  list(sourceConnectionId:string){return this.listWhere(sourceConnectionId,false);}
  listEnabled(sourceConnectionId:string){return this.listWhere(sourceConnectionId,true);}

  async setEnabled(sourceConnectionId:string,externalCourseIds:string[]):Promise<void>{
    await this.db.prepare(`
      UPDATE source_courses SET enabled=0,updated_at=?
      WHERE user_id=? AND source_connection_id=?
    `).bind(new Date().toISOString(),this.scope.userId,sourceConnectionId).run();

    for(const externalCourseId of externalCourseIds){
      await this.db.prepare(`
        UPDATE source_courses SET enabled=1,updated_at=?
        WHERE user_id=? AND source_connection_id=? AND external_course_id=?
      `).bind(new Date().toISOString(),this.scope.userId,sourceConnectionId,externalCourseId).run();
    }
  }
}
