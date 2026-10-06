import { describe, expect, it } from "vitest";
import { openDatabase } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";

describe("calendar destination schema",()=>{
  it("creates destination tables with provider/status constraints and independent provider rows",()=>{
    const db=openDatabase(":memory:");
    migrate(db);

    const tables=(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{name:string}>)
      .map(row=>row.name);
    expect(tables).toEqual(expect.arrayContaining([
      "calendar_connections",
      "calendar_credentials",
      "calendar_event_links",
    ]));

    const connectionSql=(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='calendar_connections'").get() as {sql:string}).sql;
    expect(connectionSql).toContain("CHECK(provider IN ('google','microsoft','caldav'))");
    expect(connectionSql).toContain("CHECK(last_sync_status IN ('never','success','partial','error'))");

    const now="2026-10-06T00:00:00.000Z";
    expect(()=>db.prepare(
      "INSERT INTO calendar_connections(id,provider,label,enabled,last_sync_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    ).run("g1","google","Google 1",1,"never",now,now)).not.toThrow();
    expect(()=>db.prepare(
      "INSERT INTO calendar_connections(id,provider,label,enabled,last_sync_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    ).run("g2","google","Google 2",1,"never",now,now)).not.toThrow();

    const indexes=db.prepare("PRAGMA index_list(calendar_event_links)").all() as Array<{name:string;unique:number}>;
    const uniqueColumnSets=indexes
      .filter(index=>index.unique===1)
      .map(index=>(db.prepare(`PRAGMA index_info('${index.name}')`).all() as Array<{name:string}>).map(row=>row.name).join(","));
    expect(uniqueColumnSets).toContain("calendar_connection_id,assignment_id");
    expect(uniqueColumnSets).toContain("calendar_connection_id,sync_key");

    db.close();
  });
});
