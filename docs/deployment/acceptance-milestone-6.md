# Milestone 6 Hosted Acceptance

Milestone 6 automated implementation is complete. This checklist is the external gate before Milestone 6 can be marked complete or Milestone 7 work begins.

Use two independent test users, referred to below as **Alice** and **Bob**. Use production-safe test data only. Never record passwords, OAuth client secrets, refresh tokens, app-specific passwords, encryption keys, session cookies, private Canvas feed URLs, or other credentials in this document, screenshots, logs, issues, or chat.

## Preconditions

- [ ] The automated Milestone 6 gate passes on the exact revision intended for deployment.
- [ ] The production Worker uses the canonical origin `https://mykairos.me`.
- [ ] Production D1 migrations `0001_auth.sql` and `0002_kairos_tenant_schema.sql` are applied successfully.
- [ ] Production and preview/test use distinct D1 databases.
- [ ] `E2E_FIXTURES` is not enabled in production.
- [ ] Production secrets exist only in the intended secret stores and are not present in tracked files.
- [ ] Record the current known-good Worker deployment identifier in the deployment record before promotion.

## 1. Identity and protected routing

Run each check independently for Alice and Bob.

- [ ] Google identity sign-in completes at `https://mykairos.me` and returns to an authenticated dashboard.
- [ ] Microsoft identity sign-in completes at `https://mykairos.me` and returns to an authenticated dashboard.
- [ ] Signed-out access to a dashboard route redirects to sign-in.
- [ ] Signing out removes dashboard access on a subsequent request.
- [ ] Public routes `/`, `/privacy`, and `/terms` remain accessible while signed out.

Record only provider, test-user label, pass/fail result, and non-secret deployment identifiers.

## 2. Two-user tenant isolation

Create visibly distinct source, assignment, settings, and calendar state for Alice and Bob.

- [ ] Alice sees only Alice's dashboard assignments, source connections, settings, and calendar destinations.
- [ ] Bob sees only Bob's dashboard assignments, source connections, settings, and calendar destinations.
- [ ] Alice cannot read or mutate a known Bob assignment, source, calendar connection, sync request, OAuth request, or setting by supplying Bob's known identifier.
- [ ] Bob cannot read or mutate a known Alice identifier.
- [ ] Cross-user API attempts fail with the normal not-found/unauthorized behavior and do not modify the owning user's data.
- [ ] A browser-extension submission-status result produced while Alice is signed in persists only to Alice.
- [ ] The same extension workflow under Bob's session cannot read, consume, or overwrite Alice's request or result.

After the attempts, re-open both dashboards and confirm each user's original data remains intact.

## 3. Hosted source and extension boundary

- [ ] Connect or refresh a Canvas feed for one test user and confirm assignments persist after a new browser request/session.
- [ ] Connect Ed with a test token and confirm course/assignment state is scoped to that signed-in user.
- [ ] With a signed-in `canvas.uw.edu` tab, the Firefox bridge at `https://mykairos.me` can synchronize Canvas submission status.
- [ ] With a signed-in `www.gradescope.com` tab, the Firefox bridge at `https://mykairos.me` can discover/synchronize Gradescope data.
- [ ] The extension does not bridge an unapproved Kairos origin and continues to use exact-origin matching.
- [ ] No Canvas/Gradescope cookie, authorization header, password, CSRF token, or authenticated HTML appears in Kairos API bodies, UI, or logs.

## 4. Hosted calendar destinations

Complete these checks for a signed-in test user, then confirm the other user cannot see or operate the resulting connection.

### Google Calendar

- [ ] Connect Google Calendar through the production callback on `https://mykairos.me`.
- [ ] Confirm the callback origin/path is exact and no localhost callback is used.
- [ ] Confirm a dedicated Kairos calendar can be created/selected and synchronized.
- [ ] Repeat sync and confirm no duplicate event is created.
- [ ] Change a source due date and confirm the existing generated event moves.
- [ ] Reconnect Google Calendar and confirm the destination remains usable without duplicating managed events.

### Microsoft Calendar

- [ ] Connect Microsoft Calendar through the production callback on `https://mykairos.me`.
- [ ] Confirm the callback origin/path is exact and no localhost callback is used.
- [ ] Confirm a dedicated Kairos calendar can be created/selected and synchronized.
- [ ] Repeat sync and confirm no duplicate event is created.
- [ ] Change a source due date and confirm the existing generated event moves.
- [ ] Reconnect Microsoft Calendar and confirm managed events are adopted without duplication.

### Apple iCloud Calendar

- [ ] Connect iCloud CalDAV using a test Apple Account email and app-specific password entered only in the product UI.
- [ ] First create a writable calendar named **Kairos** in iCloud Calendar, then connect using the app-specific password. Confirm Kairos discovers that calendar and synchronizes events; Cloudflare Workers cannot issue the CalDAV `MKCALENDAR` method.
- [ ] Repeat sync and confirm no duplicate event is created.
- [ ] Change a source due date and confirm the existing generated event moves.
- [ ] Confirm the app-specific password is cleared from the form after capture and never rendered back.

## 5. Credential non-exposure

Inspect production behavior without copying secret values into the acceptance record.

- [ ] D1 credential columns contain encrypted envelopes where durable secrets are expected; no plaintext Canvas feed URL, Ed token, OAuth refresh token, or iCloud app-specific password is visible.
- Read-only production evidence on October 10: every present Canvas, Ed, calendar refresh-token, and OAuth PKCE value matched the expected versioned envelope structure; only aggregate counts were returned. No iCloud password rows were present to inspect. This establishes stored format for present values, not the remaining API/page/log non-exposure checks.
- [ ] Normal source/calendar/status APIs never return stored credentials.
- [ ] Rendered pages never contain stored credentials.
- [ ] Worker/application logs do not contain stored credentials, authorization headers, session cookies, OAuth tokens, PKCE verifiers, or private provider response bodies.
- [ ] OAuth request state is user-bound, expiring, and single-use; replay fails without changing connection state.

## 6. Account deletion isolation

Use a disposable test identity for the deletion check.

- [ ] Give Alice and Bob independent source, assignment, calendar, setting, credential, and session state.
- [ ] Delete Alice's Kairos account through the product.
- [ ] Alice's authenticated session is invalidated and Alice's tenant data is removed.
- [ ] Bob remains signed in and Bob's data is unchanged.
- [ ] A subsequent Alice sign-in starts from a clean Kairos tenant state.

## 7. Rollback

Before promotion, record the non-secret identifier of the current known-good Worker deployment.

- [ ] If deployment smoke fails before normal traffic is accepted, stop promotion.
- [ ] If a new Worker revision is faulty, route traffic back to the recorded known-good Worker deployment.
- [ ] Do not roll D1 schema backward destructively. If a migration is implicated, stop writes or traffic as appropriate and ship a forward-compatible corrective migration.
- [ ] Re-run identity, protected-route, tenant-isolation, and credential non-exposure smoke checks after rollback.
- [ ] Record the failed deployment identifier, restored deployment identifier, time, and pass/fail outcome without recording credentials.

## Acceptance result

### Evidence recorded on October 10, 2026

- The production user confirmed Canvas and Microsoft Calendar connections work after the feed-header and personal-account authority fixes.
- The user reports calendar synchronization works and subsequently confirmed that the requested edge cases were checked and seem clean. Record the calendar functional/edge-case results as user-attested passes; no fabricated provider/user matrix is supplied.
- Sign out is available in the desktop sidebar (including its collapsed state) and mobile navigation menu. Browser tests use the real Auth.js sign-out endpoint with isolated test database sessions: signing out clears the current session, rejects replay of its old cookie, removes protected-route/API access, preserves tenant data, and leaves the other user signed in. The user subsequently confirmed hosted sign-in and logout work.

### Subsequent hosted results reported by the user

The user explicitly reported: “Two user isolation passes and works. Sign in and logout works. Account deletion works. Sources and Firefox extension work.” Record these as functional acceptance passes based on the user's production tests, without inventing a provider/user matrix or separate results for unreported security probes.

| Area | Current evidence |
| --- | --- |
| Sign-in and logout | User-confirmed hosted pass |
| Two-user isolation | User-confirmed hosted pass |
| Sources and Firefox extension | User-confirmed hosted pass |
| Account deletion | User-confirmed hosted pass |
| Calendar synchronization | User-confirmed working; requested edge cases subsequently confirmed clean |
| Credential privacy/security | Reviewed and remediated; 509 automated tests and 14 browser cases pass; final hosted identity-token cleanup and release smoke are pending |
| Release sign-off | Committed privacy release and final Worker identifier will be recorded after promotion; rollback reference is `8929c5e8-32bc-4a59-87d7-5c6812e5be37` |

The detailed checklist above remains the sign-off record. Manual functional and edge-case results are attributed to the user. Agent negative-origin, credential-disclosure, OAuth-replay, and encryption tests are documented in `security-review-2026-10-10.md`.

Milestone 6 remains **hosted acceptance pending** until every required item above passes on the production deployment.

When complete, record only:

- production revision/commit;
- non-secret Worker deployment identifier;
- acceptance date;
- pass/fail for each section;
- any non-secret issue references.

Do not mark Milestone 6 complete if any required item is skipped, fails, or has unresolved cross-user or credential-exposure behavior.
