import "server-only";
import type Database from "better-sqlite3";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS source_connections (
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

CREATE TABLE IF NOT EXISTS source_credentials (
  source_connection_id TEXT PRIMARY KEY REFERENCES source_connections(id) ON DELETE CASCADE,
  canvas_feed_url TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  source_connection_id TEXT NOT NULL REFERENCES source_connections(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('canvas','gradescope','ed')),
  external_id TEXT NOT NULL,
  course_id TEXT,
  course_name TEXT NOT NULL,
  title TEXT NOT NULL,
  due_at TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending','submitted','graded','overdue','unknown')),
  source_url TEXT,
  source_updated_at TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS assignments_source_external_unique
  ON assignments(source_connection_id, external_id);
CREATE INDEX IF NOT EXISTS assignments_due_at_idx ON assignments(due_at);
CREATE INDEX IF NOT EXISTS assignments_course_name_idx ON assignments(course_name);

CREATE TABLE IF NOT EXISTS assignment_links (
  id TEXT PRIMARY KEY,
  assignment_a_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  assignment_b_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL CHECK(relationship IN ('possible_duplicate','same_work','date_conflict')),
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  created_at TEXT NOT NULL,
  UNIQUE(assignment_a_id, assignment_b_id, relationship)
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

export function migrate(db: Database.Database): void {
  const now = new Date().toISOString();
  db.exec(SCHEMA);
  db.prepare(`
    INSERT INTO app_settings(key, value, updated_at)
    VALUES ('timezone', 'America/Los_Angeles', ?)
    ON CONFLICT(key) DO NOTHING
  `).run(now);
}
