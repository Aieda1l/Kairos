-- Separate disposable fixture D1 only. Setup occurs once before dispatch.
CREATE TABLE fixture_operation (
  run_id TEXT NOT NULL,
  scenario TEXT NOT NULL,
  operation TEXT NOT NULL,
  call_cap INTEGER NOT NULL CHECK(call_cap BETWEEN 1 AND 128),
  calls INTEGER NOT NULL DEFAULT 0 CHECK(calls BETWEEN 0 AND call_cap),
  PRIMARY KEY(run_id, operation)
) WITHOUT ROWID;
-- No Worker endpoint can insert, delete, reset or alter these rows.
