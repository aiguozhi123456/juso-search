---
title: "Site Engine as third Search Source with safe persistence invariants"
date: 2026-07-26
last_updated: 2026-08-14
category: architecture-patterns
module: "site-engines / sources / storage / serp"
problem_type: architecture_pattern
component: tooling
severity: high
applies_when:
  - "Adding or changing a Search Source kind that persists user-defined definitions"
  - "Implementing normalize/read-write paths for chrome.storage-backed lists with size budgets"
  - "Wiring SERP or handoff navigation that depends on a source id written just before navigate"
  - "Importing settings schemas that must not wipe local-only collections (e.g. site engines on v3 import)"
related_components: [lib/site-engines.ts, lib/sources.ts, lib/storage/, lib/schema.ts, lib/serp-handoff.ts, lib/config-io.ts, components/SiteEngineManager.tsx]
tags:
  - site-engine
  - search-source
  - chrome-storage
  - normalize
  - all-or-nothing
  - post-write-re-resolve
  - serp
  - schema-v4
---

# Site Engine as third Search Source with safe persistence invariants

## Context

Juso (Chrome MV3, WXT + React + TypeScript) needed a third Search Source class: **Site Engine** — user-defined scopes that search a chosen public site via `site:` operators on a fixed underlying web engine (Google, Bing, or Baidu). This is not a new AI/provider adapter; it reuses classic SERP engines with scope constraints, appears alongside existing sources on the search page and SERP switch bar, and uses dynamic source ids of the form `site:<uuid>`.

Product constraints that shaped the architecture:

- Users may save **multiple** Site Engines.
- Each engine’s underlying web engine is chosen **at create time** and fixed thereafter.
- Search is always `site:` scoping on that underlying engine, with engine-specific path depth rules:
  - **Google**: host + path (path kept in scope); `site:` value is host+path **without** the `https://` scheme.
  - **Bing**: at most two path segments.
  - **Baidu**: hostname only.
- Scope targets must be **public FQDNs** only; private, local, and IP targets are rejected. Trailing dots on FQDNs are stripped before validation/storage.
- Config schema **v4** stores `siteEngines`. Importing **v3** config must **not** wipe local Site Engines already in `chrome.storage.local`.
- Surface: search page + SERP switch bar; active source can be a dynamic `site:<uuid>`.

Two post-implementation defects (P0 collection wipe, P1 SERP stale navigate) are part of the durable pattern: trusted local storage normalization must never empty-on-oversize, and post-write source switches must re-resolve after write—never navigate with a pre-write URL.

Key modules: `lib/site-engines.ts`, `lib/sources.ts`, `lib/storage/`, `lib/schema.ts`, `lib/config-io.ts`, `lib/serp-handoff.ts`, `entrypoints/search/App.tsx`, `entrypoints/serp-bar.content.ts`, `components/SiteEngineManager.tsx`.

Verification after fixes: typecheck, lint, full test suite, and build passed; residual review: no actionable findings.

## Guidance

### 1. Model Site Engines as first-class Search Sources with dynamic ids

Treat each saved Site Engine as a Search Source entry resolved at runtime:

- Stable dynamic id: `site:<uuid>`.
- Definition holds: display name, fixed underlying engine (`google` | `bing` | `baidu`), normalized public FQDN scope (host ± path per engine rules), and create-time metadata as needed by schema v4.
- Registry/list builders in `lib/sources.ts` merge static sources with `siteEngines` from storage so search UI and SERP bar share one resolution path.
- Prefer resolve-by-id helpers over ad-hoc string parsing in UI entrypoints.

### 2. Scope and validation rules (create-time, engine-fixed)

- Choose underlying engine once at create; do not allow “switch engine, keep same id” without a deliberate migration story.
- Normalize FQDN: strip trailing dots; reject private/local/IP.
- Build `site:` query payloads per engine:
  - Google: `host + path` **without** scheme (`example.com/docs`, not `https://example.com/docs`).
  - Bing: host + ≤ two path segments.
  - Baidu: hostname only.
- Keep validation and URL construction in `lib/site-engines.ts` (or co-located pure helpers) so search page, SERP bar, and manager UI cannot drift.

### 3. Storage and schema: trust boundary for collections

Schema v4 adds `siteEngines`. Critical storage rule:

| Path | Behavior |
|------|----------|
| **Trusted local reads** (`chrome.storage.local` already owned by this extension) | Normalize **item-by-item**. Never return `[]` solely because length > MAX or serialized size > budget. Oversize collections stay partially usable; corrupt items drop individually. |
| **Untrusted import** (config file / foreign payload) | Use a bound check such as `isBoundedSiteEngineCollection`. Reject or refuse merge when over budget. |
| **Mutations** (create / update / delete) | Build `next`, then reject write if `siteEnginesSerializedBytes(next)` exceeds the budget. Do not “normalize down to empty” after a successful user edit. |
| **v3 → v4 import** | Must **not** wipe existing local `siteEngines`. Merge/import paths preserve local Site Engines when the import blob has no (or empty) site-engine field. |

### 4. Post-write navigation and active source (search + SERP)

Search page already used a safe sequence: write → re-read config → re-resolve source → navigate. SERP switch bar must **mirror** that pattern.

Shared helper pattern (`decidePostWriteSiteEngineNavigation`):

1. Persist active source / definition change.
2. Re-read config from storage.
3. Re-resolve the selected Site Engine id against the post-write collection.
4. If the engine was **deleted** or unresolved after write → call `onUnresolvedSiteEngine` (or equivalent) and **do not navigate**.
5. If resolved → navigate with the **post-write** URL.

Also apply:

- Race guards: `switchReqIdRef` / SERP `selectGen` so stale async completions do not overwrite newer selections.
- Always `setActiveSource` **before** navigate when navigation is approved.
- Deleting the active Site Engine falls back to a safe default source (not a dangling `site:<uuid>`).

### 5. UI surfaces

- **Search page** + **SERP switch bar**: both list Site Engines as switchable sources.
- **SiteEngineManager**: CRUD only; does not invent a second id scheme or a second scope normalizer.

## Why This Matters

- **Data loss (P0)**: empty-on-oversize normalization on trusted reads turns every create/update/delete into a silent wipe of the real `siteEngines` array in `chrome.storage.local`. Users lose all Site Engines with no API error.
- **Wrong SERP (P1)**: navigating with a pre-write resolved URL after setActiveSource races delete/update and lands on a dead or stale scope; search page was already correct, so SERP-only bugs are hard to spot in unit tests that only cover search App.
- **Import safety**: v3 import that zeros `siteEngines` destroys local work the user never put in the export file.
- **Engine fidelity**: scheme-in-`site:` (Google) or over-deep paths (Bing/Baidu) produce empty or wrong SERPs without obvious client errors.
- **Dynamic ids**: without a single resolve path, search and SERP diverge on fallback, delete-active, and race handling.

## When to Apply

- Adding user-defined Search Sources that wrap fixed third-party SERP engines with `site:` (or similar) scoping.
- Extending config schema with a new collection field that is both locally mutable and importable.
- Any normalize pipeline that applies size/count caps to arrays stored in extension local storage.
- Dual surfaces (full page + content-script SERP bar) that share active source and navigate on switch.
- Dynamic source ids (`prefix:<uuid>`) that can disappear mid-session when the user deletes them.

## Examples

### P0 — trusted normalize must not empty-on-oversize

**Before (destructive):**

```ts
function normalizeSiteEngineDefinitions(raw: unknown): SiteEngine[] {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length > MAX_SITE_ENGINES) return []; // wipe
  const serialized = JSON.stringify(list);
  if (serialized.length > SITE_ENGINES_BYTE_BUDGET) return []; // wipe
  return list.map(parseOne).filter(Boolean);
}

// create/update/delete:
const current = normalizeSiteEngineDefinitions(await readRaw()); // [] if oversize
const next = [...current, created]; // tiny array
await write(next); // destroys real collection
```

**After (item-by-item trust + bounded untrusted + reject oversized writes):**

```ts
// Trusted local read: never empty solely for size/count
function normalizeSiteEngineDefinitionsTrusted(raw: unknown): SiteEngine[] {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((item) => parseOneSiteEngine(item))
    .filter((x): x is SiteEngine => x != null);
  // oversize: keep valid items; do not return []
}

// Untrusted import only
function isBoundedSiteEngineCollection(raw: unknown): boolean {
  if (!Array.isArray(raw)) return false;
  if (raw.length > MAX_SITE_ENGINES) return false;
  return siteEnginesSerializedBytes(raw) <= SITE_ENGINES_BYTE_BUDGET;
}

// Mutations
async function createSiteEngine(input: NewSiteEngine): Promise<Result> {
  const current = normalizeSiteEngineDefinitionsTrusted(await readRaw());
  const next = [...current, buildSiteEngine(input)];
  if (siteEnginesSerializedBytes(next) > SITE_ENGINES_BYTE_BUDGET) {
    return err("site_engines_budget_exceeded");
  }
  await write(next);
  return ok(next);
}
```

### P1 — SERP switch must post-write re-resolve (mirror search page)

**Before (stale navigate):**

```ts
// SERP onSelect (pre-fix sketch: pre-write resolve, then navigate)
const config = await getConfig();
const resolved = resolveCurrentSiteEngineHandoff(id, query, config.siteEngines ?? []); // pre-write
await setActiveSource(id);
location.assign(resolved.url); // may be deleted/stale after concurrent write
```

**After (shared post-write decision):**

```ts
// SERP onSelect — mirror search App
const gen = ++selectGen; // race guard (with switchReqIdRef on search)
await setActiveSource(id); // before any navigation decision completes
const configAfter = await getConfig(); // re-read after write path
const decision = decidePostWriteSiteEngineNavigation(id, query, configAfter.siteEngines ?? [], preWriteNavigateUrl);

if (gen !== selectGen) return; // stale

if (decision.kind === "unresolved") {
  onUnresolvedSiteEngine(id); // deleted after write — no navigate
  return;
}

location.assign(decision.url); // post-write URL only
```

Helper sketch（真实签名）：

```ts
function decidePostWriteSiteEngineNavigation(
  siteId: SourceId,
  query: string,
  postWriteSiteEngines: readonly SiteEngineDefinition[] | null,
  preWriteNavigateUrl: string,
): { kind: "navigate"; url: string } | { kind: "unresolved" } {
  if (postWriteSiteEngines == null) {
    // Post-write config read failed; the write already succeeded — keep the pre-write URL.
    return { kind: "navigate", url: preWriteNavigateUrl };
  }
  const handoff = resolveCurrentSiteEngineHandoff(siteId, query, postWriteSiteEngines);
  if (handoff?.kind === "navigate") return handoff;
  return { kind: "unresolved" };
}
```

实际辅助函数名为 `resolveCurrentSiteEngineHandoff`（按最新定义重解析站点引擎跳转）与 `buildSiteEngineQuery`（构造 `site:` 作用域查询）；早期草稿中的 `resolveSiteEngine` / `buildSiteScopedUrl` 并不存在。

### Related product rules (non-code)

- Google `site:`: host+path, **no** `https://`.
- Bing: ≤ two path segments; Baidu: hostname only.
- Public FQDN only; strip trailing dots; reject private/local/IP.
- Schema v4 `siteEngines`; v3 import preserves local Site Engines.
- Source ids: `site:<uuid>` on search page and SERP switch bar.

## Related

- [Custom Engine as fourth Search Source](./custom-engine-arbitrary-url-source-type.md) — the fourth source class (arbitrary-URL template, new-tab SERP handoff); shares these persistence invariants
- [Unified Source Model and Shadow-DOM SERP Switch Bar](./serp-switch-bar-and-unified-source-model.md) — foundational Search Source composition Site Engine extends
- [Separate active search source from active BYOK provider](./separate-active-search-source-from-active-byok-provider.md) — non-BYOK source boundary
- [Persistent source order and visible projection](./persistent-source-order-and-visible-projection.md) — related normalize invariants for source lists
- [Dual-domain storage schema versioning](./dual-domain-storage-schema-versioning.md) — config-domain migrations and export/import trust
- [Config preference pipeline](./config-preference-pipeline.md) — end-to-end checklist for new SourceId-shaped prefs
- [Provider switch current query and async state](../ui-bugs/provider-switch-current-query-and-async-state.md) — serialized switch writes and post-mutation re-run
- [Hidden source still active across hosts](../ui-bugs/hidden-source-still-active-across-hosts.md) — multi-host active/projection consistency
- CONCEPTS.md — Search Source, Site Engine, SERP Switch Bar
