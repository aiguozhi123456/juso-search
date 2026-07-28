---
title: "Per-provider config via worker injection (BYOK pattern extended to non-secret prefs)"
date: 2026-07-27
last_updated: 2026-07-28
category: architecture-patterns
module: lib/gateway
problem_type: architecture_pattern
component: service_object
severity: high
applies_when:
  - "Adding a new per-provider configuration that affects search result shape (result count, filters, sort order)"
  - "Extending the BYOK storage pattern to a non-secret preference that must not be read by page/UI code"
  - "Any worker-injected config where the search UI must stay agnostic to stored values and only receive normalized results"
  - "Adding a stored setting whose mutation must invalidate result-shape-dependent caches"
resolution_type: workflow_improvement
root_cause: missing_workflow_step
related_components:
  - frontend_stimulus
tags:
  - byok
  - worker-injection
  - per-provider-config
  - cache-invalidation
  - chrome-mv3
  - wxt
  - concurrency
  - config-io
---

# Per-provider config via worker injection (BYOK pattern extended to non-secret prefs)

## Context

This repository is a WXT + React + TypeScript Chrome MV3 search extension with a strict BYOK (bring-your-own-API-key) trust boundary:

- API keys live only in `chrome.storage.local` under the `providerKeys` key (`lib/storage.ts`).
- Keys are read **only** by the background service worker (`lib/gateway.ts` → `handleSearch`); page code (search UI, options page) never reads stored keys.
- Page code talks to the worker via `@webext-core/messaging` (`lib/messaging.ts`); the worker returns desensitized status (e.g. a list of configured provider ids) — never raw keys.

The task: add a per-provider "max results" (搜索结果条数, 1–20) setting so a user can ask each provider to return fewer/more results than its built-in default.

The interesting part is **not** the feature itself — `SearchOptions.maxResults` already existed in `lib/providers/types.ts` and all six REST adapters (tavily/exa/stepfun/jina/doubao/doubao-global) already read `opts.maxResults ?? <default>`. The gap was purely: storage, gateway injection, config import/export, and UI. The interesting part is **the architectural decision of where to put the new setting, and the cache-invalidation bug that decision produced.**

## Guidance

### Treat non-sensitive per-provider config exactly like secrets, except for the desensitization step

The simplest mental model for "where does a new per-provider setting live in a BYOK MV3 extension" is: **everything the worker needs to call a provider belongs to the worker, not to the page.** API keys are the obvious case; `maxResults` is the non-obvious case because it is *not* sensitive — there is no trust boundary reason to hide it. But the *single-config-entry-point* reason still applies:

- The search UI message (`SearchRequest` in `lib/messaging.ts`) carries only `query`, `providerId`, `forceRefresh`. It deliberately does **not** carry `maxResults`. The worker reads maxResults from storage itself and injects it. This mirrors how the worker reads the API key from storage and injects it.
- The page learns about maxResults only through the desensitized config snapshot (`getProviderConfigSnapshot()` in `lib/storage.ts`, returned via `handleGetProviderConfig`). The page can write it only through a dedicated `setProviderMaxResults` message handled in `lib/gateway.ts`.
- The worker is the single place that combines `providerId + key + maxResults` into the adapter call.

Concretely, in `lib/gateway.ts`:

```ts
const maxResults = await getProviderMaxResults(providerId);
const response = await adapter.search(query, { signal, ...(maxResults !== null ? { maxResults } : {}) }, key);
```

The `...(maxResults !== null ? { maxResults } : {})` spread is the key idiom: **omit the field entirely when unset** so the adapter falls back to its own default. This is deliberately different from `maxResults: maxResults ?? undefined` — it keeps the adapter's `opts.maxResults ?? DEFAULT` semantics intact without inventing a sentinel.

### Do not bump the schema version for an additive, getter-fallback config key

`lib/schema.ts` maintains a config-domain schema (`schemaVersion`, currently 4) with a migration chain. There is also a separate cache-domain schema (`cacheSchemaVersion` in `lib/search-cache.ts`) — the two are intentionally independent so a pure-config change does not force reading/writing the 50-entry cache pool.

When adding `providerMaxResults`, the change to `lib/schema.ts` is just a whitelist append:

```ts
export const CONFIG_KEYS = [
  'providerKeys', 'activeProvider', 'activeSource', 'themePref', 'localePref',
  'sourceOrder', 'sourceHidden', 'siteEngines', 'agentBridgeEnabled',
  'engineSearchEnabled', 'providerMaxResults', // <- additive
] as const;
```

No version bump, no migration. The rule (documented inline at `lib/schema.ts`): **getter-fallback keys (where the default is supplied by the reader, not by a migration) don't need a migration.** `agentBridgeEnabled`, `engineSearchEnabled`, and now `providerMaxResults` all follow this — their getter returns a default when the key is absent, so an existing install upgrading to a build that introduces the key simply sees the default with no write needed. A migration would only be required if the new key had to be back-filled with a non-default value for existing users.

### Put the enforcement point in the adapter factory, not in each provider

Seven adapters share a `defineProvider` factory (`lib/providers/base.ts`). `maxResults` needs to be enforced uniformly across all of them, including `stepfun-plan` — the MCP-based adapter whose `web_search` tool takes only a `query` argument and *cannot* pass a count upstream. For stepfun-plan, the upstream returns whatever it returns and the only way to honor the user's maxResults is to truncate **after** normalization.

The factory's truncation safety net handles all seven in one place:

```ts
async search(query, opts, apiKey) {
  const raw = await def.transport.send(query, opts, apiKey);
  const body = def.normalize(query, raw);
  // maxResults safety net: when the transport can't pass count upstream
  // (e.g. stepfun-plan MCP), truncate uniformly after normalize.
  const limit = opts.maxResults;
  const results = typeof limit === 'number' && limit > 0 ? body.results.slice(0, limit) : body.results;
  return { query, provider: def.id, answer: body.answer, results };
}
```

Note the guard is `limit > 0`, **not** `limit >= 0`. `slice(0, 0)` returns `[]`, which would silently return zero results. The storage layer's `clampMaxResults` already enforces a minimum of 1, so the `>= 0` branch was unreachable via the normal path — but the factory is a public boundary and must be defensively correct on its own.

### Treat the new setting as a "pref" in config import/export, with whole-map overwrite semantics

`lib/config-io.ts` already distinguished between two categories of exported data: keys (only ever filled in, never overwritten on import) and prefs (overwritten wholesale when the user opts in). `providerMaxResults` belongs to the **pref** category: a user importing a config bundle *expects* their maxResults map to become exactly the imported map, not a union with their current map. So the import merge is a whole-map overwrite gated by `applyPrefs`:

```ts
if (payload.providerMaxResults !== undefined) {
  const curMax = normalizeMaxResultsMap(got[MAX_RESULTS_KEY]);
  if (!sameMaxResultsMap(curMax, payload.providerMaxResults)) {
    setObj[MAX_RESULTS_KEY] = payload.providerMaxResults;
    providerMaxResultsOverridden = true;
  }
}
```

The `=== undefined` distinction in parsing matters here: an export that omits the field is different from an export with an empty map, and only the latter should be treated as "set to empty."

### Cascade-delete per-provider config when the provider's key is deleted

`clearKey` (`lib/storage.ts`) is a read-modify-write that already touches `KEYS_KEY`, `SOURCE_ORDER_KEY`, `SOURCE_HIDDEN_KEY`, and `SITE_ENGINES_KEY` (because removing a provider can change which sources are usable). The fix added `MAX_RESULTS_KEY` to that same single read:

```ts
const got = await browser.storage.local.get([KEYS_KEY, SOURCE_ORDER_KEY, SOURCE_HIDDEN_KEY, SITE_ENGINES_KEY, MAX_RESULTS_KEY]);
// ... delete keys[id] ...
const maxMap = (got[MAX_RESULTS_KEY] && typeof got[MAX_RESULTS_KEY] === 'object' && !Array.isArray(got[MAX_RESULTS_KEY])
  ? got[MAX_RESULTS_KEY] as Record<string, unknown>
  : {});
const maxChanged = id in maxMap;
if (maxChanged) delete maxMap[id];
const setObj: Record<string, unknown> = { [KEYS_KEY]: keys, [SOURCE_HIDDEN_KEY]: hidden };
if (maxChanged) setObj[MAX_RESULTS_KEY] = maxMap;
await browser.storage.local.set(setObj);
```

This is a "harmless orphan" cleanup: an unconfigured provider's maxResults is never read (the worker checks the key first), so leaving the entry would be benign. But re-adding the key later would silently reapply the old maxResults — a class of "ghost config" bug that is cheap to prevent here and expensive to diagnose in the field.

## Why This Matters

### The cache-invalidation pitfall (Critical, the most reusable lesson)

This is the bug that justifies documenting the whole pattern. **When a stored setting affects the output of a cached read path, and the cache key does not include that setting, the cache must be invalidated on every write to that setting — or the user's explicit configuration will be silently ignored on every cache hit.**

The reproduction, step by step:

1. User searches "hello" with the default maxResults (8). The worker calls the adapter, gets 8 results, writes a cache entry keyed `tavily:hello` containing the 8-result response.
2. User opens settings, changes maxResults to 3.
3. User searches "hello" again.
4. `handleSearch` checks the cache **before** reading maxResults. `makeSearchCacheKey(providerId, query)` returns `${providerId}:${normalizeSearchQuery(query)}` — maxResults is not in the key. Cache hit. The worker returns the **old 8-result response** from the cache. The user's explicit "3" is silently ignored.

The bug is invisible to the user (no error, no warning) and intermittent (only on previously-searched queries). It is the worst class of setting bug: the setting appears to work for new queries and silently does nothing for queries the user has already tried.

**The fix is not "include maxResults in the cache key."** That alternative was considered and rejected: it is theoretically cleaner (per-value caching, no wholesale invalidation) but it invalidates **every** existing cache entry on upgrade — the moment a user installs a build that adds the new key component, all their cached searches become misses. The chosen fix is surgical: **invalidate only when the setting actually changes.**

```ts
export async function handleSetProviderMaxResults(providerId: ProviderId, maxResults: number): Promise<void> {
  await getSchemaReady();
  await setProviderMaxResults(providerId, maxResults);
  // After maxResults changes, old cache entries have a stale result count
  // (the cache key does not include maxResults). Clear the cache to avoid
  // hits returning responses with the wrong count.
  await clearSearchCache();
}

export async function handleClearProviderMaxResults(providerId: ProviderId): Promise<void> {
  await getSchemaReady();
  await clearProviderMaxResults(providerId);
  await clearSearchCache();
}
```

**The general rule, for any future stored setting that influences search output:** audit every read path that caches results. If the cache key is a strict subset of the inputs that produced the cached value, either (a) fold the new input into the key and accept the upgrade invalidation, or (b) clear the cache in the same handler that writes the setting. Option (b) is correct when the setting changes rarely and the cache is cheap to rebuild; option (a) is correct when the setting changes often or the cache is expensive to repopulate.

A related cap-mismatch bug reinforced the same lesson: `MAX_CACHED_RESULTS` was 10 in `lib/search-cache.ts` while maxResults allowed up to 20. A first search (miss) returned 20 results to the UI; the second search (hit) returned the cached 10. Same user-visible symptom (result count changed for the same query), different cause (cap vs. key). The fix was to bump `MAX_CACHED_RESULTS` to 20 so the cache never silently truncates what the adapter produced. **Any truncation cap applied at the cache layer must be ≥ the maximum the adapter is allowed to return.**

### The read-modify-write serialization requirement (Critical, prevention)

`chrome.storage.local` is async and not transactional. A read-modify-write that does `get → mutate in JS → set` loses writes under concurrency: two callers each read `{}`, each add one key, each write their own single-key map — the second write clobbers the first.

The codebase already had two serialization queues for exactly this pattern: `withProviderKeysMutation` and `withSourceMutation`. The fix added a third, `withProviderMaxResultsMutation`, and wrapped `setProviderMaxResults` / `clearProviderMaxResults` in it:

```ts
let providerMaxResultsMutationQueue: Promise<unknown> = Promise.resolve();

/** Serialize providerMaxResults read-modify-writes (set / clear / mergeImport) to prevent lost writes. */
export function withProviderMaxResultsMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const run = providerMaxResultsMutationQueue.then(mutation, mutation);
  providerMaxResultsMutationQueue = run.catch(() => undefined);
  return run;
}

export async function setProviderMaxResults(id: ProviderId, maxResults: number): Promise<void> {
  const clamped = clampMaxResults(maxResults);
  if (clamped === null) throw new Error('invalid_max_results');
  await withProviderMaxResultsMutation(async () => {
    const got = await browser.storage.local.get(MAX_RESULTS_KEY);
    const map = (got[MAX_RESULTS_KEY] && typeof got[MAX_RESULTS_KEY] === 'object' && !Array.isArray(got[MAX_RESULTS_KEY])
      ? got[MAX_RESULTS_KEY] as Record<string, unknown>
      : {});
    map[id] = clamped;
    await browser.storage.local.set({ [MAX_RESULTS_KEY]: map });
  });
}
```

**The general rule:** any time you find yourself writing `get → modify → set` against `chrome.storage.local` for a shared key, you need a serialization queue. The queue is keyed by **the storage key being mutated**, not by the caller — `withProviderKeysMutation` serializes *all* mutations to `KEYS_KEY`, regardless of which provider id is being changed, because the lost-write hazard is on the shared map, not on the individual entry. The same is true for `MAX_RESULTS_KEY`: two concurrent writes for *different* providers would still lose, because they mutate the same record. A common mistake is to scope the queue per-entry ("different provider ids can't conflict") — they can, because they mutate the same record.

## When to Apply

Apply this pattern when, in a Chrome MV3 (or any service-worker-mediated) extension:

- You are adding a per-provider (or per-entity) stored setting that influences a provider call's output or behavior.
- The extension already has a BYOK worker-injection model for secrets, and you want a single config-entry-point rather than two (one for secrets, one for non-secrets).
- The setting's effect is observable in a cached read path (search results, answer text, etc.).
- The setting is mutated via a read-modify-write on a shared storage key (a `Record<ProviderId, T>` map under one key).

Do **not** apply the cache-invalidation fix blindly when:

- The setting does not influence the cached value (e.g. a UI-only preference like `themePref` or `localePref`). No cache to invalidate.
- The cache key already includes the setting (e.g. if `makeSearchCacheKey` had been `${providerId}:${maxResults}:${query}`). Then invalidation is implicit and explicit clearing is redundant.
- The setting changes at high frequency. Wholesale `clearSearchCache()` on every change is fine for a settings page (one user action → one clear); it would be catastrophic for a setting that changes per-keystroke. In that case, fold the setting into the cache key instead.

## Examples

### Example 1 — The worker-injection idiom (gateway)

`handleSearch` reads the key and maxResults from storage itself; the search message never carries either. Omitting the field when unset preserves the adapter's default:

```ts
export async function handleSearch(request: SearchRequest, signal?: AbortSignal): Promise<SearchReply> {
  await getSchemaReady();
  try {
    const query = request.query.trim();
    const providerId = await resolveSearchProvider(request.providerId);
    if (!providerId) { /* ...keyMissing... */ }
    if (!request.forceRefresh) {
      const cached = await getCachedSearch(providerId, query);   // <- cache check BEFORE maxResults read
      if (cached) return { ok: true, response: cached.response, cache: { hit: true, ... } };
    }
    const adapter = getAdapter(providerId);
    const key = await getKey(providerId);
    if (!key) { /* ...keyMissing... */ }
    const maxResults = await getProviderMaxResults(providerId);
    const response = await adapter.search(
      query,
      { signal, ...(maxResults !== null ? { maxResults } : {}) },   // <- omit when unset
      key,
    );
    const cached = await saveCachedSearch(response).catch(() => null);
    return { ok: true, response, cache: { hit: false, ... } };
  } catch (e) {
    return toSearchError(e);
  }
}
```

Note the ordering hazard: the cache check is **before** the maxResults read. That is fine *because* the cache-clear on set keeps the two consistent. If the cache-clear were ever removed, this ordering is exactly what would produce the silent-stale bug — the comment in `handleSetProviderMaxResults` exists to prevent a future "optimization" that deletes the `clearSearchCache()` call.

### Example 2 — The cache-clear fix (before/after)

Before (buggy — no invalidation):

```ts
export async function handleSetProviderMaxResults(providerId: ProviderId, maxResults: number): Promise<void> {
  await getSchemaReady();
  await setProviderMaxResults(providerId, maxResults);
  // BUG: cached entries keyed by `${providerId}:${query}` still hold the old count.
  // A subsequent cache hit in handleSearch returns the stale result count.
}
```

After (fixed):

```ts
export async function handleSetProviderMaxResults(providerId: ProviderId, maxResults: number): Promise<void> {
  await getSchemaReady();
  await setProviderMaxResults(providerId, maxResults);
  await clearSearchCache();   // <- invalidate; comment explains *why* the key doesn't include maxResults
}
```

### Example 3 — The mutation queue (storage)

Three parallel queues, one per shared storage key, each serializing its own read-modify-writes. The pattern is identical across all three; copy it verbatim when adding a fourth:

```ts
let searchCacheMutationQueue: Promise<unknown> = Promise.resolve();
let providerKeysMutationQueue: Promise<unknown> = Promise.resolve();
let sourceMutationQueue: Promise<unknown> = Promise.resolve();
let providerMaxResultsMutationQueue: Promise<unknown> = Promise.resolve();

export function withProviderKeysMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const run = providerKeysMutationQueue.then(mutation, mutation);
  providerKeysMutationQueue = run.catch(() => undefined);   // never let one failure break the chain
  return run;
}

export function withProviderMaxResultsMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const run = providerMaxResultsMutationQueue.then(mutation, mutation);
  providerMaxResultsMutationQueue = run.catch(() => undefined);
  return run;
}
```

The `.catch(() => undefined)` on the queue tail is load-bearing: without it, one rejected mutation would permanently poison the queue and all subsequent writes would no-op. The mutation itself can still throw — the caller sees the rejection via `run`, but the *next* queued caller sees a clean queue.

### Example 4 — The truncation safety net (adapter factory)

The `defineProvider` factory enforces maxResults uniformly after normalize, so even adapters that cannot pass a count upstream (stepfun-plan MCP) honor the user's setting:

```ts
export function defineProvider<TRaw>(def: ProviderDefinition<TRaw>): ProviderAdapter {
  return {
    id: def.id,
    label: def.label,
    supportsAnswer: def.supportsAnswer,
    favicon: def.favicon,
    async search(query, opts, apiKey) {
      const raw = await def.transport.send(query, opts, apiKey);
      const body = def.normalize(query, raw);
      const limit = opts.maxResults;
      const results = typeof limit === 'number' && limit > 0 ? body.results.slice(0, limit) : body.results;
      return { query, provider: def.id, answer: body.answer, results };
    },
  };
}
```

`limit > 0` (not `>= 0`) is the defensive guard against `slice(0, 0) === []`. The storage layer clamps to a minimum of 1, but the factory is a public boundary and must be correct independent of the caller.

### Example 5 — The UI double-send guard (component)

A number input with `onBlur={saveMaxResults}` and a save button with `onClick={saveMaxResults}`. Clicking the button fires `blur` on the input first, so both handlers run and two `sendMessage` calls hit the worker. Two layers of defense:

```tsx
const maxSavingRef = useRef(false);

async function saveMaxResults() {
  if (maxSavingRef.current) return;            // guard: blur+click dedupe
  // ...
}

// on the save button:
<button
  onMouseDown={(e) => e.preventDefault()}      // prevent input from losing focus on click
  onClick={saveMaxResults}
/>
```

The `preventDefault` on `mouseDown` is the primary fix (the input never loses focus, so `onBlur` doesn't fire); the `useRef` guard is the secondary fix (if `onBlur` *does* fire for any reason, the second invocation is a no-op). Both are needed because either defense alone has an edge case (middle-click, programmatic blur, etc.).

## Related

- **`docs/solutions/architecture-patterns/local-search-cache-mv3.md`** — cache-domain design; the cache-invalidation pitfall (C1) shows its cache key must account for config values that affect result shape.
- **`docs/solutions/architecture-patterns/config-preference-pipeline.md`** — the end-to-end pref pipeline; maxResults is a third pref type (per-provider scalar map) distinct from the existing `SourceId[]` prefs.
- **`docs/solutions/architecture-patterns/dual-domain-storage-schema-versioning.md`** — config-domain schema; the no-bump-for-default-safe rule and the `CONFIG_KEYS` whitelist. maxResults adds an 11th key.
- **`docs/solutions/architecture-patterns/standardized-provider-engine-adapter-layers.md`** — owns the `defineProvider` factory contract where the truncation safety net lives.
- **`docs/solutions/architecture-patterns/provider-api-integration-patterns.md`** — provider adapter patterns; the count-propagation asymmetry (REST forwards upstream, MCP relies on factory slice).
- **`docs/solutions/architecture-patterns/separate-active-search-source-from-active-byok-provider.md`** — the BYOK/provider-config boundary this pref respects.
- **Related bug class:** any future setting that influences a cached provider output (e.g. a per-provider `safeSearch` flag, a per-provider `lang` override) must follow the same audit: (1) inject in the worker, not the page; (2) clear the cache on write, or fold into the cache key; (3) serialize the read-modify-write; (4) cascade-delete on `clearKey`.
