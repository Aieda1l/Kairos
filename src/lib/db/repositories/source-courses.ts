import "server-only";
import crypto from "node:crypto";
import type Database from "better-sqlite3";
import type { DiscoveredSourceCourse, SourceCourse } from "@/lib/sources/types";

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

export class SourceCourseRepository{
  constructor(private db:Database.Database){}

  upsertDiscovered(sourceConnectionId:string,courses:DiscoveredSourceCourse[],seenAt:string):void{
    const existing=this.db.prepare("SELECT id FROM source_courses WHERE source_connection_id=? AND external_course_id=?");
    const insert=this.db.prepare(`
      INSERT INTO source_courses(
        id,source_connection_id,external_course_id,short_name,full_name,term,year,enabled,first_seen_at,last_seen_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `);
    const update=this.db.prepare(`
      UPDATE source_courses
      SET short_name=?,full_name=?,term=?,year=?,last_seen_at=?,updated_at=?
      WHERE source_connection_id=? AND external_course_id=?
    `);
    this.db.transaction(()=>{
      for(const course of courses){
        const row=existing.get(sourceConnectionId,course.externalCourseId) as {id:string}|undefined;
        if(row){
          update.run(course.shortName,course.fullName,course.term,course.year,seenAt,seenAt,sourceConnectionId,course.externalCourseId);
        }else{
          insert.run(crypto.randomUUID(),sourceConnectionId,course.externalCourseId,course.shortName,course.fullName,course.term,course.year,0,seenAt,seenAt,seenAt);
        }
      }
    })();
  }

  list(sourceConnectionId:string):SourceCourse[]{
    return (this.db.prepare(`
      SELECT id,source_connection_id,external_course_id,short_name,full_name,term,year,enabled,first_seen_at,last_seen_at
      FROM source_courses
      WHERE source_connection_id=?
      ORDER BY full_name COLLATE NOCASE, external_course_id
    `).all(sourceConnectionId) as Row[]).map(map);
  }

  listEnabled(sourceConnectionId:string):SourceCourse[]{
    return (this.db.prepare(`
      SELECT id,source_connection_id,external_course_id,short_name,full_name,term,year,enabled,first_seen_at,last_seen_at
      FROM source_courses
      WHERE source_connection_id=? AND enabled=1
      ORDER BY full_name COLLATE NOCASE, external_course_id
    `).all(sourceConnectionId) as Row[]).map(map);
  }

  setEnabled(sourceConnectionId:string,externalCourseIds:string[]):void{
    this.db.transaction(()=>{
      this.db.prepare("UPDATE source_courses SET enabled=0 WHERE source_connection_id=?").run(sourceConnectionId);
      const enable=this.db.prepare("UPDATE source_courses SET enabled=1 WHERE source_connection_id=? AND external_course_id=?");
      for(const externalCourseId of externalCourseIds) enable.run(sourceConnectionId,externalCourseId);
    })();
  }
}
