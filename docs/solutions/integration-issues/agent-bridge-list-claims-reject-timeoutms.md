---
title: "list-* claims rejected timeoutMs: every list command with --timeout failed fast with claim_rejected (and JUSO_TIMEOUT silently broke every MCP list tool)"
date: 2026-09-14
last_updated: 2026-09-14
category: integration-issues
module: agent-bridge
problem_type: integration_issue
component: tooling
severity: medium
symptoms:
  - "Python list commands with a budget failed: `--timeout 45 list-sites` returned \"bridge aborted: claim_rejected\", while the same command without --timeout succeeded"
  - "v1 `list-providers --timeout 45` failed identically on the old worker, proving the failure predated the new v2 actions and ruling out the stale-worker-build theory"
  - "With JUSO_TIMEOUT set, every MCP list tool (list-providers / list-instances / list-engines) failed while search tools worked — the env var silently broke all list tools"
  - "Rebuilds and repeated extension reloads changed nothing, initially misdirecting debugging toward a nonexistent stale-build problem"
root_cause: missing_validation
resolution_type: code_fix
tags: [agent-bridge, claim-parser, timeout, contract-drift, juso-skill, mcp, argparse]
related_components:
  - "lib/agent-bridge.ts"
  - "public/agent-skill/scripts/juso_bridge.py"
  - "public/agent-skill/scripts/juso_search.py"
  - "mcp-server/juso_search/server.py"
  - "tests/agent-bridge.test.ts"
---

# list-* claims rejected timeoutMs: every list command with --timeout failed fast with claim_rejected (and JUSO_TIMEOUT silently broke every MCP list tool)

## Problem

`--timeout 45 list-sites` — a headline capability of the new site/aggregate exposure — failed with `bridge aborted: claim_rejected`. So did `list-providers --timeout 45`, a v1 command that had **never** worked with a budget set. The five `list-*` parse branches in `parseSearchRequest` (`lib/agent-bridge.ts`) used `hasOnlyKeys(value, ['action'])`, so the optional transport-level `timeoutMs` field was treated as an unknown payload field and the claim was rejected. Meanwhile the CLI (`--timeout`) and the MCP server (`JUSO_TIMEOUT`) attach `timeoutMs` to **every** claim when a budget is configured — meaning any list command with a budget failed by design, and `JUSO_TIMEOUT` silently broke every MCP list tool. The latent MCP breakage predates this session; the new `list-sites` action merely made it visible.

## Symptoms

- `bridge aborted: claim_rejected` with the "extension claimed the request but did not complete"-style recovery hint: the worker's claim parse failed → `runAgentBridge` returned `{ ok: false }` → `entrypoints/bridge/main.ts` called `abortBridge(credentials, 'claim_rejected')` on the `/v1/abort` back-channel → Python raised `BridgeError(kind='extension_did_not_complete', message='bridge aborted: claim_rejected; <RECOVERY_HINT>')`.
- Only actions carrying a query succeeded — their parse branches already had `timeoutMs` in their allow-lists; the five bare `list-*` branches did not.
- Failure was **instant** — a fast-fail abort within seconds, not a 40s/45s timeout. (A timeout-shaped bug would have waited out the budget; this did not, which was the loudest clue available.)
- On the MCP side: every list tool failed whenever `JUSO_TIMEOUT` was set, because `bridge_call.py` resolves the env var to a clamped `timeout_ms` on every call regardless of action.

## What Didn't Work

The first (wrong) theory was **stale build**: assume the unpacked extension was running an old bundle and the new `list-sites` action simply wasn't there. In order:

- Rebuilt the dev bundle (`npm run build:dev`) — no change.
- Reloaded the extension via `chrome://extensions` repeatedly — mechanical friction: the accessibility-driven reload click only landed when the browser window was focused first (PowerShell `SetForegroundWindow`), which consumed time and reinforced the sense of "doing something".
- Tried disable/re-enable — no change.

All no-ops, because the code was current and the rejection was **by design**: the parser was faithfully rejecting a claim that violated its allow-list. Nothing on the extension side recorded *why* a claim was rejected, so the stale-build theory was unfalsifiable from where we stood — the abort reason is a bare `claim_rejected` string with no parse detail.

## Solution

**The decisive experiment:** run the v1 command `list-providers --timeout 45`. It failed **identically** to the new `list-sites --timeout 45` — so the cause predates the new actions entirely; the new code was innocent and the old list branches were the bug.

The fix, all in the extension worker plus tests and docs:

1. **Relaxed the five `list-*` parse branches** to accept `action` + optional `timeoutMs`, with the same `clampTimeoutMs` validation (integer within `[7000, 300000]`); unknown extra fields are still rejected:

```ts
// Before (list-providers / list-instances / list-engines / list-sites / list-aggregates):
if (!hasOnlyKeys(value, ['action'])) return { ok: false, error: 'invalid list providers request' };

// After:
if (!hasOnlyKeys(value, ['action', 'timeoutMs'])
  || (value.timeoutMs !== undefined && (typeof value.timeoutMs !== 'number' || clampTimeoutMs(value.timeoutMs) === null))) {
  return { ok: false, error: 'invalid list providers request' };
}
return { ok: true, value: { action: 'list-providers', ...(value.timeoutMs === undefined ? {} : { timeoutMs: value.timeoutMs as number }) } };
```

2. **Simplified `claimTimeoutMs`** to read `request.timeoutMs` for all actions, so the end-to-end abort budget arms for list calls too (before, it had to special-case which actions could carry the field):

```ts
// 所有 action（含 list-*，2026-09-14 放宽）的 claim 均接受可选 timeoutMs：CLI --timeout /
// MCP JUSO_TIMEOUT 对任意命令统一生效，list-* 声明不再因携带 timeoutMs 被拒。
function claimTimeoutMs(request: AgentRequest): number | undefined {
  return request.timeoutMs;
}
```

3. **Tests:** flipped the two assertions in `tests/agent-bridge.test.ts` that had locked the old rejection; added a loop test covering all five list actions accepting `timeoutMs: 45_000` while rejecting `6_999` and still rejecting unknown fields (`query`, `extra`). Added a Python lock: `make_claim("list-sites", None, None, False, "id", timeout_ms=45000)` → the emitted claim includes `timeoutMs` (`tests/scripts/test_juso_search.py`).
4. **Docs:** documented the CLI placement rule in `SKILL.md` + `reference/configuration.md` + `reference/aggregate-instances.md` — global argparse options go **before** the subcommand (`--timeout 60 list-sites` works; `list-sites --timeout 60` errors), with `JUSO_TIMEOUT` noted as the placement-free alternative.

## Why This Works

`timeoutMs` is a **transport-level end-to-end budget, not an action-specific search parameter** — the allow-lists were misclassifying it as an unknown payload field. The relaxation is exactly scoped:

- **Backward-compatible in both directions.** Previously-rejected claims now parse; unchanged claims stay byte-identical (`make_claim` omits the field entirely unless the caller set a budget, so no existing claim shape moved).
- **No validation weakened.** The same clamp ([7000, 300000], integers only) applies; the only change is that the field is *recognized* on list actions. Unknown extra fields are still rejected.
- **Fixes the latent MCP breakage for free.** The MCP server resolves `JUSO_TIMEOUT` to a clamped `timeout_ms` on every call (`bridge_call.py`), so once the parse branches accept the field, all five MCP list tools work under a configured budget without any MCP-side change.

## Prevention

- **Decide field scope once, at the protocol level.** When adding a claim field, classify it transport-level (accepted by *every* action's parse branch — budgets, request ids, tracing) or action-specific (search parameters, ids). Transport fields go into every allow-list from day one; "which actions may carry the budget" should never be a per-branch decision.
- **Test claims WITH the transport field on every action family.** The per-action accept tests that existed only covered query-carrying actions with `timeoutMs`; a five-line loop over the list actions (`45_000` accepted, `6_999` rejected, `query`/`extra` rejected) plus the Python `make_claim` lock would have caught this before any release.
- **Give fail-fast classifiers a paper trail.** `claim_rejected` is a great fast-fail signal, but the worker discarded the parse error string. A one-line `console.warn('[agent-bridge] claim rejected:', parseResult.error)` in the handler would have ended the stale-build theory in seconds — misdiagnosis is cheaper when the reject side says why. (Keep the wire contract terse; the log is free.)

## Related Issues

- [Engine-search orchestration errors and Baidu URL extraction](../logic-errors/engine-search-orchestration-errors-and-baidu-url-extraction.md) — its Solution E introduced the `timeoutMs` claim carrier and froze list-* ("list-* stays unchanged"); superseded by this fix on 2026-09-14 (dated note added there). Its Prevention rule ("a client-facing timeout must be plumbed end-to-end or documented as local-only") now holds for **all** actions.
- [Agent Bridge skill contract drift](./agent-bridge-skill-contract-drift.md) — sibling contract-drift failure mode in the same protocol; also the origin of the `/v1/abort` back-channel that makes `claim_rejected` fail in seconds instead of after a 40s hang.
- [MCP provider id optional contract drift](./mcp-provider-id-optional-contract-drift.md) — same class: client surfaces disagreeing with the bridge validator on a parameter contract; its "align parameter contracts, audit agent-bridge.ts as source of truth" prevention applies verbatim to `timeoutMs`.
- [MCP server cancellation robustness hardening](../architecture-patterns/mcp-server-cancellation-robustness-hardening.md) — the `JUSO_TIMEOUT` knob's load-time validation; since this fix the value feeds the end-to-end budget of every command, list-* included.
- The exposure knowledge doc: [Exposing a user-defined source type to the agent side](../architecture-patterns/agent-bridge-source-instance-exposure.md) — the four-action recipe whose new `list-sites` command surfaced this latent v1 defect.
