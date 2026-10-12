import {prepareOwned} from "@/lib/db/d1/owned-mutation";
import "server-only";
import type {UserScope} from "@/lib/auth/user-scope";
import type {D1DatabaseLike,D1PreparedStatementLike,D1ResultLike} from "@/lib/db/d1/types";
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

  prepareDiscovered(
    sourceConnectionId:string,
    courses:DiscoveredSourceCourse[],
    seenAt:string,
  ):D1PreparedStatementLike{
    const rows=courses.map(course=>({...course,id:crypto.randomUUID()}));
    return prepareOwned(this.db,this.scope,`
      INSERT INTO source_courses(
        user_id,id,source_connection_id,external_course_id,short_name,full_name,
        term,year,enabled,first_seen_at,last_seen_at,updated_at
      )
      SELECT ?,json_extract(value,'$.id'),?,json_extract(value,'$.externalCourseId'),
        json_extract(value,'$.shortName'),json_extract(value,'$.fullName'),
        json_extract(value,'$.term'),json_extract(value,'$.year'),0,?,?,?
      FROM json_each(?) WHERE 1
      ON CONFLICT(user_id,source_connection_id,external_course_id) DO UPDATE SET
        short_name=excluded.short_name,full_name=excluded.full_name,term=excluded.term,
        year=excluded.year,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at
    `,{kind:"source",id:sourceConnectionId}).bind(this.scope.userId,sourceConnectionId,seenAt,seenAt,seenAt,JSON.stringify(rows));
  }

  async upsertDiscovered(sourceConnectionId:string,courses:DiscoveredSourceCourse[],seenAt:string):Promise<void>{
    await this.prepareDiscovered(sourceConnectionId,courses,seenAt).run();
  }

  prepareList(sourceConnectionId:string,enabledOnly=false):D1PreparedStatementLike{
    return prepareOwned(this.db,this.scope,`
      SELECT id,source_connection_id,external_course_id,short_name,full_name,term,year,enabled,first_seen_at,last_seen_at
      FROM source_courses
      WHERE user_id=? AND source_connection_id=? ${enabledOnly?"AND enabled=1":""}
      ORDER BY full_name COLLATE NOCASE, external_course_id
    `).bind(this.scope.userId,sourceConnectionId);
  }

  coursesFromResult(result:D1ResultLike):SourceCourse[]{
    return (result.results as Row[]).map(map);
  }

  private async listWhere(sourceConnectionId:string,enabledOnly:boolean):Promise<SourceCourse[]>{
    return this.coursesFromResult(await this.prepareList(sourceConnectionId,enabledOnly).all());
  }

  list(sourceConnectionId:string){return this.listWhere(sourceConnectionId,false);}
  listEnabled(sourceConnectionId:string){return this.listWhere(sourceConnectionId,true);}

  prepareEnabled(sourceConnectionId:string,externalCourseIds:string[]):D1PreparedStatementLike{
    return prepareOwned(this.db,this.scope,`
      UPDATE source_courses SET
        enabled=CASE WHEN external_course_id IN (SELECT value FROM json_each(?)) THEN 1 ELSE 0 END,
        updated_at=?
      WHERE user_id=? AND source_connection_id=?
    `,{kind:"source",id:sourceConnectionId}).bind(JSON.stringify(externalCourseIds),new Date().toISOString(),this.scope.userId,sourceConnectionId);
  }

  async setEnabled(sourceConnectionId:string,externalCourseIds:string[]):Promise<void>{
    await this.prepareEnabled(sourceConnectionId,externalCourseIds).run();
  }
}
