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
    const indexes = db.prepare("PRAGMA index_list(assignments)").all() as Array<{ name: string; unique: number }>;
    expect(indexes.some((index) => index.unique === 1 && index.name.includes("source_external"))).toBe(true);
    const timezone = db.prepare("SELECT value FROM app_settings WHERE key='timezone'").get() as { value: string };
    expect(timezone.value).toBe("America/Los_Angeles");
    db.close();
  });
});
