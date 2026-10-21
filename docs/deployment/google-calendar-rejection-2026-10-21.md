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

Check that Calendar API is enabled in the project containing the configured calendar OAuth client; Google identity sign-in is a separate capability. After protected release verification, a fresh consent result must establish the actual failure category and successful connect/sync before closing this incident. Correct error classification alone does not establish that Google's refusal is resolved.

Google documents [calendar creation's supported narrow scope](https://developers.google.com/workspace/calendar/api/v3/reference/calendars/insert) and the distinction between [401 invalid credentials and 403 permission/quota errors](https://developers.google.com/workspace/calendar/api/guides/errors). Keep production log persistence disabled per the separate stored-log assessment; no raw OAuth URL or provider response should be collected for this follow-up.
