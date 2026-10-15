-- Identity OAuth credentials are only needed while completing sign-in.
-- Keep account links, users, sessions, and encrypted calendar grants intact.
UPDATE accounts
SET access_token=NULL,
    refresh_token=NULL,
    id_token=NULL,
    oauth_token=NULL,
    oauth_token_secret=NULL;
