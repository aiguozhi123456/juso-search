---
title: "Provider instances: multi-variant provider configs behind a closed-union boundary"
date: 2026-08-02
last_updated: 2026-08-06
category: architecture-patterns
module: lib/provider-instances
problem_type: architecture_pattern
component: service_object
severity: high
applies_when:
  - "Adding multi-instance support to a system that already has a closed-union boundary type guarding a trust or capability path"
  - "Letting users create multiple tuned variants of the same backend integration and switch between them as first-class targets"
  - "Extending a versioned wire protocol additively without breaking existing clients"
  - "Keying a cache by a new dimension that must coexist with the old keying without cross-collision"
related_components:
  - lib/provider-instances.ts
  - lib/gateway.ts
  - lib/storage.ts
  - lib/search-cache.ts
  - lib/sources.ts
  - lib/agent-bridge.ts
  - lib/config-io.ts
  - lib/providers/types.ts
  - lib/providers/exa.ts
tags: [byok, provider-instances, source-id, boundary-discipline, wire-protocol, cache-keying, chrome-mv3, wxt]
---

# Provider instances: multi-variant provider configs behind a closed-union boundary

## Context

This repository is a WXT + React + TypeScript Chrome MV3 search extension. Its search sources come in several kinds — BYOK AI providers (`tavily`, `exa`, `brave`, …), regular navigation engines (`google`, `bing`, …), user-defined site-scoped engines, and user-defined custom engines — all projected into a single `SourceId` union so the quick-switch bar can treat them homogeneously. Two prior learnings established the load-bearing boundary that everything here builds on:

- **`separate-active-search-source-from-active-byok-provider`** introduced `SourceId` as the UI/storage composition point and kept `ProviderId` as the worker BYOK path. Engine ids enter `SourceId` but never `ProviderId`.
- **`per-provider-config-worker-injection`** established that non-secret per-provider config (`maxResults`) is still worker-injected: the search message carries no config, the worker reads storage and folds options into `SearchOptions`, and any setting that influences cached output must invalidate the cache on write.

The gap those learnings left: the model was strictly **one instance per provider type**. A user who paid for Exa and wanted two tuned variants — say "AI research" with `category: 'publication', includeDomains: ['arxiv.org']` and "startup news" with `category: 'news'` — had to open settings and re-type the options every time they switched intent. The quick-switch bar showed one Exa pill; the agent bridge could not distinguish one tuning from another; the cache could not tell the two apart.

The "provider instances" feature closes that gap: a `ProviderInstance` is a user-created config entity that binds a base `ProviderId` to a per-instance `options` bag, projects into `SearchSource` as a first-class switchable pill, resolves at the gateway boundary back to `{ providerId, options }`, and is keyed independently in the cache. The work is interesting not because "let users save presets" is hard — it isn't — but because doing it **without widening the closed `ProviderId` union, without breaking the agent wire protocol, and without introducing cache collisions across instances** requires a specific boundary discipline that this document records.

## Guidance

### Model the instance as a config entity that projects into `SearchSource`, not as a reuse of `SearchSource`

`SearchSource` is a view-layer projection: it is what the quick-switch bar renders. A `ProviderInstance` is a config entity: it is what the user edits in settings and what the worker reads to inject options. The two are related by projection, not by identity. This mirrors the existing `SiteEngineDefinition` / `CustomEngineDefinition` → `SearchSource` relationship, and it is the decision that keeps the feature composable with the four orthogonal source axes (`sourceOrder`, `sourceHidden`, `groupConfig`, `activeSource`).

```ts
// lib/provider-instances.ts:4
export type ProviderInstanceId = `inst:${ProviderId}:${string}`;

// lib/provider-instances.ts:7-12
export interface ProviderInstance {
  id: ProviderInstanceId;
  baseProviderId: ProviderId;
  name: string;
  options: Record<string, unknown>;
}
```

The id format is load-bearing. The `inst:` prefix makes an instance id structurally distinguishable from a bare `ProviderId` at every call site via a single `isProviderInstanceId` guard (mirroring `isSiteEngineId` / `isCustomEngineId`). The base provider is embedded in the id (`inst:exa:<uuid>`) so the guard can validate that the id and the `baseProviderId` field agree — a defense against corrupted or hand-edited storage:

```ts
// lib/provider-instances.ts:46-52
export function isProviderInstanceId(id: string): id is ProviderInstanceId {
  const parts = id.split(':');
  return parts.length === 3
    && parts[0] === INSTANCE_ID_PREFIX.slice(0, -1)
    && isProviderId(parts[1])
    && INSTANCE_ID_TOKEN.test(parts[2]);
}
```

The normalizer goes further and rejects records where the embedded base provider disagrees with the declared one (`lib/provider-instances.ts:62`), where `options` is not a plain object (`:64`), or where the name is empty or over length (`:66`). Trusted storage reads use `normalizeProviderInstances` (first-seen-wins dedup, cap at 50); untrusted import payloads additionally pass `isBoundedProviderInstanceCollection` (byte budget) before normalization. This split mirrors `site-engines.ts` exactly and is the reason the two modules read like twins.

### Keep `ProviderId` closed; let instance ids enter `SourceId` but never `ProviderId`

`ProviderId` is a closed string-literal union:

```ts
// lib/providers/types.ts:4
export type ProviderId = 'tavily' | 'exa' | 'brave' | 'stepfun' | 'stepfun-plan' | 'jina' | 'doubao' | 'doubao-global';
```

It is the BYOK boundary type. Every worker-side function that touches a key or an adapter — `getAdapter`, `getKey`, `resolveSearchProvider`, `getProviderMaxResults` — accepts `ProviderId` and only `ProviderId`. If an instance id ever reached one of these, `getAdapter` would throw (unknown id) and `getKey` would return null (no key under an `inst:…` slot), producing a confusing "key missing" error for a provider the user has configured.

`SourceId` is the composition point where instance ids are welcome:

```ts
// lib/sources.ts:20-21
export type SourceKind = 'provider' | 'engine' | 'site-engine' | 'custom-engine' | 'provider-instance' | 'ai-engine';
export type SourceId = ProviderId | EngineId | SiteEngineId | CustomEngineId | ProviderInstanceId | AiEngineId;
```

The rule, enforced by audit and by the `isProviderInstanceId` parallel guard, is: **instance ids flow freely through `SourceId`-typed holes (UI state, `sourceOrder`, `sourceHidden`, `groupConfig`, `activeSource`, agent `search-instance`), but the moment code needs a key or an adapter, it must pass through the gateway boundary that resolves `ProviderInstanceId → { providerId, options }`.** After that boundary, only `ProviderId` flows.

This is the same discipline `separate-active-search-source-from-active-byok-provider` established for engine ids; instances add one more inhabited non-provider variant of `SourceId` (alongside engines and, more recently, AI engines) that must obey the same rule.

### Resolve at the gateway boundary; thread a `cacheKeyId` through the resolution chain

The boundary lives in `lib/gateway.ts` as `resolveInstance`:

```ts
// lib/gateway.ts:416-429
export async function resolveInstance(sourceId: SourceId | undefined): Promise<{
  providerId: ProviderId;
  providerSettings?: Record<string, unknown>;
  cacheKeyId: string;
} | null> {
  if (!sourceId) return null;
  if (isProviderInstanceId(sourceId)) {
    const instances = await getProviderInstances();
    const instance = instances.find((item) => item.id === sourceId);
    if (!instance) return null;
    return { providerId: instance.baseProviderId, providerSettings: instance.options, cacheKeyId: sourceId };
  }
  return isProviderId(sourceId) ? { providerId: sourceId, cacheKeyId: sourceId } : null;
}
```

Three things happen here: (1) the instance id is converted to its base `ProviderId`, which is the only thing that may reach `getAdapter`/`getKey`; (2) the instance's `options` are attached as `providerSettings` for the adapter; (3) a `cacheKeyId` is chosen that will key the cache. For an instance, the `cacheKeyId` is the instance id; for a bare provider, it is the provider id.

The `cacheKeyId` is the subtle part. It is threaded through `resolveSearchSource` → `resolveBareProvider` → `runProviderSearch` so that the cache read and the cache write agree on the key:

```ts
// lib/gateway.ts:451-457
async function resolveBareProvider(providerId: ProviderId): Promise<{ providerId: ProviderId; providerSettings?: Record<string, unknown>; cacheKeyId: string }> {
  const instances = await getProviderInstances();
  const defaultInstance = instances.find((instance) => instance.baseProviderId === providerId);
  return defaultInstance
    ? { providerId, providerSettings: defaultInstance.options, cacheKeyId: defaultInstance.id }
    : { providerId, cacheKeyId: providerId };
}
```

Note `resolveBareProvider` deliberately uses the **default instance's id** as the `cacheKeyId` when a bare provider id is requested and instances exist. This is so that an agent v1 `search { providerId: 'exa' }` (which routes to the default instance) and an agent v2 `search-instance { instanceId: 'inst:exa:<first-uuid>' }` hit the **same** cache entry. Without this alignment, the two protocols would produce duplicate cache entries for identical work, and a `forceRefresh` from one would not invalidate the other.

`runProviderSearch` consumes the resolution and uses `cacheKeyId` for both the cache read and the cache write:

```ts
// lib/gateway.ts:373-407
async function runProviderSearch(
  query: string,
  resolution: { providerId: ProviderId; providerSettings?: Record<string, unknown>; cacheKeyId: string },
  forceRefresh: boolean | undefined,
  signal?: AbortSignal,
): Promise<SearchReply> {
  const { providerId, providerSettings, cacheKeyId } = resolution;
  if (!forceRefresh) {
    const cached = await getCachedSearch(cacheKeyId, query);   // <- read with cacheKeyId
    if (cached) { return { ok: true, response: cached.response, cache: { hit: true, ... } }; }
  }
  const adapter = getAdapter(providerId);                       // <- only ProviderId reaches here
  const key = await getKey(providerId);                         // <- only ProviderId reaches here
  if (!key) { return { ok: false, error: { kind: 'keyMissing', ... } }; }
  const maxResults = await getProviderMaxResults(providerId);
  const options: SearchOptions = {
    signal,
    ...(maxResults !== null ? { maxResults } : {}),
    ...(providerSettings !== undefined ? { providerSettings } : {}),  // <- inject options
  };
  const response = await adapter.search(query, options, key);
  if (signal?.aborted) { throw new DOMException('The operation was aborted.', 'AbortError'); }
  const cached = await saveCachedSearch(response, cacheKeyId).catch(() => null);  // <- write with cacheKeyId
  return { ok: true, response, cache: { hit: false, ... } };
}
```

The `...(providerSettings !== undefined ? { providerSettings } : {})` spread is the same "omit when unset" idiom `per-provider-config-worker-injection` established for `maxResults`: when there are no instances, the field is absent and the adapter falls back to its own defaults. No sentinel, no `undefined` leak.

### The default instance is implicit-first; auto-create on key config; protect the sole instance

When a bare provider id is searched (agent v1, or a UI that hasn't migrated to instance ids) and that provider has instances, the gateway routes to the **first instance in storage order** and injects its options. There is no `defaultInstanceId` field. This is KTD5 in the plan, and it has three consequences:

1. Deleting a non-sole instance makes the next instance the default automatically — no fallback logic, no orphaned `defaultInstanceId` pointing at a deleted id.
2. The user changes the default by reordering `sourceOrder` (an existing axis), not by editing a separate "default" field.
3. The sole instance for a provider cannot be deleted (protects the default), but can be hidden. This ensures a provider with a configured key always has a default instance for v1 agent fallback.

**Auto-create on key config.** When a provider key is saved (`handleSaveProviderKey`) and the provider is in `PROVIDERS_WITH_INSTANCE_OPTIONS` and has no existing instances, a default instance is auto-created with empty options (`{}` — the adapter's normalizer fills defaults) and the provider's display label as its name. This is done atomically via `ensureDefaultInstance` (in `lib/storage.ts`, inside `withSourceMutation(() => withProviderInstancesMutation(...))` — source queue first, then instance queue, matching `createProviderInstance` / `updateProviderInstance` / `deleteProviderInstance`), which checks for existing instances before creating — so re-adding a deleted key does not create a duplicate. This ensures every instance-supporting provider always has ≥1 instance, making the model uniform (no bare pill ever appears for instance-supporting providers).

**Backfill on config read.** Key-save auto-create only covers users who save a key *after* the instance feature shipped. Older users who configured exa/doubao keys before instances existed would otherwise keep a bare provider pill forever. `handleGetProviderConfig` (`lib/gateway.ts`) therefore lazily backfills: it reads the config snapshot, and for any provider in `PROVIDERS_WITH_INSTANCE_OPTIONS` that is configured (key exists — only read in the worker context, BYOK-safe) yet has zero instances, it calls the same `ensureDefaultInstance`. The snapshot returned to the UI is re-read after backfill so the new instance is projected immediately. The backfill is idempotent (missing set is empty once done — `ensureDefaultInstance` is itself a no-op when an instance exists), costs zero extra storage reads in steady state, and is best-effort: a failed backfill never blocks the config reply. Chosen trigger point: every UI surface (search page / options / SERP bar) pulls config through this one worker message, so a single lazy backfill here self-heals all of them. A read-path backfill is preferred over a schema migration for three reasons: (1) it also covers keys filled by config import (`mergeImport` only fills empty slots and never re-triggers key-save auto-create); (2) it keeps the migration chain (`ensureSchema`, worker-only at `lib/gateway.ts:67-74`, pre-warmed at `entrypoints/background.ts:50`) a pure key-stamping function — a migration would have to read key existence inside schema code, leaking the BYOK check out of the read path it belongs to; (3) it self-heals storage that was manually edited back to zero instances.

The cost of implicit-first is that "first in storage order" is an implicit contract. It is documented at `resolveBareProvider` (`lib/gateway.ts:449-450`) and exercised by tests. The benefit is one fewer storage field and one fewer consistency invariant to maintain. The auto-create + sole-instance protection together ensure the default is always present and stable.

### `effectiveActiveSource` must map bare provider ids to instance ids

When a provider has instances, `allSources` projects instance pills only — the bare provider pill is suppressed. But the stored active source may still be a bare provider id (e.g., from before instances were created, or from the auto-create path). `resolveEffectiveActiveSource` (a shared pure function in `lib/sources.ts`) maps a bare provider id to the first instance id when instances exist, so the active-source resolution stays consistent with the projection. This function is used by both `lib/storage.ts` and `lib/config-io.ts` (deduplicated from two copies that would have drifted). Without this mapping, the search page's `visibleActive` would fall back to `sources[0]` — potentially a completely different provider — causing wrong highlighting and searching the wrong provider.

### Extend the agent wire protocol additively, never by widening

The agent bridge speaks a versioned protocol. v1 has `search { providerId: ProviderId }` and `list-providers`. The temptation when adding instances is to widen `search`'s `providerId` to accept `SourceId` (so an instance id could be passed). This temptation must be resisted: `providerId: ProviderId` is the BYOK boundary in the wire protocol, and widening it to `SourceId` would (a) break the type-level guarantee that `getAdapter` receives a known id, and (b) be a breaking change for every existing skill that sends `search`.

Instead, v2 adds two **additive** actions:

```ts
// lib/agent-bridge.ts:9
export const AGENT_BRIDGE_PROTOCOL = 2;

// lib/agent-bridge.ts:18-26
export interface AgentSearchInstanceRequest {
  action: 'search-instance';
  query: string;
  instanceId: ProviderInstanceId;   // <- SourceId variant, NOT ProviderId
  forceRefresh?: boolean;
}
export interface AgentListInstancesRequest {
  action: 'list-instances';
}
```

The v1 `search` action and its `providerId: ProviderId` field are untouched. The parser still rejects an instance id in `search`'s `providerId` slot (`lib/agent-bridge.ts:224`: `!isProviderId(value.providerId)`). Old skills keep working unchanged; new skills opt into v2 by sending `search-instance` or `list-instances`.

Protocol negotiation is by claim version. `parseAgentClaim` accepts both `protocol: 1` and `protocol: 2` claims, and the bridge replies on whichever protocol the claim used (`lib/agent-bridge.ts:89-96`, `:137`). A v1 skill never sees v2 shapes; a v2 skill can call both v1 and v2 actions.

The action dispatch in `runAgentBridge` is a flat conditional chain that mirrors the parser's structure, so every action has exactly one parse site and one dispatch site:

```ts
// lib/agent-bridge.ts:119-125
reply = claim.value.request.action === 'search' ? await deps.handleSearch(claim.value.request, actionController.signal)
  : claim.value.request.action === 'engine-search' ? await deps.handleEngineSearch(claim.value.request, actionController.signal)
    : claim.value.request.action === 'search-instance'
      ? (await deps.handleSearchInstance?.(claim.value.request, actionController.signal)) ?? { ok: false, error: { kind: 'unknown', message: 'Service unavailable.' } }
      : claim.value.request.action === 'list-instances'
        ? (await deps.listInstances?.()) ?? { ok: false, error: { kind: 'unknown', message: 'Service unavailable.' } }
        : claim.value.request.action === 'list-engines'
          ? (await deps.listEngines?.()) ?? { ok: false, error: { kind: 'unknown', message: 'Service unavailable.' } }
          : await deps.listProviders();
```

The `handleSearchInstance?` / `listInstances?` optionals are defensive: if a future host forgets to wire them, the bridge returns a clean "service unavailable" rather than throwing.

`list-instances` returns a desensitized shape — `id`, `providerId`, `label`, `description`, `configured` — never keys, never options. The agent learns *that* an instance exists and *whether* it is usable, not *how* it is tuned. This is the same desensitization rule `list-providers` already follows.

**Agent discoverability via `hasInstances`.** A v1 agent that only calls `list-providers` has no way to know instances exist. To bridge this, `AgentProvider` gained an optional `hasInstances?: boolean` field (additive, non-breaking). `handleListAgentProviders` populates it by checking which providers have instances. Old agents ignore the field; v2-aware agents use it to decide whether to call `list-instances`. This is the minimal discoverability bridge between the v1 and v2 surfaces without widening any v1 action's parameter type.

### Key the cache by `instanceId ?? providerId`, and bump the cache schema

The cache key changes from `${providerId}:${query}` to `${id}:${query}` where `id` is the `cacheKeyId` threaded from the resolution boundary:

```ts
// lib/search-cache.ts:100-102
export function makeSearchCacheKey(id: string, query: string): string {
  return `${id}:${normalizeSearchQuery(query)}`;
}
```

This is the only way two instances of the same provider searching the same query can avoid colliding. Without it, "AI research" searching `transformers` would return "startup news"'s cached results (or vice versa) — the worst class of cache bug: invisible, intermittent, and silently returning the wrong tuning.

Because the key shape changed, the cache schema version bumps from 1 to 2, and the first real `CacheMigration` is exercised:

```ts
// lib/search-cache.ts:13
export const CURRENT_CACHE_SCHEMA_VERSION = 2;

// lib/search-cache.ts:30-43
export const cacheMigrations: CacheMigration[] = [
  {
    // v1 → v2: cache key changed from `${providerId}:${query}` to `${id}:${query}`.
    // Old-format entries would collide across instances. Cache is rebuildable,
    // so drop everything and stamp v2.
    version: 1,
    migrate: ({ entries }) => ({
      index: emptySearchCacheIndex(),
      entries: [],
      dropEntryIds: entries.map((entry) => entry.id),
    }),
  },
];
```

The migration drops all entries. This is acceptable because the cache is purely a rebuildable performance layer — the `per-provider-config-worker-injection` learning already established that `clearSearchCache()` is the correct response to any setting change that invalidates the cache, and a schema migration is just a forced version of the same. The `ensureCacheSchema` runner (`lib/search-cache.ts:261-277`) handles the upgrade window: it reads the version stamp, runs the migration chain, and has a `recoverCacheSchemaByClear` fallback that drops the whole pool and stamps the current version if the migration throws — so a single bad migration cannot permanently brick the worker's search path.

The `SearchCacheEntry` and `SearchCacheSummary` types gain an optional `instanceId?` field (`lib/search-cache.ts:64`, `:86`), populated by `buildSearchCacheEntry` when the `cacheKeyId` is an instance id:

```ts
// lib/search-cache.ts:117-132
export function buildSearchCacheEntry(response: NormalizedSearchResponse, instanceId?: string, now = Date.now()): SearchCacheEntry {
  const id = createCacheId();
  const normalizedQuery = normalizeSearchQuery(response.query);
  const cacheKey = makeSearchCacheKey(instanceId ?? response.provider, normalizedQuery);
  return {
    id,
    cacheKey,
    query: response.query,
    normalizedQuery,
    providerId: response.provider,
    ...(instanceId ? { instanceId } : {}),
    // ...
  };
}
```

The `instanceId ?? response.provider` fallback is what makes bare-provider searches (no instance) continue to key by provider id, preserving cache continuity for the no-instances case.

### Use a generic `providerSettings` channel; do not add provider-specific fields to `SearchOptions`

`SearchOptions` gains one field:

```ts
// lib/providers/types.ts:34-40
export interface SearchOptions {
  maxResults?: number;
  signal?: AbortSignal;
  /** Provider-specific settings; gateway reads from storage and passes through. */
  providerSettings?: Record<string, unknown>;
}
```

It is deliberately `Record<string, unknown>`, **not** `exaCategory?: string` or `ExaSettings?: ExaSettings`. Each adapter owns its own options schema and reads from the generic bag:

```ts
// lib/providers/exa.ts:97-115
buildRequest(query, opts, apiKey) {
  const s = normalizeExaSettings(opts.providerSettings);   // <- adapter owns the schema
  const numResults = opts.maxResults ?? 8;                  // <- provider-level maxResults wins; adapter default 8
  // ...build body from s.searchType, s.category, s.includeDomains, etc.
}
```

`normalizeExaSettings` (`lib/providers/exa.ts:68-84`) sanitizes the untrusted `providerSettings` bag into a valid `ExaSettings` at the adapter boundary — the same way `normalizeProviderInstance` sanitizes at the storage boundary. Unknown fields are ignored. This means:

- Exa ships options (6 fields: searchType, category, includeDomains, excludeDomains, textMaxCharacters, highlightsMaxCharacters) and Doubao ships options (9 fields: timeRange, needContent, needUrl, sites, blockHosts, onlyAuthoritative, queryRewrite, contentFormat, industry). Result count (`numResults`) is **not** an instance option — the provider-level `maxResults` stepper is the single source of truth for result count. This avoids a dead-form-field bug where provider-level maxResults would silently override instance-level numResults.
- The framework is schema-agnostic from day one: each adapter owns its options schema and normalizer, and the form is just a draft-to-settings projection in `ProviderInstanceManager`.
- Adding options for a third provider requires **no change to `SearchOptions`, `gateway.ts`, `messaging.ts`, or the cache**. It requires only: (1) an options type + normalizer in the new adapter, (2) an options form in `ProviderInstanceManager`, (3) an entry in `PROVIDERS_WITH_INSTANCE_OPTIONS`.

The `PROVIDERS_WITH_INSTANCE_OPTIONS` set (`lib/provider-instances.ts:32-35`) is the hardcode that gates which providers appear in the "create instance" dropdown:

```ts
export const PROVIDERS_WITH_INSTANCE_OPTIONS: ReadonlySet<ProviderId> = new Set<ProviderId>([
  'exa',
  'doubao',
]);
```

Creating an instance of a provider with no options would be meaningless — it would behave identically to the bare provider pill. The set prevents that. The set is intentionally hand-maintained (each addition must also ship an adapter schema + UI form); a future phase could derive it from adapter-declared schema descriptors, but the three-step extension contract (adapter schema + UI form + set entry) is documented inline at `:22-31`.

### Mirror site-engine / custom-engine patterns for storage, projection, and config IO

The instance feature is the fourth instance of a recurring pattern in this codebase (after providers, site-engines, custom-engines). Every layer that already handled site-engines was extended with a parallel instance branch:

- **Storage CRUD** (`lib/storage.ts`): `getProviderInstances` / `setProviderInstances` / `createProviderInstance` / `updateProviderInstance` / `deleteProviderInstance`, plus a fourth serialization queue `withProviderInstancesMutation`. Every instance CRUD that reads or rewrites the instance collection (`createProviderInstance` / `updateProviderInstance` / `ensureDefaultInstance` / `deleteProviderInstance`) acquires the source queue before the instance queue (the same order `clearKey` uses) so it serializes against `mergeImport`, which holds the source queue while whole-array-overwriting the instance collection — the instance queue alone would still permit a lost-update against that whole-array write.
- **`selectActiveSourceId` dual-write** (`lib/storage.ts:290-313`): selecting an instance id writes both `activeSource = instanceId` and `activeProvider = instance.baseProviderId`, so provider-only fallback paths (`getActiveProviderId`) still resolve. This mirrors the existing `isKnownProvider` branch.
- **`allSources` projection** (`lib/sources.ts:157-256`): a provider with instances projects one pill per instance (sharing the base adapter's `favicon` / `supportsAnswer`, using the instance name as a literal label) and **does not** project a bare provider pill. A provider with zero instances projects the bare pill as before. Same-provider instances are kept adjacent in the flyout by a sort heuristic over `sourceOrder`.
- **`normalizeSourceOrder` / `normalizeSourceHidden` / `allKnownSourceIds`** (`lib/sources.ts:56-135`): each gained a `providerInstances` parameter. Instance ids are kept iff they appear in the provided definitions; unknown ids are stripped.
- **Config IO** (`lib/config-io.ts`): `ConfigExport.providerInstances?` is a pref with whole-array overwrite semantics, identical to `siteEngines` and `customEngines`. Import validation rejects bad ids, unknown base providers, non-plain-object options, and oversized collections.

The lesson here is meta: when a codebase has a recurring entity pattern, the fastest and safest way to add a new entity type is to mechanically mirror every existing branch, not to invent a new abstraction. The abstraction (a generic "source definition" interface) was explicitly deferred to Phase 2 in the plan; Phase 1 ships the fourth copy because four copies are cheaper to validate than a premature abstraction that gets two of the four wrong.

## Why This Matters

### The boundary discipline is what makes BYOK safe under multi-instance

`ProviderId` is closed for a reason. Every `getAdapter(providerId)` call is a trust assertion: "this id is one of the eight providers I have an adapter for, and I will hand it an API key." If instance ids leaked into that call, the adapter registry would throw, and the user — who has a configured provider — would see a "key missing" error that is actually a "you sent the wrong kind of id" error. The error message would be wrong, the diagnosis would be hard, and the fix would be brittle.

The `isProviderInstanceId` parallel guard is the enforcement mechanism. It is used at every `SourceId`-typed boundary that must branch: `resolveInstance`, `resolveSearchSource`, `selectActiveSourceId`, `effectiveActiveSource`, `visibleUsableSource`, `normalizeSourceOrder`, `normalizeSourceHidden`, `allKnownSourceIds`, `allSources`, `parseSearchRequest` (agent v2), `isKnownSource` (config IO). The audit point recorded in the plan ("`isKnownProvider` all call sites confirm no instance id is passed in; `getAdapter` call sites confirm only `ProviderId`") is the regression check that keeps the boundary intact as the code evolves.

### Additive agent actions preserve wire-protocol compatibility

A skill that sends `search { providerId: 'exa', query: '...' }` is deployed in the wild. Widening `providerId` to `SourceId` would either break that skill (if the parser rejected the old shape) or silently change its semantics (if the parser accepted an instance id where a provider id was expected). Neither is acceptable for a protocol that agents depend on.

The additive pattern — new actions for new capability, old actions unchanged — means the v2 feature is purely opt-in. A skill that never learned about instances continues to work exactly as before, routing to the default instance. A skill that wants instance-awareness sends `list-instances` to discover what exists, then `search-instance` to target one. The protocol bump to 2 is negotiated per-claim, so a v1 host and a v2 skill (or vice versa) interoperate: the v2 actions are simply unavailable to a v1 host, and the bridge returns "service unavailable" rather than crashing.

### Cache keying by instanceId prevents the silent-wrong-tuning bug

Two Exa instances searching `transformers` produce **different** API requests (different `category`, different `includeDomains`). If they shared a cache key, the second search would return the first search's cached response — the wrong category, the wrong domains, the wrong results. The user would see "startup news" results under the "AI research" pill and have no way to understand why.

Keying by `cacheKeyId` (which is the instance id for instance searches, the provider id for bare searches, and the default instance id for bare-provider-routed-to-default searches) makes the three cases distinct where they should be distinct and identical where they should be identical. The `resolveBareProvider` → default-instance-id choice is the one that makes v1 and v2 share an entry for the same logical work; without it, `forceRefresh` from one protocol would leave a stale entry for the other.

### The generic `providerSettings` channel avoids a Phase 2 framework rewrite

If `SearchOptions` had gained `exaCategory?: string`, then adding Tavily options in Phase 2 would require another field, another gateway injection branch, another cache-key audit, and another schema bump. The generic `Record<string, unknown>` channel means Phase 2 is purely additive at the adapter layer: the new adapter declares its options type, its normalizer, and its `buildRequest` reads from `opts.providerSettings`. The framework (`SearchOptions`, `gateway.ts`, `messaging.ts`, `search-cache.ts`) does not change. This is the same "schema-agnostic from day one" discipline that kept `maxResults` out of the cache key — the framework should not know more about provider options than it has to.

### Cautionary lesson 1: the cache-key integration seam bug (parallel implementations without reconciliation)

This bug was found during reconciliation, not during implementation. The plan split the work into Implementation Units that could proceed in parallel: IU4 (gateway) and IU6 (cache) were independent. Two fixers implemented them concurrently. IU6 correctly changed `makeSearchCacheKey` to accept an `id` parameter and `buildSearchCacheEntry` to accept an `instanceId`. IU4 correctly added `resolveInstance` and `runProviderSearch`.

The seam: IU4's `runProviderSearch` **keyed the cache by `providerId`** and called `saveCachedSearch(response)` **without the instance id** — because IU4 was written before IU6's `saveCachedSearch(response, id)` signature existed, and the fixer did not reconcile after IU6 landed. The result: IU6's per-instance keying was in place, but IU4 bypassed it by passing the provider id as the key and omitting the instance id from the save. Two instances of the same provider would write under the same `providerId:query` key, and the second would overwrite the first. The per-instance keying existed in the cache module but was never exercised by the gateway.

The fix was to thread `cacheKeyId` through the entire resolution chain (`resolveInstance` / `resolveSearchSource` / `resolveBareProvider` all return it; `runProviderSearch` reads it and passes it to both `getCachedSearch` and `saveCachedSearch`). This is the `cacheKeyId` field visible in `lib/gateway.ts:375` and `:379`.

**The general lesson:** when two parallel work units touch a shared seam (here: the cache key and the cache write), the integration point must be explicitly reconciled. "Both units passed their own tests" is not sufficient, because each unit's tests mocked the other side. The seam only exists in the integrated path. The reconciliation audit — "does `runProviderSearch` pass the same id to `getCachedSearch` and `saveCachedSearch` that `resolveInstance` chose?" — is the check that catches this class of bug. It should be a mandatory step whenever a parameter is threaded across a unit boundary that was implemented in parallel.

### Cautionary lesson 2: the `storage.ts` instance-id stripping bug (missing argument threading)

This bug was found in a fresh review after the cache-key bug was fixed. `normalizeSourceOrder`, `normalizeSourceHidden`, and `allKnownSourceIds` in `lib/sources.ts` each gained a `providerInstances` parameter (defaulting to `[]`). The default is the trap: a caller that forgets to pass the instances sees an empty set, and every instance id is silently stripped from `sourceOrder` / `sourceHidden` / `groupConfig`.

`lib/config-io.ts` threaded the argument correctly at every call site — it was written alongside the instance feature and the author was aware. `lib/storage.ts` was modified by the same parallel work, and **~15 call sites** in `storage.ts` called `normalizeSourceOrder` / `normalizeSourceHidden` / `allKnownSourceIds` **without** the `providerInstances` argument. The default `[]` kicked in. Instance ids were stripped from `sourceOrder` on every read-modify-write. The user-facing symptom: hiding, pinning, grouping, and reordering instances silently failed. The instance pill appeared in the bar, but moving it did nothing, and hiding it did nothing — because the write normalized the id out of existence before persisting.

The fix was to mirror `config-io.ts`'s pattern in `storage.ts`: every call site that already read `PROVIDER_INSTANCES_KEY` into `instances` must pass `instances` as the fourth argument. This is visible throughout `lib/storage.ts` — e.g. `:157-158` in `clearKey`, `:388` in `getSourceOrder`, `:410` in `setSourceHidden`, `:425-429` in `getGroupConfig`, `:629-631` in `deleteProviderInstance`. The `getProviderConfigSnapshot` function (`:660-677`) reads all keys in one batch and threads `providerInstances` into every normalizer that needs it.

**The general lesson:** when a function gains a parameter that defaults to "empty," every existing call site is a latent bug. The default makes the code compile and the existing tests pass, but it silently changes behavior for any caller whose data is non-empty. The migration strategy for such a parameter is **not** "add it with a default and hope callers update" — it is "add it, then grep every call site and update it explicitly, then add a lint rule or a non-defaulting overload to prevent regression." The codebase's `normalizeSourceOrder` / `normalizeSourceHidden` / `allKnownSourceIds` now all require the argument at every call site in `storage.ts` and `config-io.ts`; the default remains only for call sites in `sources.ts` itself and in tests that genuinely want an empty set.

## When to Apply

Apply this pattern when:

- **A system has a closed-union boundary type** (e.g. `ProviderId`) that guards a trust or capability path (key lookup, adapter dispatch), and you need to add user-created variants that must not widen that union. The instance-id-enters-`SourceId`-but-not-`ProviderId` split is the canonical move.
- **You are extending a versioned wire protocol** and the new capability is not a generalization of an existing action. Add new actions; do not widen existing action parameters. Negotiate by version per-request.
- **You are keying a cache by a new dimension** that coexists with the old keying. Fold the new dimension into the key and bump the schema; accept the one-time invalidation. Choose the key so that semantically-identical work (v1 default-route and v2 explicit-default-instance) hits the same entry.
- **You are adding a per-entity config bag** that will grow to more entity types. Use a generic channel (`Record<string, unknown>`) with adapter-owned schemas, not a typed field per entity type. Gate which entities expose config via an explicit set, and document the three-step extension contract.
- **A codebase already has a recurring entity pattern** (site-engines, custom-engines, …). Mechanically mirror every existing branch for the new entity type; defer the abstraction until the pattern's variations are understood.

Do not apply the "generic channel" pattern when the config field is universal across all adapters (like `maxResults`) — that deserves a first-class `SearchOptions` field. The generic channel is for fields that are **per-adapter-schema**, where each adapter decides what its options mean.

Do not apply the "additive action" pattern when the new capability is a true generalization of an existing action and all clients can be migrated atomically. Additive actions are the right choice when clients are decoupled (agents in the wild) and backward compatibility is required.

## Examples

### Example 1 — The `resolveInstance` boundary (gateway)

The single function that converts a `SourceId` (which may be an instance id) into the `{ providerId, providerSettings, cacheKeyId }` triple that the worker BYOK path consumes. After this function returns, no instance id flows further:

```ts
// lib/gateway.ts:416-429
export async function resolveInstance(sourceId: SourceId | undefined): Promise<{
  providerId: ProviderId;
  providerSettings?: Record<string, unknown>;
  cacheKeyId: string;
} | null> {
  if (!sourceId) return null;
  if (isProviderInstanceId(sourceId)) {
    const instances = await getProviderInstances();
    const instance = instances.find((item) => item.id === sourceId);
    if (!instance) return null;
    return { providerId: instance.baseProviderId, providerSettings: instance.options, cacheKeyId: sourceId };
  }
  return isProviderId(sourceId) ? { providerId: sourceId, cacheKeyId: sourceId } : null;
}
```

`handleSearchInstance` (the v2 agent action) calls this directly. `handleSearch` (the v1 UI/agent path) calls `resolveSearchSource`, which calls `resolveInstance` for instance ids and `resolveBareProvider` for bare provider ids (routing to the default instance's options and id when instances exist).

### Example 2 — The `cacheKeyId` threading

The resolution returns a `cacheKeyId`; `runProviderSearch` uses it for both read and write. This is the seam that was broken in cautionary lesson 1, and the fix is the `cacheKeyId` parameter visible here:

```ts
// lib/gateway.ts:379-405 (excerpt)
const { providerId, providerSettings, cacheKeyId } = resolution;
if (!forceRefresh) {
  const cached = await getCachedSearch(cacheKeyId, query);          // <- read with cacheKeyId
  if (cached) { return { ok: true, response: cached.response, ... }; }
}
// ... adapter.search with providerId + key + providerSettings ...
const cached = await saveCachedSearch(response, cacheKeyId).catch(() => null);  // <- write with cacheKeyId
```

And the storage layer extracts the instance id from the same `cacheKeyId` when building the entry:

```ts
// lib/storage.ts:731-736
async function saveCachedSearchUnlocked(response: NormalizedSearchResponse, id?: string): Promise<SearchCacheEntry> {
  const index = await readSearchCacheIndex();
  const instanceId = id && isProviderInstanceId(id) ? id : undefined;
  const entry = buildSearchCacheEntry(response, instanceId);
  // ...
}
```

### Example 3 — The v2 action dispatch and parse

The parser recognizes `search-instance` and `list-instances` as new actions, validates the instance id with `isProviderInstanceId`, and leaves the v1 `search` action's `providerId: ProviderId` validation untouched:

```ts
// lib/agent-bridge.ts:208-219
if (value.action === 'list-instances') {
  return hasOnlyKeys(value, ['action'])
    ? { ok: true, value: { action: 'list-instances' } }
    : { ok: false, error: 'invalid list instances request' };
}
if (value.action === 'search-instance') {
  if (!hasOnlyKeys(value, ['action', 'query', 'instanceId', 'forceRefresh']) || typeof value.query !== 'string') return { ok: false, error: 'invalid search instance request' };
  const query = value.query.trim();
  if (!query || query.length > 8192 || typeof value.instanceId !== 'string' || !isProviderInstanceId(value.instanceId)) return { ok: false, error: 'invalid search instance request' };
  if (value.forceRefresh !== undefined && typeof value.forceRefresh !== 'boolean') return { ok: false, error: 'invalid search instance request' };
  return { ok: true, value: { action: 'search-instance', query, instanceId: value.instanceId, ...(value.forceRefresh === undefined ? {} : { forceRefresh: value.forceRefresh }) } };
}
```

The v1 `search` action follows and still rejects instance ids in the `providerId` slot (`lib/agent-bridge.ts:224`: `!isProviderId(value.providerId)`). `handleListAgentInstances` returns the desensitized shape:

```ts
// lib/gateway.ts:137-150
export async function handleListAgentInstances(): Promise<{ instances: AgentInstance[] }> {
  await getSchemaReady();
  const [instances, configured] = await Promise.all([getProviderInstances(), getConfiguredProviderIds()]);
  const configuredSet = new Set(configured);
  return {
    instances: instances.map((instance) => ({
      id: instance.id,
      providerId: instance.baseProviderId,
      label: instance.name,
      description: '',
      configured: configuredSet.has(instance.baseProviderId),
    })),
  };
}
```

### Example 4 — The `providerSettings` injection (adapter-owned schema)

The gateway injects `providerSettings` as a generic bag; the Exa adapter owns the schema and sanitizes at its boundary:

```ts
// lib/gateway.ts:396-401
const options: SearchOptions = {
  signal,
  ...(maxResults !== null ? { maxResults } : {}),
  ...(providerSettings !== undefined ? { providerSettings } : {}),
};
const response = await adapter.search(query, options, key);
```

```ts
// lib/providers/exa.ts:97-115
buildRequest(query, opts, apiKey) {
  const s = normalizeExaSettings(opts.providerSettings);   // <- adapter sanitizes the generic bag
  const numResults = opts.maxResults ?? 8;                  // <- provider-level maxResults wins; adapter default 8
  const text = s.textMaxCharacters != null ? { maxCharacters: s.textMaxCharacters } : true;
  const highlights = s.highlightsMaxCharacters != null ? { maxCharacters: s.highlightsMaxCharacters } : true;
  return {
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({
      query,
      type: s.searchType,
      numResults,
      ...(s.category ? { category: s.category } : {}),
      ...(s.includeDomains.length ? { includeDomains: s.includeDomains } : {}),
      ...(s.excludeDomains.length ? { excludeDomains: s.excludeDomains } : {}),
      outputSchema: { type: 'text', description: 'A concise synthesized answer to the query.' },
      contents: { text, highlights },
    }),
  };
}
```

`normalizeExaSettings` (`lib/providers/exa.ts:68-84`) handles every field defensively: unknown `searchType` falls back to `'auto'`, unknown `category` to `''`, out-of-range integers are clamped or nulled, domain arrays are filtered to non-empty trimmed strings. This is the same sanitization discipline as `normalizeProviderInstance` at the storage boundary — untrusted data is cleaned at the boundary, never trusted to be well-formed downstream.

## Related

- **`docs/solutions/architecture-patterns/separate-active-search-source-from-active-byok-provider.md`** — the `SourceId` vs `ProviderId` boundary this feature extends. Instances add a second inhabited `SourceId` variant (after engines) that must obey the same "never enter `ProviderId`" rule.
- **`docs/solutions/architecture-patterns/per-provider-config-worker-injection.md`** — the worker-injection pattern (`maxResults` precedent) that `providerSettings` follows. The cache-invalidation pitfall recorded there is the direct ancestor of the cache-key seam bug recorded here; the `clearSearchCache()` on `handleUpdateProviderInstance` / `handleDeleteProviderInstance` (`lib/gateway.ts:245`, `:255`) follows the same "clear on write when the key doesn't include the setting" rule.
- **`lib/site-engines.ts` / `lib/custom-engines.ts`** — the entity pattern that `provider-instances.ts` mirrors (type + id guard + normalizer + byte-budget + bounded-collection guard). The storage CRUD and config-IO branches are the fourth copy of this pattern.
- **`docs/solutions/architecture-patterns/dual-domain-storage-schema-versioning.md`** — the cache-domain schema migration chain that the v1→v2 migration exercises for the first time. The `recoverCacheSchemaByClear` fallback is what makes "drop all entries" a safe migration.
- **`docs/solutions/logic-errors/source-graph-new-type-threading-data-loss.md`** — the threading-data-loss bug class that the `storage.ts` instance-id stripping bug (cautionary lesson 2) is a direct instance of. The "enumerate every normalizer caller" prevention checklist applies to any new `SourceId` variant.
- **Refresh candidates surfaced by this learning:**
  - `per-provider-config-worker-injection` should cross-reference the `cacheKeyId` threading as the general form of "the cache read and write must agree on the key" — the `maxResults` case was simple (key unchanged, clear on write); the instance case is the general form (key changes, no clear needed because the key itself disambiguates).
  - `separate-active-search-source-from-active-byok-provider` should note that `SourceId` now has multiple inhabited non-provider variants (engines, instances, and AI engines), all of which require the parallel `is*Id` guard at every boundary.
  - `local-search-cache-mv3` should note the `instanceId` dimension added by cache schema v2 — the key is now `${instanceId ?? providerId}:${query}`, not `${providerId}:${query}`.
  - `agent-skill-localhost-capability-bridge` should mention the v2 additive action surface (`search-instance`, `list-instances`) and confirm v1 callers remain unaffected.
