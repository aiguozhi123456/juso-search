---
title: "Unified Source Model and Shadow-DOM SERP Switch Bar for Cross-Engine Quick-Switching"
date: 2026-07-08
last_updated: 2026-08-01
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
  - lib/source-groups.ts
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

1. **Do not merge engines into `ProviderId`.** Engines are a parallel concept with a parallel registry (`lib/engines/registry.ts`) and their own `EngineId` union. Merging would pollute the BYOK key/configured-status machinery and the `ProviderAdapter.search()` contract with members that satisfy neither. The `id` namespaces are disjoint by construction, so a combined `SourceId = ProviderId | EngineId | SiteEngineId` is safe without runtime tagging.

2. **Introduce a `SearchSource` view layer** (`lib/sources.ts`) that projects configured providers + all engines (and user-defined site engines) into one homogeneous `{ id, kind, label, supportsAnswer, favicon?, ... }` shape — the place where "configured providers only" (v1 rule) and "all engines always" meet, and where `isEngineId`/`isProviderId` guards narrow a `SourceId` back to the typed registry at the call site. Note: as of the source-group layout layer, this flat `SearchSource[]` is **no longer the seam the switcher renders**. `SourceSwitcher` now takes `sources` plus a `groupConfig` and projects a mixed `PinnedItem | GroupItem` sequence via `projectLayout` (`lib/source-groups.ts`); the flat `SearchSource[]` is the projection that layout layer consumes. Grouping is purely a layout layer over the same sources — it never re-hides or re-orders them. See [Source Groups: A Layout Layer Over the Source Projection](./source-group-layout-layer.md) for the layout seam.

3. **One switcher component, two hosts.** `SourceSwitcher` is presentational (`{ sources, activeId, onSelect, disabled }`); the host decides what selection *means*. On the Juso search page, a provider selection does the v1 serialized-write + re-search, and an engine selection does a current-tab `location.assign`. On the injected SERP bar, an engine selection is still a direct current-tab `location.assign` (engine → that SERP/home); a provider selection is **worker-mediated** — the bar sends an `openSearchPage` deep-link message to the background worker, which navigates the current tab via `browser.tabs.update` (a web page cannot `location.assign` to a `chrome-extension://` URL, `ERR_BLOCKED_BY_CLIENT`).

4. **SERP bar in a shadow DOM.** `createShadowRootUi` (WXT) isolates the bar's CSS from the host page and vice versa. Because the shadow root cannot read the extension's `tokens.css`, the bar ships its own self-contained token set (`entrypoints/shared/serp-bar-styles.ts`) keyed by `data-theme` on the shadow host, resolved from the user's `themePref` (auto resolves via `prefers-color-scheme`). The mount-time `data-engine` host attribute similarly carries engine-specific host integration into the shadow stylesheet, notably stacking behavior; see [Engine-Specific Shadow DOM Anchors for SERP SourceSwitcher](../ui-bugs/serp-bar-engine-specific-anchors.md) for the authoritative details.

5. **Deep link as the SERP→Juso handoff.** `search.html?provider=X&query=Y` (`lib/deep-link.ts`) carries state across the current-tab navigation. The search page mount effect parses it: `provider` is honored only if configured (else falls back to active), and a present `query` pre-fills and auto-fires one search. The handoff is **worker-mediated but stays in the current tab**: the SERP bar sends `openSearchPage` with the deep link to the background worker, which navigates the sender's tab via `browser.tabs.update` (`entrypoints/background.ts`) — no new tab, no page-to-page messaging. Engine choices still navigate directly via `location.assign`.

6. **Manifest surface stays minimal.** `lib/engines/scopes.ts` centralizes approved SERP hosts across eight engines（Google 5 个区域域名 + `www.bing.com` / `cn.bing.com` + `www.baidu.com` + `www.douyin.com` + `www.xiaohongshu.com` + `search.bilibili.com` + `yandex.com` / `yandex.ru` + `duckduckgo.com`）用于静态 content-script 和 favicon-resource 匹配。搜索主机不进 `host_permissions`；只有 provider API 主机需要这些权限，且不需要 `scripting`/`activeTab` 权限。

## Consequences

- **SERP DOM anchors are fragile.** Each engine owns an outer anchor and alignment strategy rather than relying on replaceable result internals. Those structures can still drift on redesign: mounting waits for the configured engine anchor and cancels stale waits on SPA navigation, but changed anchor or alignment targets can prevent or misplace the bar, so placement, alignment, and stacking need real-browser re-validation after major search-engine redesigns.
- **Three-place i18n hygiene.** Any new source label or bar string must land in `MSG` + both `messages.json` simultaneously or the i18n-parity test fails. The engine/google/bing keys demonstrate this invariant.
- **Provider behavior is unchanged.** The BYOK worker-only-key boundary, the `NormalizedSearchResponse` model, the cache keying, and the gateway are untouched — v2 is purely additive around a new view layer and a content-script host.
