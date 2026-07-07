---
title: "Local Search Cache for Repeat-Billing Avoidance in an MV3 Extension"
date: 2026-07-07
category: architecture-patterns
module: "storage / gateway / messaging"
problem_type: architecture_pattern
component: tooling
severity: medium
applies_when:
  - "Building a WXT + React + TypeScript Chrome MV3 extension that calls paid search APIs"
  - "Adding local caching to avoid repeat billing for identical provider+query searches"
  - "Implementing a search history panel that does not require re-querying providers"
  - "Synchronizing UI preferences across extension tabs without exposing stored API keys to page memory"
related_components:
  - lib/search-cache.ts
  - lib/storage.ts
  - lib/gateway.ts
  - lib/messaging.ts
  - lib/useSearchCache.ts
  - components/SearchCachePanel.tsx
tags:
  - wxt
  - mv3
  - local-cache
  - byok
  - chrome-extension
  - search-history
  - cross-tab-sync
---

# Local Search Cache for Repeat-Billing Avoidance in an MV3 Extension

## Context

Each provider search call costs money — either per-request billing (Tavily, Exa,
Stepfun REST) or subscription credit consumption (Stepfun Step Plan). When a
user searches for the same query with the same provider multiple times, every
call incurs a charge even though the results are identical. The extension
already uses `chrome.storage.local` for BYOK keys and user preferences —
the same local storage can hold cached responses.

A search history panel also needs to show past queries and their results.
Reading full cached responses just to build a history list is wasteful. We
needed a structure that supports both fast cache-first search and lightweight
history browsing without repeatedly loading full result payloads.

## Guidance

### Dual-layer cache structure

Separate the cache into a lightweight index and per-entry full responses:

```
searchCacheIndex          -> light index (order, byKey, summaries)
searchCacheEntry:<id>     -> slimmed full response (replayable for result page)
```

- **Index** (`searchCacheIndex`): holds ordering, a `byKey` map for O(1) lookup
  by `providerId:normalizedQuery`, and `summaries` with query preview, answer
  preview, and result title/url previews. The history panel reads only the index.
- **Entry** (`searchCacheEntry:<id>`): holds the slimmed `NormalizedSearchResponse`.
  Loaded lazily when the user selects a history item.

### Cache key

Key by `providerId + normalizedQuery` (trimmed, whitespace-collapsed).
Different providers do not share cache — a Tavily result for "hello" is a
different search object from an Exa result for "hello".

### Slimmed responses

Cap each entry to prevent unbounded storage growth:

- Max 10 results per entry
- No `content` field (the expandable full text — omit from cache)
- Answer text <= 2000 characters
- Citations <= 10
- Snippets <= 1000 characters
- FIFO eviction at 50 entries

### Cache-first search flow

Cache hit returns immediately without calling the provider. The `forceRefresh`
flag lets the user explicitly request a fresh result:

```typescript
// lib/gateway.ts — simplified
export async function handleSearch(request: SearchRequest): Promise<SearchReply> {
  const providerId = await resolveSearchProvider(request.providerId);

  if (!request.forceRefresh) {
    const cached = await getCachedSearch(providerId, query);
    if (cached) {
      return { ok: true, response: cached.response, cache: { hit: true } };
    }
  }

  const response = await adapter.search(query, {}, key);
  // Best-effort — failure does not lose the search result
  const cached = await saveCachedSearch(response).catch(() => null);
  return { ok: true, response, cache: { hit: false, entryId: cached?.id } };
}
```

### Provider-bound search requests

The `SearchRequest` carries a `providerId` snapshot from the UI. The worker
resolves it against configured providers:

```typescript
export type SearchRequest = {
  query: string;
  forceRefresh?: boolean;
  providerId?: ProviderId;
};
```

If the requested provider is no longer configured, the worker returns
`keyMissing` for that specific provider — it does not silently fall back.

### Mutation serialization

Cache mutations are serialized through a module-level promise queue to prevent
read-modify-write races on the shared index:

```typescript
let searchCacheMutationQueue = Promise.resolve();

async function withSearchCacheMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const run = searchCacheMutationQueue.then(mutation, mutation);
  searchCacheMutationQueue = run.catch(() => undefined);
  return run;
}
```

LRU touch writes are best-effort — if the storage write fails, the readable
cached entry is still returned.

### History panel (lazy-loading side drawer)

The history panel opens as a side drawer from the search page top bar:

1. **On open**: loads only `searchCacheIndex.summaries` — no full entries
2. **On click**: lazy-loads the full `searchCacheEntry:<id>`
3. **Selection guard**: each selection increments a request ID; stale responses
   from previous selections are discarded
4. **Close guard**: closing the panel also increments the request ID, preventing
   post-close callbacks from executing
5. **Clear guard**: a `clearingRef` prevents concurrent `refresh()` from
   re-populating the list during `clear()`

### Cross-tab preference sync without BYOK exposure

Removed page-side `browser.storage.onChanged` listeners from `useTheme` and
`useLocale`. The background worker listens to `storage.onChanged` and broadcasts
sanitized preference messages via `runtime.onMessage`:

```typescript
// entrypoints/background.ts
browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (isThemePref(changes.themePref?.newValue))
    broadcastUiPref({ type: 'uiPrefChanged', key: 'themePref', value: changes.themePref.newValue });
  if (isLocalePref(changes.localePref?.newValue))
    broadcastUiPref({ type: 'uiPrefChanged', key: 'localePref', value: changes.localePref.newValue });
});
```

Pages receive only typed `uiPrefChanged` messages with validated scalar values.
The `providerKeys` change object never enters page memory.

## Why This Matters

**Cost avoidance.** A cache hit skips the provider call entirely, saving per-request
billing or subscription credit. The cache is persistent across page reloads.

**UX consistency.** The cache-hit notice tells the user they are viewing cached
data and offers a one-click refresh. The history panel shows past results
instantly without re-querying.

**Security boundary preservation.** The BYOK invariant — API keys are read only
by the background worker — must not be weakened by new features. Fixing the
pre-existing `storage.onChanged` vector in theme/locale hooks prevents a latent
regression where `providerKeys` changes could enter page memory.

## When to Apply

- WXT / Chrome MV3 extensions that pay per API call and want to cache results locally
- Extension search pages that need a search history panel with instant result recall
- Any MV3 project where page-side `storage.onChanged` listeners could leak
  non-target keys into page memory
- Projects where cross-tab UI preference sync is needed without expanding the
  page's storage read scope

## Examples

### Cache-first search with provider binding

```typescript
// entrypoints/search/App.tsx — search handler
const reply = await sendMessage('search', {
  query,
  forceRefresh: opts.forceRefresh,
  providerId: opts.providerId ?? active ?? undefined,
});

// lib/gateway.ts — worker handler
const providerId = await resolveSearchProvider(request.providerId);
if (!providerId && request.providerId) {
  return { ok: false, error: { kind: 'keyMissing', message: t(MSG.error_key_missing_provider, ...) } };
}
```

### History panel lazy loading

```typescript
// lib/useSearchCache.ts — selection guard
async function select(summary: SearchCacheSummary) {
  const reqId = ++selectReqIdRef.current;
  const entry = await loadEntry(summary.id);
  if (reqId !== selectReqIdRef.current) return;
  if (!entry) { await refresh(); return; }
  onSelect(entry);
  closePanel();
}
```

## Related

- `docs/solutions/best-practices/theme-persistence-i18n-key-hygiene.md` — BYOK
  key hygiene rules that motivated the cross-tab sync change
- `docs/solutions/architecture-patterns/provider-api-integration-patterns.md` —
  provider adapter normalization; the cache stores normalized responses
- `docs/solutions/ui-bugs/provider-switch-current-query-and-async-state.md` —
  search UI async patterns and worker-message boundaries
- `CONCEPTS.md` — Local Search Cache and Search Cache Summary terms
