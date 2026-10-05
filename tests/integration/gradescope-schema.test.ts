import { describe, expect, it } from "vitest";
import { openDatabase } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import { SourceConnectionRepository } from "@/lib/db/repositories/source-connections";
import { SourceCourseRepository } from "@/lib/db/repositories/source-courses";

describe("Milestone 3 schema", () => {
  it("adds Gradescope metadata columns to an existing assignments table", () => {
    const db = openDatabase(":memory:");
    db.exec(`
      CREATE TABLE assignments (
        id TEXT PRIMARY KEY,
        source_connection_id TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        external_id TEXT NOT NULL,
        course_id TEXT,
        course_name TEXT NOT NULL,
        title TEXT NOT NULL,
        due_at TEXT,
        status TEXT NOT NULL,
        source_url TEXT,
        source_updated_at TEXT,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    migrate(db);

    const columns = (db.prepare("PRAGMA table_info(assignments)").all() as Array<{name:string}>)
      .map(column => column.name);
    expect(columns).toEqual(expect.arrayContaining([
      "release_at",
      "late_due_at",
      "source_status_text",
      "grade_score",
      "grade_max",
      "grade_display",
    ]));
    db.close();
  });

  it("keeps discovered course selection stable across rediscovery", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const connection = new SourceConnectionRepository(db).upsertGradescope("Gradescope");
    const courses = new SourceCourseRepository(db);

    courses.upsertDiscovered(connection.id, [{
      externalCourseId: "123",
      shortName: "CSE 331",
      fullName: "Software Design",
      term: "Autumn",
      year: "2026",
    }], "2026-10-04T00:00:00.000Z");

    expect(courses.list(connection.id)).toMatchObject([{externalCourseId:"123", enabled:false}]);

    courses.setEnabled(connection.id, ["123"]);
    courses.upsertDiscovered(connection.id, [{
      externalCourseId: "123",
      shortName: "CSE 331",
      fullName: "Software Design",
      term: "Autumn",
      year: "2026",
    }, {
      externalCourseId: "456",
      shortName: "MATH 308",
      fullName: "Linear Algebra",
      term: "Autumn",
      year: "2026",
    }], "2026-10-05T00:00:00.000Z");

    expect(courses.listEnabled(connection.id).map(course => course.externalCourseId)).toEqual(["123"]);
    expect(courses.list(connection.id).find(course => course.externalCourseId === "456")?.enabled).toBe(false);
    db.close();
  });
});
