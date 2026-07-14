---
title: "Unified Source Model and Shadow-DOM SERP Switch Bar for Cross-Engine Quick-Switching"
date: 2026-07-08
category: architecture-patterns
module: "engines / sources / content-script / search page"
problem_type: architecture_pattern
component: tooling
severity: medium
applies_when:
  - "Extending a single-select AI search provider switcher to also cover conventional web search engines"
  - "Injecting an extension UI into third-party search result pages without leaking styles in or out"
  - "Letting one switcher component serve both the extension's own page and an injected SERP bar"
  - "Handing off from a regular SERP to an extension page via a current-tab navigation carrying state"
related_components:
  - lib/engines/types.ts
  - lib/engines/registry.ts
  - lib/sources.ts
  - lib/deep-link.ts
  - components/SourceSwitcher.tsx
  - entrypoints/serp-bar.content.ts
  - entrypoints/shared/serp-bar-styles.ts
  - entrypoints/search/App.tsx
  - wxt.config.ts
tags:
  - chrome-mv3
  - wxt
  - content-script
  - shadow-dom
  - react
  - i18n
  - search
---

## Problem

v1 shipped a single-select AI provider switcher on a standalone extension page. The v1 plan explicitly punted "SERP overlay" and entry-point friction to phase two. Users searching on Google/Bing had no in-context bridge to the extension's AI providers, and the switcher candidate set was limited to the four BYOK AI providers.

## Context

- `ProviderId`/`ProviderAdapter` is bound to the BYOK key read-path (`storage.getKey`) and the `search(query, opts, key)` contract.
- Conventional engines have no API key, no synthesized answer, and no search method — they are pure navigation targets.
- The existing switcher (`ProviderSwitcher`) was a presentational component fed `ProviderAdapter[]`; the search page re-ran the query on switch via a serialized worker write.
- WXT auto-imports `defineContentScript`/`createShadowRootUi`; i18n (`t()`/`MSG`) is build-time bundled and works in any extension context; the i18n-parity structural test forces every new key into `MSG` + both `messages.json` files.

## Decision

1. **Do not merge engines into `ProviderId`.** Engines are a parallel concept with a parallel registry (`lib/engines/registry.ts`) and their own `EngineId` union. Merging would pollute the BYOK key/configured-status machinery and the `ProviderAdapter.search()` contract with members that satisfy neither. The `id` namespaces are disjoint by construction, so a combined `SourceId = ProviderId | EngineId` is safe without runtime tagging.

2. **Introduce a `SearchSource` view layer** (`lib/sources.ts`) that projects configured providers + all engines into one homogeneous `{ id, kind, label, supportsAnswer, favicon? }` shape. This is the single seam a switcher consumes, and the place where "configured providers only" (v1 rule) and "all engines always" meet. `isEngineId`/`isProviderId` guards narrow a `SourceId` back to the typed registry at the call site.

3. **One switcher component, two hosts.** `SourceSwitcher` is presentational (`{ sources, activeId, onSelect, disabled }`); the host decides what selection *means*. On the Juso search page, a provider selection does the v1 serialized-write + re-search, and an engine selection does a current-tab `location.assign`. On the injected SERP bar, any selection is a current-tab navigation (engine → that SERP/home; provider → Juso search page deep link).

4. **SERP bar in a shadow DOM.** `createShadowRootUi` (WXT) isolates the bar's CSS from the host page and vice versa. Because the shadow root cannot read the extension's `tokens.css`, the bar ships its own self-contained token set (`entrypoints/shared/serp-bar-styles.ts`) keyed by `data-theme` on the shadow host, resolved from the user's `themePref` (auto resolves via `prefers-color-scheme`).

5. **Deep link as the SERP→Juso handoff.** `search.html?provider=X&query=Y` (`lib/deep-link.ts`) carries state across the current-tab navigation. The search page mount effect parses it: `provider` is honored only if configured (else falls back to active), and a present `query` pre-fills and auto-fires one search. This avoids needing cross-tab messaging for the handoff.

6. **Manifest surface stays minimal.** Only `www.google.com` and `www.bing.com` enter `host_permissions` (country domains deferred); `web_accessible_resources` exposes only the two engine favicon SVGs to those matches; the content script is statically matched (no `scripting`/`activeTab` permission needed).

## Consequences

- **SERP DOM anchors are fragile.** Google/Bing result-container selectors (`#rcnt`, `#center_col`, `#rso`, `#b_results`) drift on redesign. A missing configured anchor prevents the bar from mounting, and the exact "above results" placement needs dogfood re-validation after major search-engine redesigns. This is called out as a known maintenance surface.
- **Three-place i18n hygiene.** Any new source label or bar string must land in `MSG` + both `messages.json` simultaneously or the i18n-parity test fails. The engine/google/bing keys demonstrate this invariant.
- **Provider behavior is unchanged.** The BYOK worker-only-key boundary, the `NormalizedSearchResponse` model, the cache keying, and the gateway are untouched — v2 is purely additive around a new view layer and a content-script host.
