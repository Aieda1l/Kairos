-- Ownership is server-only durable metadata; encrypted payload/AAD is unchanged.
ALTER TABLE sync_requests ADD COLUMN operation_key TEXT;
ALTER TABLE sync_requests ADD COLUMN owner_nonce TEXT;

-- An old unconsumed bridge row does not prove that its browser work stopped,
-- even when expired. Block overlap after upgrade until targeted 7C recovery.
INSERT INTO operation_locks(user_id,operation_key,owner_nonce,state,started_at_ms,stale_at_ms,not_before_ms)
SELECT user_id,CASE WHEN kind='canvas_submission' THEN 'source:canvas' ELSE 'source:gradescope' END,
  lower(hex(randomblob(16))),'uncertain',CAST(strftime('%s','now') AS INTEGER)*1000,
  CAST(strftime('%s','now') AS INTEGER)*1000,0
FROM sync_requests WHERE consumed_at IS NULL
GROUP BY user_id,CASE WHEN kind='canvas_submission' THEN 'source:canvas' ELSE 'source:gradescope' END
ON CONFLICT(user_id,operation_key) DO UPDATE SET state='uncertain';
