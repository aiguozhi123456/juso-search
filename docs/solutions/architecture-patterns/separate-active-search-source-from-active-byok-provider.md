---
title: "Separate active search source from active BYOK provider"
date: 2026-07-09
category: architecture-patterns
module: search-source-configuration
problem_type: architecture_pattern
component: tooling
severity: medium
applies_when:
  - "A product has both key-backed provider integrations and keyless navigation engines"
  - "A settings UI must select a default search target without implying API-key availability"
  - "A worker-owned provider path must remain isolated from view-layer source choices"
related_components:
  - lib/storage.ts
  - lib/messaging.ts
  - lib/gateway.ts
  - entrypoints/options/App.tsx
  - entrypoints/search/App.tsx
  - lib/config-io.ts
  - lib/schema.ts
  - components/ConfigExportImport.tsx
tags: [byok, search-sources, chrome-extension, configuration, worker-boundary]
---

# Separate active search source from active BYOK provider

## Context

The extension has two kinds of search choices with different runtime contracts:

- **BYOK providers** (`tavily`, `exa`, `stepfun`, `stepfun-plan`) require saved API keys and flow through the background worker, `ProviderAdapter.search()`, normalized responses, and the local provider-keyed cache.
- **Regular engines** (`google`, `bing`) require no API key and are navigation-only targets. They build home/SERP URLs and never return normalized answers.

Delete-key support exposed the architecture gap. After removing provider keys, the extension was still legitimately usable through Google or Bing, but the options page selector labeled “激活的搜索引擎” listed only configured BYOK providers. Treating engines as providers would make the selector look right while allowing engine IDs to leak into provider-only code paths such as `resolveSearchProvider()`, `getAdapter()`, key lookup, and cache refresh.

The fix is to keep `activeProvider` provider-only and introduce a separate persisted `activeSource`, typed as `SourceId = ProviderId | EngineId`. The composition point belongs at the UI/default-source layer, not in the worker provider path.

## Guidance

Model BYOK providers and regular engines as separate concepts, then compose them only where the product needs a selectable default source.

- Keep `activeProvider` as the provider-only value used by worker search fallback and provider-result refresh semantics.
- Add `activeSource` as the UI/default-source preference that may be either a provider ID or an engine ID.
- Keep `sendMessage('search')`, `resolveSearchProvider()`, and `getAdapter()` provider-only.
- Treat Google and Bing as navigation targets: no key, no answer model, no cache-backed provider refresh.
- Re-fetch provider config after save, delete, and import operations so the options selector reflects the latest configured providers and effective active source.

The storage layer owns the fallback rule:

```ts
// Effective source fallback:
// valid stored activeSource -> activeProvider with key -> first configured provider -> google
export async function getActiveSourceId(): Promise<SourceId> {
  const got = await browser.storage.local.get([ACTIVE_SOURCE_KEY, ACTIVE_KEY, KEYS_KEY]);
  // ...validate stored source/provider against known IDs and provider keys
}
```

The gateway mirrors that boundary:

```ts
export async function handleSetActiveSource(sourceId: SourceId): Promise<void> {
  await getSchemaReady();
  if (isProviderId(sourceId)) {
    await Promise.all([setActiveSourceId(sourceId), setActiveProviderId(sourceId)]);
    return;
  }
  await setActiveSourceId(sourceId);
}
```

Provider selections keep both preferences aligned. Engine selections update only `activeSource`; the last provider fallback remains available for provider-only searches.

The options page renders the selector from the view-layer source model:

```ts
const configuredSources = allSources(configuredProviderIds);

async function choose(id: SourceId) {
  await sendMessage('setActiveSource', id);
  setActive(id);
}
```

The search page uses `SourceId | null` for UI state, then dispatches by source kind. Provider sources call the worker search protocol; engine sources navigate only on explicit search or chip click. A bare `search.html` page with active Google/Bing stays on the extension page instead of auto-redirecting. Provider deep links still take precedence and auto-search only when the provider is configured.

Include `activeSource` in the config domain. Export/import/preview/merge should preserve the source preference, and older exports that lack `activeSource` should normalize it from `activeProvider` so existing backup files still import cleanly.

## Why This Matters

The UI can make providers and engines look like one list, but the runtime contracts are not interchangeable. A provider can answer through an adapter and belongs to the worker-side BYOK path. An engine can only navigate the browser to a results page. If engine IDs masquerade as provider IDs, the background worker can try to resolve a non-existent adapter, cache semantics become ambiguous, and API-key configuration state stops representing what it claims to represent.

Keeping `activeProvider` provider-only protects the worker/key boundary. Introducing `activeSource` gives the UI the flexibility it needs without weakening the provider abstraction. It also makes the no-key state first-class: deleting every BYOK key does not leave the extension without a default search option, because `google` is a valid fallback even when there are no configured providers.

The same split keeps configuration backup semantics clear. Provider keys, configured provider IDs, and `activeProvider` remain about BYOK AI adapters. `activeSource` records the user's default entry point, which may be a provider-backed AI search or an ordinary search engine.

## When to Apply

- A selector or preference spans multiple backend contracts that share UI space but not execution semantics.
- One class of source can disappear through user action, such as deleting all BYOK keys, while another class remains always usable.
- A persisted “active” value already has strict downstream meaning and widening it would weaken type or security boundaries.
- Import/export needs to preserve a user-facing default that is broader than the backend execution target.

Do not apply this by adding fake engine adapters or by letting engine IDs reach `sendMessage('search')`. Engines should remain navigation-only unless the product explicitly changes their contract to return normalized responses.

## Examples

Deleting the last BYOK provider key should still leave a usable default source:

```ts
await clearKey('tavily');
const activeSourceId = await getActiveSourceId();
// Falls back through configured providers and finally to 'google'.
```

Selecting Google in options persists the UI default without changing the provider-only fallback:

```ts
await sendMessage('setActiveSource', 'google');
// activeSource = 'google'; activeProvider remains provider-only state.
```

Selecting a provider keeps legacy provider fallback and the UI default aligned:

```ts
await sendMessage('setActiveProvider', 'exa');
// activeProvider = 'exa'; activeSource = 'exa'.
```

Manual search on the extension page branches before worker search:

```ts
if (isEngineId(source)) {
  location.assign(getEngine(source).buildSerpUrl(query));
  return;
}

await sendMessage('search', { query, providerId: source });
```

The completed change was validated with `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd test` (30 files, 291 tests), and `npm.cmd run build`.

## Related

- `docs/solutions/architecture-patterns/serp-switch-bar-and-unified-source-model.md` — defines `SearchSource`, `SourceId`, provider/engine separation, and the `SourceSwitcher` host split that `activeSource` builds on.
- `docs/solutions/architecture-patterns/standardized-provider-engine-adapter-layers.md` — records the guardrail that `ProviderId` and `EngineId` stay separate, with `SourceId` as the only composition point.
- `docs/solutions/ui-bugs/provider-switch-current-query-and-async-state.md` — explains why provider selection remains a serialized worker-side write before provider search.
- `docs/solutions/architecture-patterns/dual-domain-storage-schema-versioning.md` — relevant when adding new config-domain storage keys such as `activeSource`.
- `docs/solutions/best-practices/theme-persistence-i18n-key-hygiene.md` — related settings/i18n hygiene; distinguish provider-only selection surfaces from source-level default-source surfaces.

Refresh candidates surfaced by this learning:

- `docs/solutions/architecture-patterns/dual-domain-storage-schema-versioning.md` still describes the config domain as four keys; update it to include `activeSource`.
- `docs/solutions/best-practices/theme-persistence-i18n-key-hygiene.md` should clarify the difference between provider-only active-provider surfaces and source-level active-source/default-source surfaces.
