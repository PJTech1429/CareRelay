# Verification limits

- **Offline end-to-end verified:** current application tests exercise proposed interpretation, clarification, editing, refusal, consent invalidation, confirmation, persistence/restart, scoped sessions, audit/provenance and state-grounded questions. Genuine saved Kimi S1/S2/final-S3 responses are replayed; authored stubs are labelled separately.
- **Native browser verified:** cloud Chrome against the final browser assets with Offline demo and an isolated offline transport stub. This is not a native Windows browser certification. Windows launcher behavior is covered by process tests and simulated Windows file-lock tests on Linux; .cmd/.ps1 execution on Windows was not performed in this environment.
- **Fresh live AI verified:** historical final S3 only, with low reasoning. It produced a semantically validated genuine response (479 completion tokens). This is prior evidence, not a fresh test of the latest UI.
- **Not yet verified:** general Kimi reliability, fresh live clarification/correction and complete live latest-UI handoff; native Windows execution of this final archive. No additional AWS calls were made during release preparation.

Default demo is bounded English grammar, not general AI. Saved replay accepts exact original messages/speakers, not arbitrary new interpretation. Live AI can interpret unseen text but remains subject to model error and strict validation; no general accuracy claim is made. Date/time strings are reported context, not timezone-aware scheduling or notifications. No physical task completion is independently verified.

The prototype shares one household's confirmed records; caregiver names are not authentication. Session resumption depends on browser localStorage and a stable local origin. Persistent audit records are local, unencrypted and hash-linked, not backed by an externally trusted ledger. Regex medical guardrails are limited and do not constitute clinical safety assurance.

Pricing is an estimate based on historical configured rates. No automatic credit-balance check, tax guarantee or hard AWS invoice cap is provided. All historical experimental inference allowance is exhausted; the release starts with no new allowance.
