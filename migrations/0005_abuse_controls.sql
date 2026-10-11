-- Additive durable admission and ownership state. Cleanup is 7C-owned:
-- at least daily, bounded indexed batches for expired events/runs only.
-- Running/uncertain operation ownership is never purged on elapsed time.
CREATE TABLE abuse_rate_events (
  event_id TEXT NOT NULL PRIMARY KEY CHECK(length(event_id)>0),
  key_hash TEXT NOT NULL CHECK(length(key_hash)=43 AND key_hash NOT GLOB '*[^A-Za-z0-9_-]*'),
  user_id TEXT,
  admitted_at_ms INTEGER NOT NULL CHECK(typeof(admitted_at_ms)='integer' AND admitted_at_ms>=0),
  purge_after_ms INTEGER NOT NULL CHECK(typeof(purge_after_ms)='integer' AND purge_after_ms>=admitted_at_ms),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX abuse_rate_events_key_time_idx ON abuse_rate_events(key_hash,admitted_at_ms);
CREATE INDEX abuse_rate_events_purge_idx ON abuse_rate_events(purge_after_ms);
CREATE INDEX abuse_rate_events_user_idx ON abuse_rate_events(user_id);

CREATE TABLE abuse_controls (
  control_key TEXT NOT NULL PRIMARY KEY CHECK(control_key IN (
    'auth:initiation','auth:google','auth:microsoft-entra-id',
    'provider:canvas','provider:gradescope','provider:ed','provider:google','provider:microsoft','provider:caldav'
  )),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  version INTEGER NOT NULL CHECK(typeof(version)='integer' AND version>=0),
  updated_at_ms INTEGER NOT NULL CHECK(typeof(updated_at_ms)='integer' AND updated_at_ms>=0)
);
INSERT INTO abuse_controls(control_key,enabled,version,updated_at_ms) VALUES
  ('auth:initiation',1,0,CAST(strftime('%s','now') AS INTEGER)*1000),
  ('auth:google',1,0,CAST(strftime('%s','now') AS INTEGER)*1000),
  ('auth:microsoft-entra-id',1,0,CAST(strftime('%s','now') AS INTEGER)*1000),
  ('provider:canvas',1,0,CAST(strftime('%s','now') AS INTEGER)*1000),
  ('provider:gradescope',1,0,CAST(strftime('%s','now') AS INTEGER)*1000),
  ('provider:ed',1,0,CAST(strftime('%s','now') AS INTEGER)*1000),
  ('provider:google',1,0,CAST(strftime('%s','now') AS INTEGER)*1000),
  ('provider:microsoft',1,0,CAST(strftime('%s','now') AS INTEGER)*1000),
  ('provider:caldav',1,0,CAST(strftime('%s','now') AS INTEGER)*1000);

CREATE TABLE operation_locks (
  user_id TEXT NOT NULL,
  operation_key TEXT NOT NULL CHECK(length(operation_key)>0),
  owner_nonce TEXT NOT NULL CHECK(length(owner_nonce)>0),
  state TEXT NOT NULL CHECK(state IN ('idle','running','uncertain')),
  started_at_ms INTEGER NOT NULL CHECK(typeof(started_at_ms)='integer' AND started_at_ms>=0),
  stale_at_ms INTEGER NOT NULL CHECK(typeof(stale_at_ms)='integer' AND stale_at_ms>=started_at_ms),
  not_before_ms INTEGER NOT NULL CHECK(typeof(not_before_ms)='integer' AND not_before_ms>=0),
  PRIMARY KEY (user_id,operation_key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE sync_all_runs (
  user_id TEXT NOT NULL,
  run_id TEXT NOT NULL CHECK(length(run_id)>0),
  expires_at_ms INTEGER NOT NULL CHECK(typeof(expires_at_ms)='integer' AND expires_at_ms>=0),
  eligible_steps_json TEXT NOT NULL CHECK(CASE WHEN json_valid(eligible_steps_json) THEN json_type(eligible_steps_json)='array' ELSE 0 END),
  PRIMARY KEY (user_id,run_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX sync_all_runs_expiry_idx ON sync_all_runs(expires_at_ms);
CREATE TABLE sync_all_steps (
  user_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  step_key TEXT NOT NULL CHECK(step_key IN ('canvas-deadlines','canvas-submissions','gradescope','ed','calendars')),
  claimed_at_ms INTEGER NOT NULL CHECK(typeof(claimed_at_ms)='integer' AND claimed_at_ms>=0),
  PRIMARY KEY (user_id,run_id,step_key),
  FOREIGN KEY (user_id,run_id) REFERENCES sync_all_runs(user_id,run_id) ON DELETE CASCADE
);
ALTER TABLE oauth_requests ADD COLUMN control_version INTEGER NOT NULL DEFAULT 0 CHECK(typeof(control_version)='integer' AND control_version>=0);
