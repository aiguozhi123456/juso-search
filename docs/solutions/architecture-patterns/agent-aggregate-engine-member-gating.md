---
title: "Agent bridge site/aggregate actions extend the engine-search gate per capability, not per action name"
date: 2026-09-13
last_updated: 2026-09-13
category: architecture-patterns
module: Agent bridge v2 (search-site / search-aggregate exposure)
problem_type: architecture_pattern
component: background_job
severity: medium
applies_when:
  - "Adding an agent-bridge action that only sometimes opens third-party pages (conditional gating)"
  - "Deciding whether a new bridge action needs the engine-search sub-switch or only the total switch"
  - "Exposing a new user-defined source type (site/aggregate/…) to the Agent Skill and MCP server"
  - "Reviewing why search-site is gated but a provider-only search-aggregate is not"
tags: [agent-bridge, engine-search, gating, cws-compliance, aggregate-search, site-instances, additive-actions, ktd15]
related_components:
  - lib/agent-bridge.ts
  - lib/gateway.ts
  - entrypoints/background.ts
  - lib/aggregate/eligibility.ts
  - docs/solutions/architecture-patterns/engine-extraction-for-user-initiated-aggregate.md
---

# Agent bridge site/aggregate actions extend the engine-search gate per capability, not per action name

## Context

The agent bridge exposed six actions (search, engine-search, search-instance, list-providers, list-instances, list-engines). Two user-defined source types were still invisible to agents: **site instances** (`site:<uuid>` — a per-site search executed by navigating the backing engine's scoped SERP and extracting results, i.e. the same third-party-page pipeline as `engine-search`) and **aggregate instances** (`agg:<uuid>` — a fan-out over member sources where *engine members* open third-party pages but *provider members* are plain BYOK API calls).

The 2026-09-09 aggregate plan deferred the bridge surface as "后续 additive v2". Exposing both types meant answering one question the existing records did not: the engine-search sub-switch (`engineSearchEnabled`) is documented as gating "only the engine-search action" — does a *new* action name inherit that gate?

## Decision

**Gate by capability (does this execution open third-party pages on the agent's behalf?), not by action name.** Concretely:

1. **`search-site` is gated unconditionally.** Every site-instance search navigates a real engine SERP in a temporary tab. Same risk profile as `engine-search`; the sub-switch off state folds into the reply envelope (`ok:false`, kind `unknown`), mirroring how the gate folds `engine-search` into `extract-failed`.
2. **`search-aggregate` is gated conditionally.** Before delegating to `handleAggregateSearch`, the worker checks `instance.members ∩ extractorCapableEngineIds()`. Empty intersection (pure provider/instance members) → the total bridge switch is the only gate, because nothing touches a third-party page. Non-empty → `engineSearchEnabled` must be on, else the search fails with a dedicated message (`error_agent_engine_search_disabled`) before any fan-out.
3. **`list-sites` / `list-aggregates` are never sub-switch gated** — they are configuration reads (id/label/status, BYOK-sanitized), matching the precedent that `list-engines` discovery is ungated.

The conditional check reuses `extractorCapableEngineIds()` — the single derivation from the extractor registry shared with eligibility and the UI fan-out check (`engine-capability-is-per-registry-not-per-id-union.md`) — so a member whose extractor is retired stops triggering the gate at the same moment it stops opening pages.

This refines, not contradicts, the two earlier records:

- `engine-extraction-for-user-initiated-aggregate.md` exempts the *user-visible aggregate UI* from the gate because the user clicks the search button. An agent-invoked aggregate is **not** user-initiated at invocation time, so the exemption's property ("human in the loop") does not hold there — hence the gate returns for the agent path, but only when engine members exist.
- `default-off-capability-gating-for-cws-compliance.md` requires default-off for programmatic paths; the total switch already covers all four new actions, and the sub-switch now covers exactly the two execution paths that load third-party pages.

## Where each piece lives

- Gate wrappers: `entrypoints/background.ts` `agentBridgeClaim` deps — `handleSearchSite` mirrors `handleEngineSearch` (sub-switch check + `engineInnerBudgetMs` pass-through).
- Conditional gate: `lib/gateway.ts` `handleSearchAggregate` (members ∩ extractor-capable check before delegating to `handleAggregateSearch`), with a comment pointing here.
- Disabled-copy i18n key: `error_agent_engine_search_disabled` in `lib/i18n.ts` + `_locales/{zh_CN,en}/messages.json`.

## Guidance

- When adding a bridge action, classify its **execution paths**, not its name: any path that opens/extracts third-party pages inherits the `engineSearchEnabled` check (in the `background.ts` dep wrapper for uniform deadline handling, or inline when the condition is data-dependent, as here); pure configuration reads and provider-API paths stop at the total switch.
- Keep new bridge surface **additive**: new action names with their own reply shapes and Python/MCP validators, never widening an existing action's request or reply (the published skill copies validate reply shapes strictly; widening breaks already-distributed skills).
- Derive "needs the gate" for aggregate-like data-dependent cases from the extractor registry, never from a hand-written engine list, so capability retirement and gating stay in lockstep.
