# Google calendar rejection after disconnect — October 21, 2026 UTC

The user reports that connecting Google after a local disconnect displays "Google Calendar rejected the authorization. Start a new connection" and does not sync. Read-only production inspection at 18:19 UTC on source `5547ff1` confirms no Google connection/credential remains, a consumed callback at 18:18 UTC and an idle Google owner. Microsoft remains connected and synchronized. This is not the earlier retained Microsoft owner.

## Confirmed application defect

`GoogleCalendarClient` classified **every HTTP 403** as `CALENDAR_AUTH_EXPIRED`, including calendar creation and ordinary sync checks. The prior reconnect repair corrected this distinction only for saved-calendar access validation. A newly disconnected connection uses calendar creation first, so it could still receive the misleading authorization message. The production provider response body was not retained; the user's exact upstream refusal remains unverified.

The repair shares the existing fixed Google error classifier between the API client and saved-calendar access validation. HTTP 401 remains expired authorization. HTTP 403 defaults to permission denied; known `accessNotConfigured` / `SERVICE_DISABLED` reasons become configuration errors, and known quota/rate reasons become rate-limit errors. Malformed or unknown 403 bodies remain permission errors. Only fixed application codes/messages escape the classifier; provider messages, metadata and raw reason strings are not retained in the error, logs or callback URL.

This changes no OAuth scopes, provider URLs, remote calendar selection, ownership fences, credentials, migrations or billing. It adds no provider calls or automatic retries. Configuration failures now ask for a Kairos configuration update; permission text also applies to a new connection rather than assuming a saved destination exists.

## Verification and remaining acceptance

- Before repair, 14 new regression cases failed because 403 responses became expired authorization. The unchanged 401 case already passed.
- After repair, all 102 focused client/callback/hosted-recovery tests pass. Callback cases distinguish successful token exchange from rejected calendar creation, clear one-time OAuth URL material, make exactly two provider calls and save no rejected connection.
- Local full suite: 1,540 passed, 46 skipped on this platform (1,586 total). Typecheck, scoped lint, Workers build and all 12 existing compiled provider/returning-session cases pass. Local tests use synthetic credentials/providers and do not establish production Google acceptance.

The operator confirms Calendar API is enabled in the project containing the calendar OAuth client and that calendar access was allowed on the consent screen. These facts do not establish the scope or access of the token Google actually returned. A fresh consent result on the deployed repair must establish the actual failure category and successful connect/sync before closing this incident. Correct error classification alone does not establish that Google's refusal is resolved.

## Deployed classification repair

[PR #28](https://github.com/Aieda1l/Kairos/pull/28) merged as `f33c240537b073f17aeb0e6a90518ea0d1a9c7a8`. Its [exact-main CI](https://github.com/Aieda1l/Kairos/actions/runs/39655049172) passed all **1,586 tests and 63 browser cases**, including the native calendar lifetime and compiled provider checks. A clean archive of that exact source built without private environment files and passed all 12 compiled runtime cases plus the lifetime probe. The 339-file distribution was hashed before upload.

Worker `25c582e4-3560-48b4-9f8f-260d4661ff19` is active at 100%, deployment `5eae3331-cef5-46eb-917b-c1c805f97f0e`. Staged and promoted binding/secret-name, schema-7, persistence-off, health and isolation checks passed. All 11 anonymous public checks passed; the served client hash matches the sealed artifact. The [post-release GitHub health check](https://github.com/Aieda1l/Kairos/actions/runs/39656590873) passed on the same source.

Read-only verification at 18:52 UTC still has no Google connection/credential and no callback since promotion. Microsoft retains a successful connection, one credential and 17 mappings; both owners are idle and both provider controls remain enabled at version 4. No ownership recovery, production data edit, scope change or billing change was performed for this release. Fresh Google reconnect/sync acceptance remains pending.

Ignored operational receipts are under `artifacts/google-calendar-rejection-release/`; raw provider bodies and real credentials are not recorded.

Google documents [calendar creation's supported narrow scope](https://developers.google.com/workspace/calendar/api/v3/reference/calendars/insert) and the distinction between [401 invalid credentials and 403 permission/quota errors](https://developers.google.com/workspace/calendar/api/guides/errors). Keep production log persistence disabled per the separate stored-log assessment; no raw OAuth URL or provider response should be collected for this follow-up.
