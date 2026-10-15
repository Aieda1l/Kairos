# Provider configuration and approval material

Prepared October 10, 2026 for Task7C-2; cross-release disclosures updated October 11. This file is review material, not an approval or deployment record. Parent review and controlled public-page deployment precede resubmission. Do not put client secrets, verification TXT values, real account identifiers, feed URLs, or the private contact destination in this document.

## Latest operator update

Google branding is operator-confirmed fully approved after review. Mozilla has published signed 0.4.0; the public artifact matches reviewed runtime behavior, and normal Firefox installation, native consent and Canvas/Gradescope reads are operator-confirmed. An actual version upgrade and missing public listing disclosures remain open; see [publication evidence](firefox-0.4.0-publication.md). The operator also reports testing two Kairos accounts with apparently successful results, without specifying the tested revision or individual flows. Branding approval does not by itself establish any separate calendar/data-access review state or every hosted acceptance condition. The dated preparation snapshot below is historical; use the [current readiness record](readiness-milestone-7.md) for remaining gates.

## Historical preparation state

| Gate | Evidence / status |
| --- | --- |
| Hosted foundation | Milestone 6 runtime; homepage already public. New C2 content is pending parent deployment. |
| Google OAuth publishing | User reports published. This is separate from brand and data-access verification. |
| Google rejection | User reports ownership unregistered, insufficient privacy, home behind login/purpose unclear, and a generic Google API Terms/AI content flag. These are reported review failures, not proof of an AI feature. |
| Search Console ownership | **Operator confirmed:** Domain property `mykairos.me` verified using the Google account associated with the OAuth project. Exact completion time is not recorded here. |
| Retry interval | Google's user-reported notice says **wait 24 hours after ownership verification** before retry. Record the verified completion time privately and wait the full interval; do not invent a deadline or provider guarantee. |
| Anonymous baseline | Parent `production-before-public-pages.json`: `/` and `/privacy` HTTP 200, no redirects/challenges, ordinary and Google-InspectionTool user agents without cookies; privacy still a development placeholder. A spoofed agent is not an actual Google crawl or approval. |
| Contact | Domain aliases route to a verified private inbox; routing/DNS independently verified active. Actual delivery confirmation pending. |
| Mozilla | AMO Developer Hub ready per user; unsigned/unlisted extension, approval/platform/install acceptance pending. No real listing URL yet. |
| Licensing | User selected MIT for project and extension, copyright (c) 2026 Kairos contributors. Parent's license/notice/metadata supplement is separate; do not assert those files or third-party rights checks are complete. |
| Abuse / monitoring | B1 foundation reviewed, not wired/deployed. Turnstile configured, not active in production. Persistent application logs disabled. |

## Exact production callbacks, scopes and audience

Production origin is `https://mykairos.me`. Identity routes use Auth.js; calendar callbacks are explicitly canonicalized by `src/lib/calendar/local-oauth-origin.ts`. Register every URI exactly; a calendar callback is not the identity callback. Verify each configured client independently if identity and calendar use different registrations.

| Flow | Production redirect URI | Requested scopes / authorization | Audience / registration |
| --- | --- | --- | --- |
| Google identity | `https://mykairos.me/api/auth/callback/google` | `openid email profile` | Google Web application. Intended external Google accounts, subject to consent/administrator restrictions. |
| Google Calendar, optional | `https://mykairos.me/api/calendars/google/callback` | `https://www.googleapis.com/auth/calendar.app.created`; `access_type=offline`, `prompt=consent`, PKCE S256 | Google Web application with Calendar API enabled. Separate contextual consent after identity sign-in. |
| Microsoft identity | `https://mykairos.me/api/auth/callback/microsoft-entra-id` | `openid profile email User.Read` | Confidential Web; `AzureADandPersonalMicrosoftAccount`; issuer `https://login.microsoftonline.com/common/v2.0`. |
| Microsoft Calendar, optional | `https://mykairos.me/api/calendars/microsoft/callback` | Delegated `offline_access Calendars.ReadWrite`, authorization code + PKCE S256, server-held secret | Confidential Web; tenant `common`; any organizational directory plus personal Microsoft accounts. |
| Apple iCloud, optional | No OAuth callback | Apple Account email + app-specific password, fixed iCloud CalDAV service | Account with two-factor authentication and an existing writable calendar named **Kairos**. |

Identity Google credentials: `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`. Identity Microsoft: `AUTH_MICROSOFT_ENTRA_ID_ID`, `AUTH_MICROSOFT_ENTRA_ID_SECRET`, optional `AUTH_MICROSOFT_ENTRA_ID_ISSUER` (default above). Google calendar: `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`. Microsoft calendar: `MICROSOFT_CALENDAR_CLIENT_ID`, `MICROSOFT_CALENDAR_CLIENT_SECRET`, `MICROSOFT_CALENDAR_TENANT=common`. Production `KAIROS_APP_URL` and `AUTH_URL` are `https://mykairos.me`. Store secret **values**, not Microsoft secret IDs, privately in Worker bindings. Never use SPA or Mobile/desktop public-client registration as the hosted confidential Web configuration.

Local development registers the actual local Web callbacks separately, such as `http://localhost:3000/api/auth/callback/google`, `http://localhost:3000/api/auth/callback/microsoft-entra-id`, `http://localhost:3000/api/calendars/google/callback`, and `http://localhost:3000/api/calendars/microsoft/callback`. Register `127.0.0.1:3000` variants separately if used. Do not apply historical Microsoft portless public-client instructions to hosted setup. Preview origins have no public production OAuth authorization implied by this matrix.

## Review explanation derived from code

Kairos is an independent UW-first coursework/deadline dashboard, open to Google and Microsoft identities. Connected Canvas, Gradescope and Ed sources supply course/assignment dates, status and published grades. Sign-in uses basic identity to associate a private dashboard with the user, without retaining identity access/refresh/ID tokens. Source and optional calendar refresh credentials are separately encrypted in Cloudflare D1; ordinary identity/coursework/metadata are not application-encrypted.

Optional Google Calendar consent lets Kairos create a secondary calendar, read its identity and generated events for reconciliation, and create/update/delete deadline markers there. Google access is limited to app-created calendars. Microsoft permission is broader; Kairos lists calendars to locate its dedicated destination and manages generated events there. Event copies contain course/assignment title, time, source, status and a cleaned source link. iCloud selects an existing calendar the user creates.

Google data use is confined to sign-in and the optional calendar feature under the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including Limited Use. Current application code has no advertising/data-sale, AI model training or media-generation path. Human access is limited by the published privacy commitments. No provider approval, compliance certification, or unrelated AI feature should be asserted to resolve a generic review flag. A new use needs updated disclosures and consent before use.

Code references: `src/lib/auth/config.ts`; migrations `0001_auth.sql`, `0002_kairos_tenant_schema.sql`, `0003_identity_token_minimization.sql`; `src/lib/db/d1/repositories/{source-credentials,calendar-credentials,oauth-requests}.ts`; `src/lib/calendar/{google,microsoft}/{oauth,client}.ts`; `src/lib/calendar/projection.ts`; `src/lib/account/delete-account.ts`; `src/lib/calendar/connection-service.ts`. Prepared 0.4.0 Firefox disclosures match `extension/firefox/manifest.json`, `src/background.ts` (`not-shared`) and `src/popup.ts` (real local version). Earlier development builds can send installed-version compatibility information in PONG. The limited public-page release targets finalized M6 and does not sign, publish or upgrade the extension; policies explicitly describe both behaviors.

## Google ownership and retry runbook

1. Confirm the Search Console **Domain property** `mykairos.me` is verified by a Google account associated with the OAuth project as Owner/Editor. Operator has confirmed this gate; keep the TXT verification record and token private. Domain ownership is separate from OAuth approval.
2. Keep `mykairos.me` as an OAuth authorized domain. Set app homepage `https://mykairos.me/`, privacy `https://mykairos.me/privacy`, terms `https://mykairos.me/terms`. Keep app name Kairos consistent with public purpose and operator contact. Configure an eligible support email in Google Console; if an alias is not offered by the selector, use a privately managed eligible account there rather than inventing an accepted setting. Developer contact recipients must be reachable.
3. Parent freshly reviews C2 and deploys only the controlled public-page change after its gate. Do not wire abuse controls or sign/publish the extension as a side effect of this deployment.
4. Parent records anonymous GET results for `/`, `/privacy`, `/terms`, `/support`, `/security`: status 200, final URL/redirect chain, no login/challenge, HTML title/purpose/legal links, privacy sections present and placeholder absent. Inspect canonical host, `www`/alternate origin behavior, HTTP-to-HTTPS redirects and stale cache if Google's earlier home-behind-login notice persists. Test without cookies and with ordinary/Google-InspectionTool agents as diagnostics only. Check that HTML exposes the text before client JavaScript runs. Do not call these checks Google approval.
5. Wait the full **24 hours from operator-confirmed ownership** as directed by the user's provider notice, and ensure the updated pages are deployed before retry. Record only a status/timestamp label privately if needed; no DNS tokens or account email addresses in review material.
6. Review actual Google Console Branding, Audience, Data Access and Verification Center independently. Declare exact current scopes above. Published OAuth, verified ownership, verified/published branding and any data-access review are separate states. Follow any provider-requested cancellation/resubmission steps deliberately; this worker submits nothing.
7. Retry brand verification and record the actual result. If Google asks for a demonstration, show public purpose/privacy, basic identity sign-in, separate optional calendar consent, a generated deadline and disconnect/revocation instructions using authorized accounts. Do not silently expand scopes. If rejected again, record the specific category and current HTML evidence.
8. Complete fresh independent external-account sign-in/calendar acceptance. Record labels/outcomes only, including any managed-account restrictions. Do not infer it from the operator's prior successful account.

[Google's brand verification requirements](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification) require a public relevant homepage, same-domain privacy disclosures and Search Console ownership by an account associated with the project. The 24-hour wait above is user-reported provider instruction, not an independently established universal SLA.

## Revocation and deletion acceptance — pending live operator run

Use disposable data and real authorized accounts; do not run production deletion from this worker. In each provider, verify a known generated event, use **Remove generated events**, inspect its result, then disconnect. Ordinary reconciliation can recreate eligible events until disconnected. Check that saved credentials stop working after provider revocation without exposing them. For Google use [account connections](https://myaccount.google.com/connections); for Microsoft use the account's application-permission controls or its administrator; for Apple revoke the app-specific password at [Apple Account](https://account.apple.com/).

Delete a disposable Kairos account via Settings only after optional remote cleanup. Confirm signed-out access and removal of live account-owned data with labels/aggregate outcomes, not raw rows. Existing code deletion/disconnect has no remote revoke/event-delete call; remote events and grants can survive. D1 Time Travel history is separate: 7 days Free / 30 days Paid, deployed plan unconfirmed. A restore requires reconciliation of prior deletion requests. Record failures honestly; historical Milestone 6 tests are not a new live revocation check.

## Primary provider references

- [Microsoft supported audiences](https://learn.microsoft.com/en-us/entra/identity-platform/v2-supported-account-types) and [authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow).
- [Cloudflare D1 recovery windows](https://developers.cloudflare.com/d1/reference/time-travel/).
- [Workers Logs current retention](https://developers.cloudflare.com/workers/platform/pricing/): disabled in Kairos; if enabled, confirm plan (currently Free 3 days / Paid 7 days). Recheck the announced December 1, 2026 pricing transition before enabling logs.
- [Turnstile privacy](https://www.cloudflare.com/turnstile-privacy-policy/): provisioned only; prepared controls are not active production protection. One-hour pseudonymous rate-record horizon has no wired purge, so physical retention can be longer during outages. Reconcile policy when B2 guards/cleanup/logging integrate.
