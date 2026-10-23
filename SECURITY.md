# Security and release audit

Use fictitious household data. This prototype is non-medical and is not a clinical or authenticated multi-user service.

- Normal launcher binds 127.0.0.1, validates Host/Origin, uses same-origin CSP and does not proxy upstream MCP. Startup clears legacy upstream/live configuration.
- Fresh release defaults to Offline demo. No startup credential export or AWS request. Each live request requires an active new allowance plus a single-use actor/message-bound ticket and explicit approval. No automatic retry.
- Request IDs prevent duplicate dispatch; the journal is durable before sending. Cancelled, expired, altered and consumed tickets cannot dispatch. Old conversation-policy allowances are locked on upgrade.
- Temporary SSO credentials remain server-side memory, never localStorage or browser responses. No permanent keys are created or bundled.
- Exact message evidence is validated separately from caller metadata and interpretation. Consent binds proposal version and payload. Edits/stale targets require fresh confirmation.
- Sources, tasks and chat turns have audit integrity checks. This detects accidental/partial tampering; an attacker with write access to the entire household file can rewrite an unkeyed hash chain. It is not cryptographic protection against the machine owner.
- Browser workspace capabilities restrict private chat resumption and drafts. Confirmed household state and its necessary provenance are deliberately shared. There is no real caregiver authentication or tenant isolation.
- Runtime records, spending journals and AI diagnostics contain household text; they stay outside the public package and must not be committed. Data is not encrypted at rest by the app.
- Build hashes detect incomplete/mismatched extraction, not malicious release replacement or a trusted digital signature.

The final automated audit checks embedded AWS access-key patterns, private-key blocks, secret-bearing environment/config files, personal filesystem paths, runtime state and obsolete live launchers. Results are in `release-evidence/secrets-audit.json`. Fixture request/response data uses the existing synthetic caregiver scenarios; three original model captures plus a regression capture are retained because they are needed for reproducible provenance/safety tests. No AWS credentials are required to replay them.

MIT license is present at repository root and in the reusable package. Runtime uses Node built-ins; Node itself is separately installed and not redistributed. No third-party model weights are included. MIT covers CareRelay code, not model/API service terms. Live model use requires the owner's existing entitlement and terms.
