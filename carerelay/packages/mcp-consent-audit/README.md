# MCP Consent Audit

Dependency-free safety primitives for MCP tools that perform consequential actions.

It provides:

- Explicit, actor-bound confirmation
- Payload binding to prevent approval substitution
- Single-use and expiring consent
- Structured provenance
- Tamper-evident append-only audit chains

The package is deliberately domain-neutral. CareRelay uses it for caregiver task assignments, but it can protect purchasing, scheduling, messaging, or administrative MCP tools.

```js
import { ConsentLedger } from "./src/index.js";
const ledger = new ConsentLedger();
const payload = { taskId: "task-1", owner: "Meera" };
const pending = ledger.request({ action: "assign", actor: "Priya", subject: "task-1", payload });
ledger.confirm({ consentId: pending.consentId, actor: "Priya", payload, confirmed: true });
```

No network calls, telemetry, accounts, or external dependencies are required.

## Run tests

Use Node.js 22+: `node --test test/*.test.js`. No installation is required.

## Boundaries

The caller supplies actor identity; authenticate it in the integrating application. This library does not authenticate users, send messages or execute external actions. The unkeyed audit chain detects inconsistent edits, not an attacker who can rewrite the whole chain. It is a tested prototype, not a security certification. MIT license.
