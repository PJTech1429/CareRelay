# Final release validation — October 22, 2026

## Results

- Original immutable competition-candidate ZIP restored and original suite rerun: **557/557 passed**. Its historical source/evidence remain preserved separately; this is a baseline result, not the count of tests shipped in the cleaned source.
- Clean ZIP extracted into a new directory: **160/160 current application and reusable-package tests passed**, zero failures/skips. Full TAP: `current-extracted-160.tap`. Node 24.19.0 on Linux; supported runtime minimum Node 22.
- Current test areas: consent and stale payload/version invalidation; clarification/correction/refusal/dismissal/confirmation; canonical task timing and immutable history; evidence/person/offer/completion/shift validation; genuine saved S1/S2/S3 replay; source and chat integrity; workspace privacy/resumption; HTTP/MCP; one-attempt spending approval/cancellation/content binding/duplicates/exhaustion; timeout/invalid output; process ownership, occupied ports, exact asset verification, restart/stop; simulated Windows file locks; accessibility contracts.
- Native Chrome: observed current browser workflow in default bounded-grammar demo and with a **non-network offline transport stub**. Screenshot evidence and 20 observations are in `browser-review.json`. Browser viewport 1363×936, composer visible, no horizontal overflow. No mobile viewport certification.
- **Zero AWS inference, account, subscription, infrastructure or deployment calls** made for this release phase. No publication.

## Evaluation integrity and cleanup

The full historical suite was also tried against the changed source before cleanup: 542/559 passed. Fourteen failures were obsolete experiment manifest/freeze checks expecting older exact source bytes; three were UI/startup text assertions for the old build name/enable-once design. Those are not concealed model accuracy passes. Historical freeze expectations were not edited. The immutable original suite passed on its own baseline. Current UI text/control tests explicitly reflect the authorized restoration of per-request confirmation. Current contract/security expectations were not weakened.

The public package removes old inference/deployment launchers, plans, live-runner reports, legacy browser screens, unused source modules, prior private data and diagnostics. It retains only current application tests and minimal unchanged genuine synthetic-household capture fixtures needed for correctness/provenance regression. The selected fixture hashes are in `preserved-fixture-sha256.json`. Test-only supporting modules keep their existing paths; they are not exposed as new live experiment launchers.

The browser QA preview originally placed runtime data within the source-sync directory. Sync/restart interference reset a test draft. QA state was isolated outside that tree and dismissal/confirmation/session flows were rerun successfully. Normal Windows data already lives outside the source folder. No persistence safety rule was changed.

## Reproduce

Windows: `TEST-CARERELAY.cmd`.

From `carerelay/`, Node 22+: `npm test` (current suite; only local fixtures).

The release was tested after ZIP extraction, not solely in the development tree. A final inventory proves shipped runtime/browser hashes match the extracted tested application. Build hashes protect against incomplete extraction; they are not a publisher signature.

## Honest status

| Status | Result |
| --- | --- |
| Offline end-to-end verified | PASS |
| Native browser verified | PASS — cloud Chrome, demo/stub only |
| Historical genuine live Kimi | Final S3 passed previously; original capture preserved |
| Fresh latest-UI live AI | NOT VERIFIED; no new calls authorized |
| Native Windows execution of final release | NOT VERIFIED here; launcher/process and simulated Windows-lock tests passed on Linux |
| General live clarification/correction reliability | NOT VERIFIED |
| Public publication/submission | Not performed; separate approval required |

READY for local judge evaluation and Track B/repository publication review, subject to those explicit live/Windows limits. No claim of production readiness or fully live-validated performance.
