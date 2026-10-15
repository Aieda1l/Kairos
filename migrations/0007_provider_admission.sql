-- Starts alone consume a budget. One-use continuations carry server-held proof.
-- NULL is deliberately not backfilled: pre-upgrade work was never admitted.
ALTER TABLE oauth_requests ADD COLUMN admitted_at_ms INTEGER
  CHECK(admitted_at_ms IS NULL OR (typeof(admitted_at_ms)='integer' AND admitted_at_ms>=0));
ALTER TABLE sync_requests ADD COLUMN admitted_at_ms INTEGER
  CHECK(admitted_at_ms IS NULL OR (typeof(admitted_at_ms)='integer' AND admitted_at_ms>=0));
ALTER TABLE sync_requests ADD COLUMN control_version INTEGER
  CHECK(control_version IS NULL OR (typeof(control_version)='integer' AND control_version>=0));
-- Remote bridge work may still exist. Do not release or reissue its owner.
UPDATE operation_locks SET state='uncertain'
WHERE state='running' AND EXISTS (
  SELECT 1 FROM sync_requests request
  WHERE request.user_id=operation_locks.user_id
    AND request.operation_key=operation_locks.operation_key
    AND request.owner_nonce=operation_locks.owner_nonce
    AND request.consumed_at IS NULL AND request.admitted_at_ms IS NULL
);
