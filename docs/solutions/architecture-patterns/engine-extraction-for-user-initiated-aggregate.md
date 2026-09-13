---
title: "Aggregate engine members run without the agent-only engineSearchEnabled gate (user opt-in via Options checkbox)"
date: 2026-09-12
last_updated: 2026-09-13
category: architecture-patterns
module: Aggregate search / gateway engine-member fan-out
problem_type: architecture_pattern
component: background_job
severity: medium
applies_when:
  - "Deciding whether a new aggregate member type that opens background tabs must respect engineSearchEnabled"
  - "Wiring runEngineSearch into a new worker fan-out path outside the agent bridge"
  - "Reviewing whether an engine-driving capability needs a default-off switch for CWS compliance"
  - "Auditing where the three KTD15 landing conditions (decision record, code comment, warning copy) live"
tags: [aggregate-search, engine-search, gating, cws-compliance, opt-in, user-consent, engine-extraction, ktd15]
related_components:
  - lib/gateway.ts
  - lib/aggregate/eligibility.ts
  - components/AggregateSearchManager.tsx
  - lib/i18n.ts
  - public/_locales/zh_CN/messages.json
  - public/_locales/en/messages.json
---

# Aggregate engine members run without the agent-only engineSearchEnabled gate (user opt-in via Options checkbox)

## Context

The aggregate-search feature (plan `docs/plans/2026-09-09-001-aggregate-search-rerank-plan.md`, R9/KTD3/KTD15) lets a user compose an aggregate search instance whose members may include conventional search engines. When the instance is searched, each engine member is executed by the worker via `runEngineSearch` — the same temporary-background-tab + content-script extraction pipeline the Agent Bridge uses — under a ≤3 concurrency semaphore. Engine results are never cached (live extraction every time).

The extension already ships a default-off gate for engine extraction: `engineSearchEnabled` (plus the total `agentBridgeEnabled` switch) gates the bridge's `engine-search` action. The question KTD15 had to answer: does the aggregate engine-member path need to respect that gate too?

## Decision

**No — aggregate engine members do NOT go through `engineSearchEnabled`.** The gate stays scoped to the agent bridge, and the aggregate path relies on explicit user opt-in instead. Two independent sources ground this:

1. **The gate's own semantics are agent-shaped, not capability-shaped.** `CONCEPTS.md` (line 126) defines the gating rationale: *"The bridge ships disabled by default behind a two-layer opt-in: a total switch gates the entire bridge, and a separate sub-switch gates only the engine-search action, which can drive the browser to load third-party search-engine pages and extract their public results. A capability that silently loads third-party pages **on an external process's behalf** must be opt-in, not default-on."* The risk being managed is a third party (local agent, native host, loopback bridge) causing the browser to load pages without a human in the loop.

2. **The default-off policy explicitly exempts user-initiated visible UI.** `default-off-capability-gating-for-cws-compliance.md` line 83: *"This does **not** apply to capabilities the user invokes directly through visible UI (toolbar click, SERP switch bar) — those are already user-initiated and visible, which is the property the gate restores for the programmatic path."* Checking an engine in the Options aggregate editor is exactly such a user-initiated, visible act — a **persistent, explicit opt-in** to the extraction behavior, made *before* any search runs, with a warning shown at the point of consent.

Reusing the agent gate for the aggregate path would also be wrong for independence reasons: the aggregate feature is reachable only through visible extension UI, has no external-process entry point, and its execution is always preceded by the user's own configuration action. Gating it behind `engineSearchEnabled` would (a) couple two unrelated features' switches (an agent-bridge off state would silently break a user-facing aggregate member), and (b) re-run the asymmetry the default-off doc warns about, in reverse: a UI capability gated as if it were a programmatic one.

## The three landing conditions (KTD15) and where each lives

1. **Decision record** — this document.
2. **Code comment pointing here** — `lib/gateway.ts`, the comment block directly above `runEngineAggregateMember` (the aggregate engine-member dispatch; KTD15②), plus the derivation comments in `lib/aggregate/eligibility.ts` (`extractorCapableEngineIds`, the single source of truth for which engines are aggregate-member candidates, shared by the Options checklist and the gateway fan-out check — R9).
3. **Options warning copy (KTD15③)** — i18n key `opts_aggregate_engine_warning`:
   - `lib/i18n.ts` `MSG.opts_aggregate_engine_warning` (line 568),
   - `public/_locales/zh_CN/messages.json` line 406 and `public/_locales/en/messages.json` line 406,
   - rendered at the head of the engine section in `components/AggregateSearchManager.tsx` (line 559): 勾选的引擎将在搜索时以后台标签页加载其搜索页并提取结果，可能被反爬拦截。

## Guidance

- When adding a **new** capability that opens background tabs: classify it first as *programmatic/agent-driven* (default-off gate required, follow `default-off-capability-gating-for-cws-compliance.md`) or *user-initiated via visible UI* (no agent gate; consent = the user's explicit configuration/invocation, ideally accompanied by a warning at the consent point, as done here).
- Do not widen `engineSearchEnabled`'s readers beyond the agent bridge's `engine-search` action (`entrypoints/background.ts` `handleEngineSearch`). New `runEngineSearch` call sites must state which side of the line they are on, with a comment pointing at a decision record.
- Engine membership eligibility derives from the extractor registry (see `engine-capability-is-per-registry-not-per-id-union.md`), never from the `EngineId` union — the aggregate path uses `extractorCapableEngineIds()` as its single derivation, both for the Options checklist and the fan-out check (registry drift → that member fails individually, the aggregate search itself does not throw).

## Why This Matters

- Keeps the agent gate meaningful: its off state blocks exactly the external-process path it was designed for, and nothing else. Silent re-use for UI paths would make `engineSearchEnabled` a hidden cross-feature kill switch.
- Keeps the aggregate feature honest for store review: the capability ("may load search pages in background tabs") is disclosed at the moment of consent (warning copy) and the behavior is user-scoped — the same property the default-off policy restores for programmatic paths.
- Gives the next engine-driving feature a reusable classification test: *who pulled the trigger, and could they see it?* An external process → gate. A visible user action → consent + warning.

## Examples

- **Gate applies (programmatic):** local agent calls bridge `engine-search` → `background.ts` checks `getEngineSearchEnabled()` (after the total `agentBridgeEnabled` switch) and returns `extract-failed` when off.
- **Gate does not apply (user-initiated):** user checks `google` as an aggregate member in Options (warning shown) → searches the instance → worker fans out `runEngineSearch('google')` under the ≤3 semaphore regardless of either bridge switch.

## Related

- [Default-off capability gating for Agent Bridge and engine-search (CWS compliance)](./default-off-capability-gating-for-cws-compliance.md) — the policy this decision carves the UI exemption from (its line 83)
- [Engine capability is layered per registry, but the shared EngineId union hides the layers](./engine-capability-is-per-registry-not-per-id-union.md) — why membership derives from the extractor registry, not the id union
- [Engine-search orchestration errors and Baidu URL extraction](../logic-errors/engine-search-orchestration-errors-and-baidu-url-extraction.md) — error taxonomy the aggregate member status preserves (page-state vs orchestration, not collapsed)
- Plan: `docs/plans/2026-09-09-001-aggregate-search-rerank-plan.md` (R9, KTD3, KTD15)
- [Instantiated aggregate search architecture](./instantiated-aggregate-search-architecture.md) — the overall architecture this gating decision lives inside (parent doc; written 2026-09-13)
