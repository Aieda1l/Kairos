# Kairos DNS Runbook

Production uses `https://mykairos.me`. Namecheap remains the registrar; Cloudflare may become the authoritative DNS provider.

## Before changing nameservers

1. In Namecheap, inventory every existing DNS record for `mykairos.me`, including A, AAAA, CNAME, MX, TXT, CAA, verification, and email-related records.
2. Record the hostname, record type, target/value, TTL, and whether each record is still required.
3. Recreate all required records in Cloudflare before changing authoritative nameservers.
4. Confirm mail-routing and verification records are preserved if they already exist.
5. Never paste API tokens, OAuth client secrets, encryption keys, passwords, or other secret values into the repository, issue comments, screenshots, or chat. Enter secrets only in the intended provider/deployment secret store.

## Nameserver cutover

1. Add `mykairos.me` to the intended Cloudflare account.
2. Compare Cloudflare's imported records with the pre-change inventory and correct omissions before proceeding.
3. In Namecheap, replace the authoritative nameservers only after the Cloudflare zone is complete.
4. Verify public DNS resolution for the apex domain and any preserved mail/verification records.
5. Attach the Worker custom domain for the apex `mykairos.me` only after the production Worker is ready for acceptance testing.

Do not remove historical DNS records merely because Kairos does not use them. Resolve ownership and purpose first.
