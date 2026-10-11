# Public contacts and support operations

Prepared October 10, 2026. Public aliases are `support@mykairos.me` and `security@mykairos.me`; their static mailto links live in `src/lib/public-contacts.ts`. Never publish the private destination inbox in app HTML, source, screenshots, README, provider review material, logs or this runbook.

## Verified configuration, pending delivery

Controller evidence supersedes the earlier research note that routing was disabled: Email Routing is enabled, the privately selected destination is verified, both explicit alias rules are enabled and point to that inbox. Public DNS checks found three Cloudflare MX records and one Cloudflare SPF record. Actual end-to-end inbox delivery confirmation is **pending** for both aliases. This worker has no new inbox evidence and sends no test messages. The pages therefore state routing is active and delivery confirmation pending, with no monitoring or response-time guarantee.

| Check | Status |
| --- | --- |
| Selected destination verified privately | Verified by controller |
| `support@mykairos.me` explicit rule | Enabled, routing verified |
| `security@mykairos.me` explicit rule | Enabled, routing verified |
| Authoritative DNS | Three Cloudflare MX, one Cloudflare SPF; controller independently verified |
| Actual external test receipt: support | Pending operator confirmation |
| Actual external test receipt: security | Pending operator confirmation |
| Reply handling / mailbox monitoring | No verified operating cadence or reply workflow claimed |
| Outbound transactional mail | Not implemented; do not treat aliases as password-reset senders |

## Preserve configuration and verify delivery

1. Inspect current authoritative MX/SPF, Email Routing destination and all existing alias rules privately before changing anything. Historical imported Namecheap forwarding is not evidence of current active routing. Preserve existing aliases; do not replace MX blindly, add a duplicate SPF record, or re-run a mail migration that is already complete.
2. If configuration recovery is necessary, privately choose and verify the operator inbox, enable explicit support/security rules, preserve any other aliases, and confirm the intended Cloudflare DNS. This is an operator action, not part of the C2 worker's scope. [Cloudflare Email Routing setup](https://developers.cloudflare.com/email-routing/get-started/enable-email-routing/) describes destination verification and routing prerequisites.
3. Operator sends a non-sensitive test from an independent external mailbox to **each alias** with a distinct timestamp/subject label. Inspect inbox and spam for actual receipt and ensure the destination matches the privately selected inbox. Do not include credentials or real coursework; this worker does not send mail.
4. Record labels, sent/received timestamps, success/failure and inbox/spam outcome only. Keep screenshots/private addresses/message headers out of the repository. A verified destination, enabled rule or MX lookup is not proof of delivery.
5. Update public delivery status only after both tests are confirmed. Claim monitoring only once a real responsible operator and checking cadence are established. Keep an honest no-fixed-response-time statement until a response commitment actually exists. Provider support-contact acceptance remains pending until reachability is proved.
6. If a reply workflow is required, verify it separately and protect the private inbox address in outgoing From/Reply-To. Cloudflare inbound forwarding alone does not establish alias outbound sending or a transactional email service. Do not send from the private destination by accident.

## Support and security triage

Ask for feature/source/provider, browser version, local extension popup version, approximate time/timezone, expected/actual behavior and visible error category. Prepared unsigned/unlisted 0.4.0 uses `not-shared` in webpage PONG; earlier development builds can send installed-version compatibility information. C2-only deployment on finalized M6 does not replace that installed extension. Redact screenshots. Never ask users to email passwords, Canvas feed URLs, Ed tokens, cookies, authorization codes, OAuth tokens or Apple app-specific passwords. Source HTTP/DOM diagnostics and version compatibility information are source/control results; do not request raw authenticated HTML.

Security concerns go privately to the security alias. Keep credentials, private feeds, student coursework and account data out of public issues. Reproduction must use authorized accounts/data; stop if another user's information appears. Avoid promises of a bounty, legal safe harbor, certification or fixed response time.

Use the [privacy notice](https://mykairos.me/privacy) for access/correction/deletion questions. In-app deletion removes live user records but not support mail, D1 recovery history, remote calendar events or provider grants. For remote cleanup, remove generated events while connected, inspect the result, disconnect, then revoke at the provider. Verify account ownership without requesting passwords or tokens if a user cannot sign in. Support correspondence currently has no verified fixed retention/deletion schedule; account deletion does not erase it automatically.

## Review/deployment boundary

The worker prepares code and instructions only. Parent performs fresh review, controlled public-page deployment and post-deploy anonymous HTML checks. Domain ownership is now operator-confirmed; wait the user-reported Google 24-hour interval before retry and do not infer brand approval. Mozilla signing/listing and independent-account provider acceptance remain separate gates. MIT licensing is selected; parent prepares license artifacts and rights/notices review separately.

Before public launch, confirm the deployed D1 plan (documented Time Travel windows: Free 7 days / Paid 30 days), any future log retention and actual abuse-control wiring/cleanup. Current persistent application logs are disabled. Prepared Turnstile/rate guards are not active in production; rate records would be pseudonymous/tenant-linked, not anonymous, and one-hour expiry alone is not a verified deletion schedule.
