---
title: "Source-Level Favicon Field Mirrored Across Engine and Provider Adapters"
date: 2026-07-23
category: design-patterns
module: "providers / engines / sources"
problem_type: design_pattern
component: tooling
severity: low
applies_when:
  - "Adding a per-source visual-identity field (icon, color, badge) that must appear identically for both providers and engines in the switcher"
  - "Backfilling an existing engine-only field onto providers (or vice versa) in the unified SearchSource model"
  - "Registering new static image assets so they load both on the extension page and inside a shadow-DOM injected bar"
related_components:
  - lib/providers/types.ts
  - lib/providers/base.ts
  - lib/providers/registry.ts
  - lib/sources.ts
  - components/SourceSwitcher.tsx
  - wxt.config.ts
tags:
  - adapter-pattern
  - favicon
  - chrome-mv3
  - web-accessible-resources
  - source-model
---

# Source-Level Favicon Field Mirrored Across Engine and Provider Adapters

## Context

`SearchSource` (`lib/sources.ts`) is the unified view layer the `SourceSwitcher` consumes for *both* AI providers (tavily/exa/stepfun/stepfun-plan) and conventional engines (google/bing/baidu/douyin/xiaohongshu). Originally only engines carried a `favicon: string` — an extension-relative SVG path rendered as a 14px `<img>` in the switcher. Providers rendered as bare text pills (plus an optional "no-answer" badge), so the switcher looked visually asymmetric: engine pills had brand marks, provider pills did not.

The gap was a missing *field on the adapter*, not a missing render path. `SourceSwitcher.tsx` already conditionally renders `<img src={resolveIconUrl(s.favicon)}>` for any source carrying a `favicon`, so the fix was pure data plumbing: give `ProviderAdapter` the same field engines have and thread it through the factory and projection. No render-side code changed.

## Guidance

To add or backfill a source-level metadata field that should be uniform across engines and providers, touch the pipeline in this order — each layer exists specifically to be the one place a cross-cutting source attribute is declared:

1. **Type contract** — `lib/providers/types.ts` `ProviderAdapter` (and the matching engine type `lib/engines/types.ts`). Mirror the field name and semantics exactly. Keep it a plain string path, not an imported asset or React component, so it survives the worker/extension/shadow-DOM boundaries unchanged.
2. **Factory** — `lib/providers/base.ts` `ProviderDefinition` + `defineProvider`. Add the field to the definition interface and pass it through in the returned object. This is the single seam every provider adapter funnels through, so declaring it here guarantees all four adapters carry it.
3. **Each adapter** — set the value per provider (`favicon: '/icons/<name>.svg'`). Co-branded providers may share one asset (stepfun + stepfun-plan both point at `stepfun.svg`).
4. **Projection** — `lib/sources.ts` `allSources()`. The provider branch originally omitted `favicon` (it was an engine-only concept); add `favicon: provider.favicon` so the field reaches `SearchSource.favicon`.
5. **Manifest (the easy-to-forget step)** — `wxt.config.ts` `web_accessible_resources.resources`. The SVG loads fine on the extension's own page via the dev server, but inside the injected SERP shadow DOM `runtime.getURL()` only resolves resources declared here. A new icon that renders on the search page but 404s in the SERP bar is the symptom of skipping this step.

```ts
// lib/providers/types.ts — ProviderAdapter gains the field engines already have
export interface ProviderAdapter {
  id: ProviderId;
  label: string;
  supportsAnswer: boolean;
  /** provider 品牌图标：扩展内相对路径（与 engine favicon 同语义），渲染处用 resolveIconUrl 解析。 */
  favicon: string;
  search(query: string, opts: SearchOptions, apiKey: string): Promise<NormalizedSearchResponse>;
}
```

```ts
// lib/sources.ts — provider branch of allSources() now carries favicon
if (provider) {
  return configuredProviderIds.includes(provider.id) ? [{
    id: provider.id,
    kind: 'provider',
    label: provider.label,
    supportsAnswer: provider.supportsAnswer,
    favicon: provider.favicon,
  }] : [];
}
```

```ts
// wxt.config.ts — without this, the icon loads on the extension page but 404s in the SERP shadow DOM
web_accessible_resources: [{
  resources: [
    'icons/google.svg', /* ...engines... */
    'icons/tavily.svg', 'icons/exa.svg', 'icons/stepfun.svg', // providers
  ],
  matches: SERP_HOST_MATCH_PATTERNS,
}],
```

## Why This Matters

The `SearchSource` view layer's whole purpose is to make providers and engines homogeneous to the switcher. Any field that exists on one kind but not the other re-introduces the asymmetry the layer was built to erase — and produces a presentational component with engine/provider branches that should not exist. By declaring the field on the adapter and threading it through the factory, a new source-level attribute reaches both kinds through the existing projection, and the render layer stays a single unconditional code path.

The adapter → factory → projection pipeline is the *discoverable* half. The `web_accessible_resources` manifest entry is the *hidden* half: it is not imported or referenced by any TypeScript module, so neither `tsc` nor the dev server's extension-page render will tell you it is missing. It only fails at runtime, inside the shadow DOM, on third-party SERP pages — the last place you want to discover a missing asset.

## When to Apply

- Adding any new visual-identity or metadata field to a source that should show in the switcher (icon, brand color key, verified badge).
- Backfilling an engine-only field onto providers, or vice versa.
- Adding a new static image asset that must be reachable from both the extension page and the shadow-DOM SERP bar.

## Examples

**Before** — provider pills had no icon; the `<img>` block was dead code for providers because `s.favicon` was `undefined`:

```tsx
{s.favicon && (<img className="source-icon" src={resolveIconUrl(s.favicon)} ... />)}
<span className="source-label">{t(s.label)}</span>
```

**After** — same JSX, unchanged, now renders for providers too because `allSources()` populates `favicon` for both kinds. Zero render-side edits.

Naming note: this source-level brand-icon field is named `favicon` to match the engine field and reuse the existing render path. It is deliberately distinct from `NormalizedResult.favicon` (a per-search-result URL on individual result cards) — same word, two unrelated concepts; do not confuse them.

## Related

- [Unified Source Model and Shadow-DOM SERP Switch Bar](../architecture-patterns/serp-switch-bar-and-unified-source-model.md) — the `SearchSource` view layer this backfills; its "v2 is purely additive" consequence no longer holds for the favicon dimension, which is now uniform across both kinds.
- [Standardized Provider/Engine Adapter Layers](../architecture-patterns/standardized-provider-engine-adapter-layers.md) — the `defineProvider` factory and adapter contract that make a new field cheap to thread through all providers at once.
