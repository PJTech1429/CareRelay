# CareRelay

**Care that survives the handoff.**

CareRelay closes the accountability gap between caregivers without silently acting on anyone’s behalf. A natural-language update becomes an evidence-backed draft. The caregiver reviews, clarifies or edits it, then explicitly confirms responsibility. Another caregiver receives the persisted handoff in a separate session.

This is an Alexa+-style **web simulation**, backed by a self-hosted MCP 2025-11-25 server. It is not an official Alexa interface and has no private Alexa integration. Non-medical household coordination only.

## Start on Windows

1. Extract the **entire** ZIP into a new folder. Do not run inside the ZIP or overlay an older release.
2. Have Node.js **22 or newer** available. No npm installation is needed. If your global Node is older, extract the official Windows portable Node ZIP from https://nodejs.org/en/download into `carerelay/.tools/node22/`, so that `node.exe` is directly inside that directory. This does not change global Node/npm. The launcher also recognizes a portable Node in a sibling `.tools/node22` folder or an existing CareRelay folder under Downloads or at a drive root.
3. Double-click **START-CARERELAY.cmd**. Keep its window open. Chrome/Edge opens the exact verified local address automatically. If browser opening is disabled, copy `OPEN THIS ADDRESS` from the window.
4. Enter a fictitious name and shift. The default **Offline demo · no AI** works without AWS, subscriptions, keys or private configuration.
5. Stop with **STOP-CARERELAY.cmd** or Ctrl+C in the startup window.

No runtime dependencies, cloud resources, telemetry, external fonts or remote assets are downloaded by the app. Node itself is not bundled. The Windows PowerShell launcher runs with a process-only execution-policy override; it does not change your system execution policy or install software.

## Judge test: about two minutes, no AWS

- Start a conversation as **Alex**, shift **Morning**.
- Send: `Someone needs to collect the library books.`
- See the owner gap. There must be no confirmed task yet.
- Reply: `I will collect the library books.`
- Optionally choose **Edit details**, set When to `tomorrow at 5 PM`, and save for confirmation. This is an explicitly labelled human correction, not model evidence.
- Choose **Confirm responsibility**. The relay closes and the responsibility appears on the right.
- Open **Why this?** to inspect the original quotations and any human review.
- Click the caregiver name at the top. Start **Jordan / Evening** as a new conversation.
- Send: `What changed?` The response comes from the confirmed application state. Alex’s private chat and drafts are not copied into Jordan’s conversation.
- Open **Handoff** or **History & evidence** from the menu. Stop/restart: confirmed state persists. Use the caregiver switcher’s recent conversation buttons to resume Alex.

The default demo uses bounded English grammar, **not a model**, and supports different simple action phrases. It is a workflow test, not proof of general natural-language understanding. Unfamiliar wording may require review or manual structured entry. No fake live inference is displayed.

## Three distinct interpretation paths

| Path | What it actually does | AWS usage |
| --- | --- | --- |
| Default Offline demo | Bounded grammatical simulation; manual edits and structured entry remain available | None |
| Saved response demonstration, in Settings | Replays three preserved genuine Kimi update responses for their exact original messages and speakers | None; not fresh inference |
| Live AI, explicitly selected in Settings | Sends new text and relevant application context to genuine Bedrock Kimi K3, then validates the resulting proposal | Optional, potentially billable; disabled without a new allowance and per-request approval |

All paths use the same consent, evidence, audit and persisted responsibility model. A reported commitment is still a draft until confirmation. A confirmed assignment records the reviewing caregiver’s decision; it does not contact or obtain acceptance from the named person.

## Optional genuine Kimi integration

**No new live inference is authorized by this release or its test procedure.** The six historical experiment slots are exhausted. Judges need not enable this path.

For an owner who separately authorizes further use: install AWS CLI v2 and configure an existing IAM Identity Center/SSO profile named `care-relay` in `us-east-1`, with existing Kimi entitlement and permission for the documented Bedrock runtime API. Refresh an existing session with `aws sso login --profile care-relay` when needed. CareRelay never creates permanent keys, accepts subscriptions or changes AWS accounts.

In Settings, establish a **new** 24-hour allowance only after verifying current model access, regional pricing and personal financial authorization; select Live AI. Every send then opens **AWS AI Request — Approval Required**. Cancel prevents dispatch. Approve authorizes one attempt only. No startup, navigation, refresh, typing or background action invokes inference. Old enable-once allowances are locked on upgrade.

Server-side actor/message-bound, expiring, single-use tickets enforce request approval; the durable spending journal reserves usage before dispatch. Duplicate request IDs/tickets cannot cause a second dispatch. One attempt reserves $0.0594 against an application estimate allowance of at most $1 and 1–10 calls. These are **application estimates, not AWS billing caps**. Pricing assumptions in code are historical and were not reverified through AWS during this offline release phase. Credits, taxes and final charges are not verified by the app. Unknown token costs remain visibly unmetered; failed dispatched attempts remain counted. Never delete the journal to reset usage.

Model: `us.moonshotai.kimi-k3`; Bedrock Runtime Chat Completions; `reasoning_effort: "low"`; at most 1,600 completion tokens; no automatic retries. Temporary credentials are exported by AWS CLI into server memory, signed there, and never sent to the browser.

## Tests and other operating systems

Windows: double-click **TEST-CARERELAY.cmd**. It runs the current offline application suite; it does not ask for AWS credentials or invoke inference. For Linux/macOS with Node 22+, from `carerelay/` run `npm test` and `npm start`; open the printed URL. No `npm install` is required.

See [release evidence](release-evidence/VALIDATION.md), [architecture](docs/ARCHITECTURE.md), [security](SECURITY.md), [limitations](docs/LIMITATIONS.md), [walkthrough](docs/WALKTHROUGH.md) and [Track B recording/disclosures](docs/TRACK-B.md).

## Persistence and privacy

The Windows launcher preserves data under `%LOCALAPPDATA%\CareRelay-RC2` for compatibility with existing installations. The historical folder name is not the release identity. A new machine starts empty; no personal state is shipped. CLI startup uses `carerelay/data/` unless `CARERELAY_DYNAMIC_DATA` is set. Do not share these runtime folders or spending journals.

CareRelay is a single-machine, single-household prototype. Browser workspace capabilities isolate private conversations; **confirmed household records are intentionally shared**. Caregiver names are not authenticated identities. Do not use this prototype for real medical, sensitive or multi-tenant operations. Back up your local data securely before moving machines or changing versions.

## Troubleshooting

- **Node 14 found:** keep it for your other project. Put portable Node 22+ at the path above; start using the CMD launcher.
- **Blank/old page:** stop the app, extract to a fresh folder, launch from that folder, use the printed verified URL. Build hashes prevent opening mismatched assets.
- **Port occupied:** the launcher selects a free port without stopping unrelated applications. It remembers the port for normal restarts. A changed origin cannot access the previous browser’s workspace capability; confirmed household records remain persisted.
- **Data already open:** stop the previous CareRelay instance. Do not delete its process lock while it is running.
- **Offline wording not interpreted:** this mode is bounded grammar. Use the exact judge test, Edit details, or Settings → Add an entry without AI. It is never silently upgraded to a paid request.
- **AWS unavailable/error:** no retry is made. Confirmed records remain intact; choose Offline demo. A dispatched failed request may still cost money.
- **Persistent Windows file lock:** close software locking the data folder and restart. Bounded file-rename retries preserve the old committed file; model requests are never retried.

MIT licensed. Built with AI assistance; see Track B disclosures. Repository publication and competition submission have not occurred as part of this package preparation.
