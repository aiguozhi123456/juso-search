---
title: "Exposing a user-defined source type to the agent side: the end-to-end recipe across worker, Python single source, skill propagation, and MCP server"
date: 2026-09-14
last_updated: 2026-09-14
category: architecture-patterns
module: agent-bridge / juso-skill / mcp-server
problem_type: architecture_pattern
component: background_job
severity: medium
applies_when:
  - "Exposing a user-defined source type (site:<uuid> / agg:<uuid> / future kinds) to the Agent Skill CLI and MCP server"
  - "Adding additive protocol-v2 bridge actions whose request and reply shapes must stay frozen for already-distributed skill copies"
  - "Wiring a worker-constructed search path where the effective query lives in the constructed SERP URL, so the extractor content script needs a derived matchQuery"
  - "Propagating one bridge protocol change through gen_skills.py DEV_PATCH, the packager REFERENCE_FILES, and the MCP vendor copy in a single pass"
  - "Wrapping new bridge actions in the background claim deps for uniform deadline, budget, and sub-switch handling"
root_cause: missing_tooling
resolution_type: tooling_addition
tags: [agent-bridge, site-instances, aggregate-instances, protocol-v2, additive-actions, juso-skill, mcp, match-query]
related_components:
  - "lib/agent-bridge.ts"
  - "lib/gateway.ts"
  - "entrypoints/background.ts"
  - "lib/engine-search.ts"
  - "entrypoints/engine-extractor.content.ts"
  - "public/agent-skill/scripts/juso_bridge.py"
  - "public/agent-skill/scripts/juso_search.py"
  - "scripts/gen_skills.py"
  - "lib/agent-skill-packager.ts"
  - "mcp-server/juso_search/server.py"
---

# Exposing a user-defined source type to the agent side: the end-to-end recipe across worker, Python single source, skill propagation, and MCP server

## Context

Two user-defined source types lived only inside the extension UI: **Site Instances** (`site:<uuid>` — per-site search executed by the fixed backing engine google/bing/baidu with a per-instance construction mode `zhannei` / `q1` / `query`) and **Aggregate Instances** (`agg:<uuid>` — multi-source fan-out merged and reranked by an external rerank service). The Agent Bridge exposed exactly six actions (`search`, `engine-search`, `search-instance`, `list-providers`, `list-instances`, `list-engines`); an agent could not discover or search either user-defined type.

This session added four **additive protocol-v2 actions** — `list-sites`, `search-site`, `list-aggregates`, `search-aggregate` — across every agent-facing surface: the extension worker claim parser, the worker gateway handlers, the Python single-source bridge module (`juso_bridge.py`), the generated CLI (`juso_search.py` + `SKILL.md` + `reference/`), and the MCP pip server (`mcp-server/`). The protocol version stays at 2 (`AGENT_BRIDGE_PROTOCOL = 2`): every change is additive, so already-distributed skills keep validating and keep working.

## Guidance

The N-touch map. Exposing a source type to the agent side is not one change; it is a fixed sequence of touches across four surfaces. Missing any one fails in a distinct, testable way — which is the point of the map.

### 1. Extension worker: claim surface (`lib/agent-bridge.ts`)

- **Request types + parse branches.** One `Agent*Request` type per action, one branch in `parseSearchRequest`. Reuse the existing id-shape guards (`isSiteInstanceId` / `isAggregateInstanceId`) instead of inventing per-action validators — the id grammar is already owned by the instance stores. Every branch is a strict allow-list via `hasOnlyKeys`; optional fields clamp (`maxResults` integer 1–20; `forceRefresh` boolean; `timeoutMs` via `clampTimeoutMs`, integer within `[7000, 300000]`).

```ts
// list action: bare action + optional transport budget; anything else rejected
if (value.action === 'list-sites') {
  if (!hasOnlyKeys(value, ['action', 'timeoutMs']) || (value.timeoutMs !== undefined && (typeof value.timeoutMs !== 'number' || clampTimeoutMs(value.timeoutMs) === null))) return { ok: false, error: 'invalid list sites request' };
  return { ok: true, value: { action: 'list-sites', ...(value.timeoutMs === undefined ? {} : { timeoutMs: value.timeoutMs as number }) } };
}
// execution action: id-shape guard reuses the store's predicate, not a new regex
if (value.action === 'search-site') {
  if (!hasOnlyKeys(value, ['action', 'query', 'siteId', 'maxResults', 'timeoutMs']) || typeof value.query !== 'string') return { ok: false, error: 'invalid site search request' };
  const query = value.query.trim();
  if (!query || query.length > 8192 || typeof value.siteId !== 'string' || !isSiteInstanceId(value.siteId)) return { ok: false, error: 'invalid site search request' };
  ...
}
```

- **Reply types.** Sanitized list entries and the execution envelope join the `AgentComplete['reply']` union so `runAgentBridge` can complete them:

```ts
export type AgentSiteInfo = { id: SiteInstanceId; label: string; engineId: EngineId; target: string; description: string };
export type AgentAggregateInfo = { id: AggregateInstanceId; label: string; eligible: boolean; topN: number; members: AggregateMemberId[] };
export type AgentSiteSearchReply =
  | { ok: true; response: { query: string; engine: EngineId; results: EngineResult[] }; cache: { hit: false } }
  | { ok: false; error: { kind: 'keyMissing' | 'providerError' | 'unknown'; message: string } };
```

- **Deps + dispatch.** Each action gets an **optional** dep in `AgentBridgeDeps`. Execution actions take the `(request, signal, deadline)` triple (`handleSearchSite` — it drives tabs and needs the absolute epoch deadline to narrow the inner budget); reads take `(request)` or `()`. The dispatch chain folds a missing dep into a reply, never a throw:

```ts
: claim.value.request.action === 'list-sites'
  ? (await deps.listSites?.()) ?? { ok: false, error: { kind: 'unknown', message: 'Service unavailable.' } }
```

### 2. Sanitized handlers (`lib/gateway.ts`)

- **Lists carry id/label/status only, never keys** — the BYOK invariant. `handleListAgentSites` maps definitions to `{ id, label, engineId, target, description }` where `target` is the normalized public hostname; `handleListAgentAggregates` returns `{ id, label, eligible, topN, members }` with `eligible` computed through the **same** `resolveAggregateEligibility` context the executor uses, so the list never advertises an instance the executor would refuse.
- **`handleSearchSiteInstance`** resolves the definition → `buildSiteInstanceUrl` → `runEngineSearch` with the pre-constructed `serpUrl` plus `matchQuery` derived worker-side from `matchEngineByUrl(serpUrl)` — the constructed URL itself is the single source of the URL↔request matching text, so prefix-construction modes and the zhannei surface both match without mode-specific branches. Unknown/deleted id and URL-construction failure return the `ok:false` envelope (the `search-instance` precedent); extraction error kinds (`challenge`/`timeout`/…) pass through as `message` with `kind: 'providerError'` (engine-page-side failure, not an id/config problem).
- **`handleSearchAggregate`** performs the data-dependent gate (see §4) and then delegates to the existing `handleAggregateSearch`, inheriting the aggregate cache and hard-error rerank contract for free.
- **Unknown/deleted ids fail as `ok:false` envelopes, never throw** — a throw would escape to the message layer as an unclassified failure; the envelope is what the Python validators know how to accept.

### 3. Wiring (`entrypoints/background.ts`)

All deps inject at the `agentBridgeClaim` handler, after the total switch and the sender check. The two third-party-page paths wrap their gating + deadline narrowing here:

```ts
handleSearchSite: async (request, signal, deadline) => {
  if (!(await getEngineSearchEnabled())) {
    return { ok: false, error: { kind: 'unknown' as const, message: 'engine-search sub-switch is off.' } };
  }
  return handleSearchSiteInstance(request, signal, engineInnerBudgetMs(deadline, Date.now()));
},
```

### 4. Gating is per capability, not per action name

The engine-search sub-switch (`engineSearchEnabled`) is documented as gating "only the engine-search action"; a new action name does not automatically inherit it, and it must not be applied by name-matching. The rule: **any execution path that opens/extracts third-party pages on the agent's behalf inherits the sub-switch; pure configuration reads and provider-API paths stop at the total switch.**

- `search-site` → gated unconditionally (every site search navigates a real SERP); the check lives in the `background.ts` dep wrapper for uniform deadline handling.
- `search-aggregate` → gated **conditionally**, because the trigger is data-dependent: `instance.members ∩ extractorCapableEngineIds()` non-empty means the fan-out will open engine pages, so the sub-switch must be on; a provider-only aggregate stops at the total switch. The check is inline in the gateway handler (it needs the loaded instance), and membership derives from the extractor registry — never a hand-written engine list — so capability retirement and gating stay in lockstep.
- `list-sites` / `list-aggregates` → never sub-switch gated; they are sanitized configuration reads, matching the `list-engines` precedent.

Full rationale and decision record: `docs/solutions/architecture-patterns/agent-aggregate-engine-member-gating.md` (written this session).

### 5. Python single source (`public/agent-skill/scripts/juso_bridge.py`)

- **`make_claim` branch per execution action** (`search-site` → `siteId` + optional `maxResults`; `search-aggregate` → `aggregateId` + optional `forceRefresh`); list actions gain no extra fields; the optional `timeoutMs` emission stays the shared tail block for every action.
- **One strict validator per reply shape**, with **set equality** on keys (`set(site) == {"id", "label", "engineId", "target", "description"}`), the id-prefix shape check (`site["id"].startswith("site:")` / `agg:`), and reuse of the shared helpers — `_is_error_envelope` for the `ok:false` branch and `_is_reply_cache_shape` for the cache object — so the SearchReply-family and the new envelopes cannot drift apart:

```python
def is_site_list_reply(reply: Any) -> bool:
    if not isinstance(reply, dict) or set(reply) != {"sites"} or not isinstance(reply["sites"], list):
        return False
    return all(
        isinstance(site, dict)
        and set(site) == {"id", "label", "engineId", "target", "description"}
        and isinstance(site["id"], str) and site["id"].startswith("site:")
        ...
        for site in reply["sites"]
    )
```

- `is_valid_reply` gains the four `request["action"]` dispatch rows.

### 6. CLI wrapper (`juso_search.py`) and skill docs

Subcommands `list-sites` / `list-aggregates` (no arguments) and `search-site --site-id` / `search-aggregate --aggregate-id`. `SKILL.md` documents the commands and the discovery-first workflow ("call `list-sites` / `list-aggregates` to discover ids"); new `reference/site-instances.md` and `reference/aggregate-instances.md` chapter files cover semantics, gating copy, and timeouts.

### 7. Propagation: generator + packager

- `scripts/gen_skills.py` regenerates `skills/juso-search` (prod), `skills/juso-search-dev` (dev — the `DEV_PATCH_SKILL_MD` / `DEV_PATCH_PY` find/replace pairs produce the prose diffs). **When a patched `SKILL.md` line changes, the matching DEV_PATCH find/replace pair must be updated in the same commit** — the generator hard-errors when a find-string matches ≠ 1 time, which converts forgotten patches into a build break instead of a silent dev-dir drift.
- The MCP vendor copy of `juso_bridge.py` is shared/unpatched and byte-identical to the single source; the drift-lock test (`npm run test:python`) pins all copies byte-equal.
- `lib/agent-skill-packager.ts` `REFERENCE_FILES` must list every new `reference/` file (`'site-instances.md'`, `'aggregate-instances.md'` joined the fixed contract list); the packager test asserts the zip contents, so a missed entry fails the suite.

### 8. MCP server: format-only id guards

One tool per action (`list-sites`, `search-site`, `list-aggregates`, `search-aggregate`). The id-pattern guards are **FORMAT-ONLY** — the extension validates existence at runtime, so the transport must not over-constrain:

```python
_SITE_ID_PATTERN = r"^site:[A-Za-z0-9][A-Za-z0-9_-]{0,127}$"
_AGGREGATE_ID_PATTERN = r"^agg:[A-Za-z0-9][A-Za-z0-9_-]{0,127}$"
```

Never narrow to UUID shape: the id grammar is the extension's decision (`isSiteInstanceId`), and the `inst:` precedent already settled this — format in the schema, membership at runtime (see `provider-instance-multi-config-model.md` and the vocabulary-decoupling doc).

### 9. Runtime discovery, not hardcoded vocabularies

The lists expose ids at runtime; no downstream surface (CLI argparse `choices`, MCP enum, docs prose) hardcodes the set of site/aggregate ids. Tool descriptions say "as returned by list-sites / list-aggregates". Cross-reference: `docs/solutions/architecture-patterns/skill-mcp-vocabulary-decoupling.md`.

### 10. Tests at all three layers + additive-only discipline

- TS: parse branches (accept/reject matrix incl. id-shape and clamp bounds) + dispatch-to-deps in `tests/agent-bridge.test.ts`; handler behavior in the gateway tests.
- Python: validator acceptance/rejection and `make_claim` shape in `tests/scripts/`.
- MCP: tool schema/pattern tests.
- **Additive-only:** published skill copies validate reply shapes with set equality — widening an *existing* action's request or reply breaks every already-distributed skill the moment the extension updates. Ship new action names with their own shapes instead; leave `AGENT_BRIDGE_PROTOCOL` at 2.

## Why This Matters

- The agent side becomes a first-class consumer of user-defined sources: an agent can now discover the user's site/aggregate instances, execute them under the same capability gates the UI implies, and get replies whose shapes it can strictly validate.
- The N-touch map is the safety net for a ~10-file, four-surface, two-language change. Each forgotten touch has a distinct failure signature: a missing DEV_PATCH pair breaks `gen_skills` (find-count ≠ 1), a missing `REFERENCE_FILES` entry breaks the packager test, a missing Python validator turns a valid reply into `invalid_reply`, an over-constrained MCP pattern turns valid ids into schema rejections, and a widened existing action breaks *distributed* skills that no test in this repo can see.
- The sanitization invariant (lists carry id/label/status, never keys) and the envelope-not-throw error discipline keep the bridge consistent with the BYOK and fast-fail contracts the earlier records established.

## When to Apply

- Adding any new user-defined source type (or any new bridge action) to the agent-facing surfaces.
- Adding a `reference/` chapter or a new command family to the Agent Skill.
- Reviewing an exposure PR: walk the map in order — claim parse → reply types → deps/dispatch → gateway handler → gating classification → background wiring → Python validator/claim → CLI/docs → generator patches + packager list → MCP tool → tests at all three layers.

## Examples

The concrete wire shapes an implementer must reproduce on every surface:

```jsonc
// list-sites reply
{ "sites": [ { "id": "site:3f2a…", "label": "吾爱破解", "engineId": "baidu", "target": "www.52pojie.cn", "description": "" } ] }

// search-site reply (SearchReply-style envelope; note response.engine, not response.provider)
{ "ok": true, "response": { "query": "python 逆向", "engine": "baidu", "results": [ { "title": "…", "url": "https://…", "snippet": "…" } ] }, "cache": { "hit": false } }
// failures: unknown/deleted id, sub-switch off, URL construction failure, extraction error kinds
{ "ok": false, "error": { "kind": "unknown", "message": "…" } }

// list-aggregates reply
{ "aggregates": [ { "id": "agg:9c1d…", "label": "AI 动态", "eligible": true, "topN": 20, "members": ["tavily", "inst:exa:abc123", "google"] } ] }

// search-aggregate reply (AggregateSearchReply: instanceId + kind:'aggregate' + per-member statuses)
{ "ok": true, "response": { "instanceId": "agg:9c1d…", "query": "…", "kind": "aggregate", "answers": [], "results": [ { "…": "…", "sources": ["tavily", "google"] } ], "members": [ { "sourceId": "tavily", "ok": true, "resultCount": 10 } ], "dedupedCount": 14, "rerank": { "rerankedAt": 1760000000000 } }, "cache": { "hit": false } }
```

```bash
# CLI: discovery, then execution (global options BEFORE the subcommand)
python scripts/juso_search.py list-sites
python scripts/juso_search.py search-site "python 逆向" --site-id site:3f2a...
python scripts/juso_search.py list-aggregates
python scripts/juso_search.py search-aggregate "AI 动态" --aggregate-id agg:9c1d...
```

## Related

- [Agent bridge site/aggregate actions extend the engine-search gate per capability, not per action name](./agent-aggregate-engine-member-gating.md) — the gating half of this recipe, written the same session; this doc references, not re-derives, the per-capability rule.
- [Runtime discovery for Agent Skill and MCP vocabulary (eliminate provider/engine tuple drift)](./skill-mcp-vocabulary-decoupling.md) — why lists expose ids and no surface hardcodes them; the format-only MCP pattern precedent.
- [Provider instance multi-config model (inst: instances)](./provider-instance-multi-config-model.md) — the inst: exposure this followed as precedent (its Example 3 is the pattern's first application).
- [Agent skill distribution pipeline](./agent-skill-distribution-pipeline.md) — the generator/drift-lock machinery this recipe's propagation step rides on.
- [Agent skill localhost capability bridge](./agent-skill-localhost-capability-bridge.md) — the bridge protocol umbrella (claim/complete/abort, fragment format, two-layer opt-in) these four actions extend.
- [Instantiated aggregate search architecture](./instantiated-aggregate-search-architecture.md) — the `agg:` entity `search-aggregate` executes and `list-aggregates` projects.
- [Site instance construction modes and the zhannei surface](./site-instance-construction-modes-and-zhannei-surface.md) — the `site:` entity and why `matchQuery` must come from the constructed SERP URL.
- [list-* claims rejected timeoutMs](../integration-issues/agent-bridge-list-claims-reject-timeoutms.md) — the transport-field lesson learned while shipping these actions.
- `CONCEPTS.md` — Site Instance and Aggregate Instance entries (both gained their agent-exposure paragraphs this session).
