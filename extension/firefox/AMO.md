# Kairos Bridge — AMO review material

This is preparation for **listed** AMO distribution. Version `0.4.0` keeps the existing ID `kairos-local@kairos`. The packages produced here are **unsigned**. There is no submitted, accepted, signed, or published artifact and no known listing URL. `amo-metadata.json` is local draft copy, not an AMO API submission payload.

Kairos is an independent coursework planner designed first for UW Seattle students. Anyone may create a Kairos account. It is not an official University of Washington product and uses no UW logos. This extension does not add arbitrary Canvas institutions or configurable host permissions. The verified release scope is Firefox **desktop 140.0 or later**. The Android `142.0` manifest floor enforces native-consent compatibility; Android QA and public-distribution acceptance remain outside this task's verified scope.

## Permissions, recipients, and read-only behavior

The only API permission is `tabs`. The broker queries open tabs matching the two source sites and sends extraction requests to an already signed-in source tab. The popup displays whether those tabs are present, and the functional webpage PONG sends two booleans: `canvasTabDetected` for Canvas UW and `gradescopeTabDetected` for Gradescope. These named-domain presence flags are declared as required `browsingActivity`, even though no URLs or general history are sent. There is no `cookies`, `history`, `downloads`, `webRequest`, or `<all_urls>` permission.

The exact manifest host permissions are:

- `https://canvas.uw.edu/*` — Canvas submission-status reads using the existing browser session.
- `https://www.gradescope.com/*` — course discovery and assignment/status/grade reads using the existing browser session.
- `https://mykairos.me/*` — normalized responses to the production Kairos page.
- `http://localhost/*` and `http://127.0.0.1/*` — local development page matching. The runtime bridge further restricts local messages to `http://localhost:3000` and `http://127.0.0.1:3000`.

The production message origin is exactly `https://mykairos.me`. There are no wildcard HTTPS recipients. The page bridge validates origin, message source, and protocol schema before forwarding messages. Source reads use authenticated, same-site browser requests; Firefox supplies the existing session internally. The extension does not export cookies, UW/Canvas/Gradescope passwords, CSRF tokens, authorization headers, names, emails, account/user IDs, or raw authenticated HTML/API responses to Kairos. Source HTML/API results are parsed inside the extension and only the normalized fields below cross the bridge. It does not submit assignments, upload work, change grades, or alter source settings.

Kairos receives these responses on its page and can save the normalized coursework for the signed-in Kairos account. Website account authentication and other Kairos connectors are separate from this extension. Review the public [privacy policy](https://mykairos.me/privacy) together with this material before submission; the controller owns final website/policy alignment.

## Actual bridge fields and data declaration

The manifest requires both `websiteContent` and `browsingActivity`; it never declares `none`. There are no optional data categories and no optional telemetry. Native consent requires Firefox desktop 140 or Android 142, so `gecko.strict_min_version` is `140.0` and `gecko_android.strict_min_version` is `142.0`. These floors prevent installation on older versions lacking that consent, as described in Mozilla's [built-in consent documentation](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/). Android QA and public distribution are not claimed by adding the compatibility floor. If review requires another category, amend the manifest, AMO copy, and website policy together, then repeat consent acceptance before release.

The shipped schemas in `src/lib/extension-protocol/` define the complete transmission:

- Envelope/control fields: protocol version, request UUID, fixed message source/type, fixed error codes and user-facing error messages. Protocol-v1 PONG retains the `extensionVersion` field with the constant compatibility marker `not-shared`; the installed extension version is never included in production webpage PONG. The extension popup can display the actual version locally.
- Named-site presence: `canvasTabDetected` and `gradescopeTabDetected`, indicating whether each source has an open tab. Both booleans remain functional webpage responses and are covered by required `browsingActivity`.
- Canvas requests/results: Kairos assignment-local ID, Canvas course and assignment resource IDs; submission state (`unknown`, `not_submitted`, `submitted`, `graded`, `excused`); late/missing booleans, nullable submitted timestamp, checked timestamp, extractor version, fixed error/diagnostic codes, and optional HTTP status. Canvas does not transmit grade scores through this schema.
- Gradescope discovery: course resource ID, short/full course names, term, and year. These are course names, not student names.
- Gradescope assignment results: course/assignment resource IDs, assignment title, release/due/late-due dates, source status text, normalized submission state, late/missing booleans, submitted timestamp, grade score/max/display, checked timestamp, and extractor version.
- Source diagnostics carried with those reads: fixed error/diagnostic codes, HTTP status, parse-code counts, and structural booleans/counts for detected account/course roots, create-course controls, heading categories, course-list/term/anchor/name/React-props nodes, tables, role rows, assignment links, submit buttons, and assignment-table detection. These contain counts and flags, not source pages or account identifiers; they are part of source responses, not an independent analytics feed.

Classification rationale: coursework/status/grades and course/assignment resource IDs are source website content. HTTP status, fixed fetch/parse outcome codes, and DOM structural counts/flags describe the source-read responses and extraction results, so the controller classifies them as website-content/control results. They do not report device/browser configuration, the installed extension version, usage metrics, or a separate crash/analytics feed. Named-domain tab presence is separately declared as `browsingActivity`, following Mozilla's distinction between website content and visited-domain information. The constant `not-shared` value carries protocol compatibility without version measurement. The bridge does not transmit personal names, emails, user/account IDs, or credentials. This is the controller's classification rationale for review, **not a Mozilla-approved taxonomy or policy decision**.

## Reproduce and inspect the packages

Use Node **22.13+ within the Node 22 branch**; this workflow was tested on **22.23.2**. The locked `addons-linter` parser dependencies require this patch-level floor, so the project's broader `engines.node: >=22` is not sufficient for earlier Node 22 patch releases. Use the included actual root `package.json`, `package-lock.json`, and `tsconfig.json`, and the root build scripts. The build reads the shipped TypeScript config explicitly so an extraction cannot inherit another project's compiler settings or skip config lookup inside `node_modules`. It disables inferred strict-mode directives and emits one explicit `"use strict";` banner, preserving strict runtime behavior consistently across extraction locations. The source archive includes every extension source module, all three shared protocol modules, the imported shared submission-status type module, static extension files, and this review material. It intentionally omits application/server code, fixtures, tests, environment files, credentials, dependencies, generated bundles, and artifacts because none is needed to build the five bundles.

From an extracted reviewer-source archive:

```sh
npm ci --ignore-scripts --registry=https://registry.npmjs.org
npm run build:extension
npm run lint:extension
npm run package:extension
```

With npm 12 remote-package restrictions, add `--allow-remote=all` to that **individual** `npm ci` command if required. Do not change global npm settings or approve all dependency lifecycle scripts. The optional esbuild platform package supplies its binary without requiring lifecycle execution. `web-ext` is pinned to **10.7.0** in the package and lock, not fetched through `npx latest`. Mozilla's [web-ext command reference](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/) describes linting.

The packager validates resolved output destinations before building: linked output ancestors, linked runtime staging paths, and symlinked or hardlinked artifact files are rejected before generated-output mutations. It rechecks destinations before removal and writes, then writes/chmods verified regular-file descriptors. It rebuilds and reads exact file allowlists; it does not scan a working directory or depend on `.gitignore` for privacy. Runtime contents are only `manifest.json`, two icons, `popup.html`, and five `dist/*.js` bundles. Source contents are the actual build inputs at their original relative paths. Bundles remain readable, with no minification or source maps. Both ZIPs use sorted slash-separated names, stored ZIP entries, fixed `1980-01-01 00:00:00` timestamps, and fixed metadata. Identical input bytes and locked dependencies produce identical ZIP bytes. No runtime/source ZIP contains tests, fixtures, `.env*`, `.npmrc`, signing credentials, private workspaces, or `node_modules`.

Archive members have fixed Unix regular-file mode `0644` on every host; generated files also request `0644` filesystem permissions (Windows applies its native ACL semantics). Generated output is ignored under `artifacts/firefox/`:

- `kairos-bridge-0.4.0.zip` — unsigned runtime submission input.
- `kairos-bridge-0.4.0-source.zip` — reviewer build source.
- `SHA256SUMS` — SHA-256 of those two archives, one filename per line.
- `runtime/` — regenerated allowlisted runtime tree used by `lint:extension`; stale files are removed before linting. Extension lint treats warnings as errors. Generated artifacts are also excluded from the application ESLint command.

Check both ZIP member lists, validate CRCs and SHA-256 values, then compare the five rebuilt bundle bytes against the runtime archive. ZIP timestamps do not depend on file mtimes or the host timezone. The source ZIP and its checksum change when any included source, metadata, or lockfile changes.

`lint:extension` uses pinned `web-ext@10.7.0` with `--warnings-as-errors` and `--no-config-discovery`. The controller-approved native-consent floors are desktop `140.0` and Android `142.0`; neither warning suppression nor a weaker lint check is used. AMO listing/reviewer material must continue to describe the verified desktop scope. Any Android QA or public-distribution claim requires separately recorded acceptance evidence.

## Submission, native signed-install consent, and updates (pending)

The operator reports Mozilla Developer Hub is ready. Submission and signing await controller review of this packet; the following store and signed-install/update steps remain external. Do not treat a temporary `about:debugging` install or an unsigned ZIP as signed-install evidence.

1. Review runtime/source member lists, hashes, lint, metadata, and website privacy/onboarding disclosures together. Keep the stable ID and exact origins. Complete any AMO-required account/listing fields with real values, including owner/publisher metadata and the owner's license selection/rights confirmation. There is no root `LICENSE` file, so license selection requires owner input. Do not invent a support destination, license, listing slug, or approval status.
2. Using the ready Mozilla developer account, submit the runtime ZIP for **listed** review/signing and attach the reviewer-source ZIP and build instructions. Keep signing credentials outside the source tree and packages. Resolve automated/manual review findings and record Mozilla's actual decision separately.
3. After acceptance, record the actual AMO listing URL and downloaded signed XPI hash. Configure that verified listing URL for `getFirefoxDistribution`; absent or invalid configuration stays `pending` with no install link. The descriptor validates URL syntax/host/path only; an operator must verify the listing belongs to this extension and is accepted.
4. On a clean Firefox desktop 140+ Release/Beta profile, install from the accepted listing. Verify Firefox's native required **website content** and **browsing activity** prompt, explain the two named-source presence flags, and confirm narrow sites/`tabs` disclosure. Cancel the first prompt and verify no installation/bridge transmission; retry and explicitly accept, then verify `about:addons` shows the stable ID, version, and both required data permissions. Check Firefox 139 cannot install this release. Record browser versions, prompt labels, outcomes, and signed artifact hash without credentials.
5. With separately authorized signed-in Canvas/Gradescope tabs, verify PING/tab detection and normalized read-only source behavior at `https://mykairos.me`. Record outcomes without private coursework or account identifiers. Removing the add-on stops extension reads; use Kairos account/settings controls for already saved coursework.
6. For the next release, increment the extension version while retaining the ID; rerun build/lint/package and review. Submit it to the same AMO listing with matching source. Verify Firefox's normal AMO update path preserves identity, upgrades version, and shows consent for any added required category/permission. Record actual signed-install/update results before claiming release readiness.

No signing, submission, publication, native signed-install acceptance, or update acceptance has been performed by this task. Those are public-beta gates, not implied by passing local tests or lint.
