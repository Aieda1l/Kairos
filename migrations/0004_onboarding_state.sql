-- This migration is the cutover: users has no creation timestamp. Every user
-- already present, including accounts with no connected sources, bypasses setup.
INSERT INTO app_settings(user_id,key,value,updated_at)
SELECT id,'onboarding',
  '{"version":1,"revision":0,"status":"completed","currentStep":"finish","skipped":[],"drafts":{}}',
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM users WHERE true
ON CONFLICT(user_id,key) DO NOTHING;

-- Preserve the previous automatic submission refresh behavior and any explicit
-- preference. Users created after cutover receive an opt-out during initialization.
INSERT INTO app_settings(user_id,key,value,updated_at)
SELECT id,'canvas_submission_status_enabled','1',strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM users WHERE true
ON CONFLICT(user_id,key) DO NOTHING;
