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
  ed_api_token TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_courses (
  id TEXT PRIMARY KEY,
  source_connection_id TEXT NOT NULL REFERENCES source_connections(id) ON DELETE CASCADE,
  external_course_id TEXT NOT NULL,
  short_name TEXT,
  full_name TEXT NOT NULL,
  term TEXT,
  year TEXT,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_connection_id, external_course_id)
);
CREATE INDEX IF NOT EXISTS source_courses_connection_enabled_idx
  ON source_courses(source_connection_id, enabled);

CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  source_connection_id TEXT NOT NULL REFERENCES source_connections(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('canvas','gradescope','ed')),
  external_id TEXT NOT NULL,
  course_id TEXT,
  course_name TEXT NOT NULL,
  title TEXT NOT NULL,
  release_at TEXT,
  due_at TEXT,
  late_due_at TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending','submitted','graded','overdue','unknown')),
  source_status_text TEXT,
  grade_score TEXT,
  grade_max TEXT,
  grade_display TEXT,
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

CREATE TABLE IF NOT EXISTS assignment_submission_status (
  assignment_id TEXT PRIMARY KEY REFERENCES assignments(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK(state IN ('unknown','not_submitted','submitted','graded','excused')),
  is_late INTEGER NOT NULL CHECK(is_late IN (0,1)),
  is_missing INTEGER NOT NULL CHECK(is_missing IN (0,1)),
  submitted_at TEXT,
  checked_at TEXT NOT NULL,
  extractor_version TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS submission_status_sync (
  source_connection_id TEXT PRIMARY KEY REFERENCES source_connections(id) ON DELETE CASCADE,
  last_attempted_at TEXT,
  last_successful_at TEXT,
  last_error_code TEXT,
  updated_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assignment_links (
  id TEXT PRIMARY KEY,
  assignment_a_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  assignment_b_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL CHECK(relationship IN ('possible_duplicate','same_work','date_conflict')),
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  created_at TEXT NOT NULL,
  UNIQUE(assignment_a_id, assignment_b_id, relationship)
);

CREATE TABLE IF NOT EXISTS calendar_connections (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK(provider IN ('google','microsoft','caldav')),
  label TEXT NOT NULL,
  account_label TEXT,
  remote_calendar_id TEXT,
  remote_calendar_name TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  last_sync_started_at TEXT,
  last_sync_completed_at TEXT,
  last_sync_status TEXT NOT NULL DEFAULT 'never' CHECK(last_sync_status IN ('never','success','partial','error')),
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS calendar_connections_provider_enabled_idx
  ON calendar_connections(provider, enabled);

CREATE TABLE IF NOT EXISTS calendar_credentials (
  calendar_connection_id TEXT PRIMARY KEY REFERENCES calendar_connections(id) ON DELETE CASCADE,
  oauth_refresh_token TEXT,
  caldav_username TEXT,
  caldav_secret TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calendar_event_links (
  id TEXT PRIMARY KEY,
  calendar_connection_id TEXT NOT NULL REFERENCES calendar_connections(id) ON DELETE CASCADE,
  assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  sync_key TEXT NOT NULL,
  remote_event_id TEXT,
  remote_etag TEXT,
  content_hash TEXT,
  last_synced_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(calendar_connection_id, assignment_id),
  UNIQUE(calendar_connection_id, sync_key)
);
CREATE INDEX IF NOT EXISTS calendar_event_links_connection_idx
  ON calendar_event_links(calendar_connection_id);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

const ASSIGNMENT_COLUMNS: Array<[string,string]> = [
  ["release_at","TEXT"],
  ["late_due_at","TEXT"],
  ["source_status_text","TEXT"],
  ["grade_score","TEXT"],
  ["grade_max","TEXT"],
  ["grade_display","TEXT"],
];

function ensureSourceCredentialColumns(db: Database.Database): void {
  const existing=new Set(
    (db.prepare("PRAGMA table_info(source_credentials)").all() as Array<{name:string}>)
      .map(column=>column.name),
  );
  if(!existing.has("ed_api_token")) db.exec("ALTER TABLE source_credentials ADD COLUMN ed_api_token TEXT");
}

function ensureAssignmentMetadataColumns(db: Database.Database): void {
  const existing=new Set(
    (db.prepare("PRAGMA table_info(assignments)").all() as Array<{name:string}>)
      .map(column=>column.name),
  );
  for(const [name,type] of ASSIGNMENT_COLUMNS){
    if(!existing.has(name)) db.exec(`ALTER TABLE assignments ADD COLUMN ${name} ${type}`);
  }
}

export function migrate(db: Database.Database): void {
  const now = new Date().toISOString();
  db.exec(SCHEMA);
  ensureSourceCredentialColumns(db);
  ensureAssignmentMetadataColumns(db);
  db.prepare(`
    INSERT INTO app_settings(key, value, updated_at)
    VALUES ('timezone', 'America/Los_Angeles', ?)
    ON CONFLICT(key) DO NOTHING
  `).run(now);
  db.prepare(`
    INSERT INTO app_settings(key, value, updated_at)
    VALUES ('calendar_hide_submitted', '1', ?)
    ON CONFLICT(key) DO NOTHING
  `).run(now);
}
