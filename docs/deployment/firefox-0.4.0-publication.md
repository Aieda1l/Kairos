# Firefox 0.4.0 publication evidence

Checked October 15, 2026. [Kairos Bridge](https://addons.mozilla.org/en-US/firefox/addon/kairos-bridge/) is public/approved with stable ID `kairos-local@kairos`, version 0.4.0 and MIT license. This closes the reported Mozilla review wait. Website changes remain subject to the separate M7 release gate.

## Artifact checks

Mozilla's public API identifies add-on 3093647 and signed file 5111578. The downloaded [signed XPI](https://addons.mozilla.org/firefox/downloads/file/5111578/kairos_bridge-0.4.0.xpi) matches its published SHA-256:

`7f28cbdacf44aba62466e34bb508d2a2026eaa4059e32a5511b94416b15abf64`

All executable payloads match the immutable reviewed runtime ZIP. The only changed runtime member is manifest JSON serialization; parsed values are identical. No extra non-signature members or duplicate members were found. PKCS7 content verification and all 13 JAR member digests pass. That cryptographic check did not validate the Mozilla root trust chain; normal Firefox trust/installation is operator evidence below. The API's `is_mozilla_signed_extension` flag describes a Mozilla-internal certificate, as defined in the [official API documentation](https://mozilla.github.io/addons-server/topics/api/addons.html); it does not identify ordinary AMO signing.

Desktop minimum 140.0, Android floor 142.0, `tabs`, the five narrow host permissions and required `websiteContent`/`browsingActivity` declarations match reviewed source. An Android compatibility floor does not establish Android QA.

The original submission packets remain unchanged:

- Runtime ZIP: `d8236a7ce8047f8a4df25fcb641a2d7aad0702ab6731c8868b6534df947477a7`.
- Reviewer-source ZIP: `f9661c4197e3b4911021d235bff0809f79c86a35068aa8c504ef048c30ee738b`.

## Operator acceptance and open work

The operator explicitly confirms installation from the published Mozilla listing in normal Firefox, accepting native data permission consent, and successful Canvas/Gradescope reads. Browser version, prompt cancellation and older-browser rejection were not independently recorded. This evidence is separate from prior temporary developer installation.

Only 0.4.0 appears in the public version history. An actual version-to-version AMO update remains unverified; retain that acceptance check for the next legitimate extension release. Do not publish a dummy version solely to claim update coverage.

The public API currently returns no detailed description, homepage, support URL or privacy-policy entry. This continuation made no remote listing changes. The owner can fill those Developer Hub fields using the exact prepared copy in [AMO.md](../../extension/firefox/AMO.md#post-publication-listing-corrections), then recheck the public record. Listing disclosure acceptance remains open until those fields match the published behavior and policy.

Sanitized API records, signed-artifact comparison and signature checks are retained under ignored `artifacts/m7-preflight/`. No Mozilla credentials or private source-site data were collected.
