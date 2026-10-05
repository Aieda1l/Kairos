import { describe, expect, it } from "vitest";
import { openDatabase } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";

describe("database schema", () => {
  it("creates the Kairos schema, submission-status tables, and default timezone", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((row) => row.name);
    expect(tables).toEqual(expect.arrayContaining([
      "source_connections",
      "source_credentials",
      "assignments",
      "assignment_links",
      "app_settings",
      "assignment_submission_status",
      "submission_status_sync",
    ]));
    const credentialColumns = db.prepare("PRAGMA table_info(source_credentials)").all() as Array<{ name: string }>;
    expect(credentialColumns.map((column) => column.name)).toContain("ed_api_token");
    const indexes = db.prepare("PRAGMA index_list(assignments)").all() as Array<{ name: string; unique: number }>;
    expect(indexes.some((index) => index.unique === 1 && index.name.includes("source_external"))).toBe(true);
    const timezone = db.prepare("SELECT value FROM app_settings WHERE key='timezone'").get() as { value: string };
    expect(timezone.value).toBe("America/Los_Angeles");
    db.close();
  });
});


it("adds the Ed token column to an existing credential table", () => {
  const db = openDatabase(":memory:");
  db.exec(`
    CREATE TABLE source_connections (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK(kind IN ('canvas','gradescope','ed')),
      label TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
      last_sync_started_at TEXT,
      last_sync_completed_at TEXT,
      last_sync_status TEXT NOT NULL DEFAULT 'never' CHECK(last_sync_status IN ('never','success','error')),
      last_error_code TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(kind)
    );
    CREATE TABLE source_credentials (
      source_connection_id TEXT PRIMARY KEY REFERENCES source_connections(id) ON DELETE CASCADE,
      canvas_feed_url TEXT,
      updated_at TEXT NOT NULL
    );
  `);
  migrate(db);
  const columns = db.prepare("PRAGMA table_info(source_credentials)").all() as Array<{ name: string }>;
  expect(columns.map((column) => column.name)).toContain("ed_api_token");
  db.close();
});
