CREATE TABLE IF NOT EXISTS source_connections (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('canvas','gradescope','ed')),
  label TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  last_sync_started_at TEXT,
  last_sync_completed_at TEXT,
  last_sync_status TEXT NOT NULL DEFAULT 'never' CHECK(last_sync_status IN ('never','success','error')),
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, kind),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS source_credentials (
  user_id TEXT NOT NULL,
  source_connection_id TEXT NOT NULL,
  canvas_feed_url_envelope TEXT,
  ed_api_token_envelope TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, source_connection_id),
  FOREIGN KEY (user_id, source_connection_id)
    REFERENCES source_connections(user_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS source_courses (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  source_connection_id TEXT NOT NULL,
  external_course_id TEXT NOT NULL,
  short_name TEXT,
  full_name TEXT NOT NULL,
  term TEXT,
  year TEXT,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, source_connection_id, external_course_id),
  FOREIGN KEY (user_id, source_connection_id)
    REFERENCES source_connections(user_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS source_courses_user_connection_enabled_idx
  ON source_courses(user_id, source_connection_id, enabled);

CREATE TABLE IF NOT EXISTS assignments (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  source_connection_id TEXT NOT NULL,
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
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, source_connection_id, external_id),
  FOREIGN KEY (user_id, source_connection_id)
    REFERENCES source_connections(user_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS assignments_user_due_at_idx ON assignments(user_id, due_at);
CREATE INDEX IF NOT EXISTS assignments_user_course_name_idx ON assignments(user_id, course_name);

CREATE TABLE IF NOT EXISTS assignment_submission_status (
  user_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('unknown','not_submitted','submitted','graded','excused')),
  is_late INTEGER NOT NULL CHECK(is_late IN (0,1)),
  is_missing INTEGER NOT NULL CHECK(is_missing IN (0,1)),
  submitted_at TEXT,
  checked_at TEXT NOT NULL,
  extractor_version TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, assignment_id),
  FOREIGN KEY (user_id, assignment_id)
    REFERENCES assignments(user_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS submission_status_sync (
  user_id TEXT NOT NULL,
  source_connection_id TEXT NOT NULL,
  last_attempted_at TEXT,
  last_successful_at TEXT,
  last_error_code TEXT,
  updated_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, source_connection_id),
  FOREIGN KEY (user_id, source_connection_id)
    REFERENCES source_connections(user_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS assignment_links (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  assignment_a_id TEXT NOT NULL,
  assignment_b_id TEXT NOT NULL,
  relationship TEXT NOT NULL CHECK(relationship IN ('possible_duplicate','same_work','date_conflict')),
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, assignment_a_id, assignment_b_id, relationship),
  FOREIGN KEY (user_id, assignment_a_id)
    REFERENCES assignments(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, assignment_b_id)
    REFERENCES assignments(user_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS calendar_connections (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
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
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS calendar_connections_user_provider_enabled_idx
  ON calendar_connections(user_id, provider, enabled);

CREATE TABLE IF NOT EXISTS calendar_credentials (
  user_id TEXT NOT NULL,
  calendar_connection_id TEXT NOT NULL,
  oauth_refresh_token_envelope TEXT,
  caldav_username TEXT,
  caldav_secret_envelope TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, calendar_connection_id),
  FOREIGN KEY (user_id, calendar_connection_id)
    REFERENCES calendar_connections(user_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS calendar_event_links (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  calendar_connection_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  sync_key TEXT NOT NULL,
  remote_event_id TEXT,
  remote_etag TEXT,
  content_hash TEXT,
  last_synced_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, calendar_connection_id, assignment_id),
  UNIQUE (user_id, calendar_connection_id, sync_key),
  FOREIGN KEY (user_id, calendar_connection_id)
    REFERENCES calendar_connections(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, assignment_id)
    REFERENCES assignments(user_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS calendar_event_links_user_connection_idx
  ON calendar_event_links(user_id, calendar_connection_id);

CREATE TABLE IF NOT EXISTS app_settings (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sync_requests (
  user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  PRIMARY KEY (user_id, request_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS sync_requests_expiry_idx ON sync_requests(expires_at);

CREATE TABLE IF NOT EXISTS oauth_requests (
  user_id TEXT NOT NULL,
  state_hash TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('google','microsoft')),
  code_verifier_envelope TEXT NOT NULL,
  connection_id TEXT,
  return_to TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  PRIMARY KEY (user_id, state_hash),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, connection_id)
    REFERENCES calendar_connections(user_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS oauth_requests_expiry_idx ON oauth_requests(expires_at);
