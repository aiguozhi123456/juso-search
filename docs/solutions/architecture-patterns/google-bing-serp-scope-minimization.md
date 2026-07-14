---
title: "Minimize Google and Bing SERP Scope Without Breaking SPA Injection"
date: 2026-07-14
category: architecture-patterns
module: "SERP scope / content-script lifecycle"
problem_type: architecture_pattern
component: tooling
severity: medium
applies_when:
  - "Adding regional Google or Bing result pages to a Chrome MV3 content-script scope"
  - "Keeping content-script matches, web-accessible resource matches, and host permissions minimally scoped"
  - "Maintaining an injected SERP UI across search-engine SPA navigation"
related_components:
  - lib/engines/scopes.ts
  - lib/engines/google.ts
  - lib/engines/bing.ts
  - lib/engines/registry.ts
  - entrypoints/serp-bar.content.ts
  - wxt.config.ts
  - tests/engine-scopes.test.ts
  - tests/engines.test.ts
tags:
  - chrome-mv3
  - wxt
  - content-script
  - least-privilege
  - serp
  - google
  - bing
  - spa-navigation
---

# Minimize Google and Bing SERP Scope Without Breaking SPA Injection

## Context

The SERP Switch Bar runs inside conventional Search Engine result pages, so adding regional domains changes the extension's static site-access surface as well as runtime URL recognition. The product currently approves seven hosts: `www.google.com`, `www.google.com.hk`, `www.google.com.tw`, `www.google.co.jp`, `www.google.co.uk`, `www.bing.com`, and `cn.bing.com`. This is a product-specific allowlist based on the current Chinese/English audience and least-privilege policy, not a universal list of Google and Bing domains.

Google announced in 2025 that country-code Search domains would gradually redirect to `google.com`. There was therefore no product evidence for retaining all 187 historical Google domains. Doing so enlarged the injection and Chrome Web Store disclosure surface and produced a roughly 12 KB manifest, while Chrome match patterns cannot express arbitrary TLDs such as `google.*` safely.

Static matching is also broader than the runtime requirement. Chrome's `/search*` pattern includes `/searching`; hostname-only checks accept HTTP, non-default ports, and unrelated paths. Google and Bing are SPAs, so URL events, target anchors, and DOM replacement do not occur atomically: WXT can emit `wxt:locationchange` before `window.location` updates, and a synchronous mount can run before the destination anchor exists.

## Guidance

1. Keep the approved Search Engine hosts in one scope module. Derive engine recognition, content-script patterns, and favicon `web_accessible_resources` patterns from the same allowlist so those surfaces cannot drift independently.
2. Model injection, resource visibility, and privileged host access separately. Search hosts belong in static content-script and web-accessible-resource matches, but not in `host_permissions`; only the Tavily, Exa, and Stepfun API hosts need privileged host access.
3. Treat the static `/search*` pattern as an injection boundary, not the final business predicate. Runtime recognition must require HTTPS, the default port, pathname exactly `/search`, and exact membership in the approved hostname set. Do not use suffix matching, `endsWith`, arbitrary subdomain wildcards, or hostname-only checks.
4. Drive SPA state from the `newUrl` carried by `wxt:locationchange`, not from a possibly stale `window.location`. Remove the UI after leaving a canonical SERP and remount it when a supported SERP returns.
5. Wait for the engine-specific anchor before remounting. Give each navigation a revision, disconnect any prior `MutationObserver`, and allow only the latest revision to mount. Disconnect the observer after a successful mount, a newer navigation, or content-script invalidation.
6. Do not restore WXT `autoMount()` for Google/Bing anchor disappearance. Both engines may remove the old result subtree and insert a replacement with the same selector in one synchronous task; by the observer callback, only the replacement exists and disappearance detection can stall.
7. Test both source contracts and built artifacts. Source tests should lock the exact host allowlist, prove every configured host reaches the registry, reject forged and unapproved hosts, reject HTTP/non-default-port/non-SERP paths, and verify pattern uniqueness. A build-level check should confirm seven content-script matches, seven resource matches, and only three API `host_permissions`.

## Why This Matters

Chrome exposes three distinct security boundaries here. Content-script matches determine where extension code may execute, `web_accessible_resources.matches` determines which sites may load extension resources, and `host_permissions` grants broader cross-origin or privileged host capabilities. Treating all three as one list overstates permissions and makes store review harder.

Exact runtime recognition gives broad static match syntax a second gate. It prevents `/searching`, Maps, custom ports, unsupported country domains, and forged hosts such as `www.google.co.jp.example.com` from being treated as trusted result pages.

Explicit SPA lifecycle handling keeps the smaller scope reliable. Event-provided URLs avoid one-navigation-old engine/query state; anchor waiting avoids premature mounts; revisions and observer cleanup prevent stale navigations from mounting later. After the scope was reduced, type checking, linting, 309 tests, and the production build passed, while the generated manifest fell from roughly 12 KB to roughly 1 KB.

## When to Apply

- Adding or removing a Google or Bing regional domain from the SERP Switch Bar.
- Sharing one host registry between engine recognition, content-script matches, and resource matches in a WXT or Chrome MV3 extension.
- Enforcing an exact route when browser match patterns can express only a broader prefix.
- Mounting an extension UI into a third-party SPA that rebuilds its result DOM after history navigation.
- Reviewing extension site access, Chrome Web Store disclosure, or manifest size.
- Do not reuse this seven-host set as a global default; other products should choose hosts from their own audience, usage evidence, and permission policy.

## Examples

Derive the two static match surfaces from one host list:

```ts
export const SERP_HOSTS = [...GOOGLE_SERP_HOSTS, ...BING_SERP_HOSTS];
export const SERP_HOST_MATCH_PATTERNS = SERP_HOSTS.map((host) => `https://${host}/*`);
export const SERP_CONTENT_MATCH_PATTERNS = SERP_HOSTS.map((host) => `https://${host}/search*`);
```

Apply the stricter runtime predicate after static matching:

```ts
return url.protocol === 'https:'
  && url.port === ''
  && url.pathname === '/search'
  && approvedHosts.has(url.hostname);
```

Use the navigation event's destination URL and invalidate stale anchor waits:

```ts
ctx.addEventListener(window, 'wxt:locationchange', ({ newUrl }) => syncLocation(newUrl.href));

const revision = ++locationRevision;
stopWaitingForAnchor();
mountWhenAnchorReady(revision);
```

Representative rejected inputs include `http://www.google.com/search`, `https://www.google.com:8443/search`, `https://www.google.com/maps`, `https://www.google.com/searching`, `https://www.google.co.jp.example.com/search`, and the unapproved `https://www.google.fr/search`.

## Related

- [Unified Source Model and Shadow-DOM SERP Switch Bar for Cross-Engine Quick-Switching](./serp-switch-bar-and-unified-source-model.md)
- [Engine-Specific SERP Bar Injection Anchors for Google and Bing](../ui-bugs/serp-bar-engine-specific-anchors.md)
- [Standardize extension points, not shapes: parallel adapter layers](./standardized-provider-engine-adapter-layers.md)
- [Google: Here's an update on our use of country code top-level domains](https://blog.google/products-and-platforms/products/search/country-code-top-level-domains/)
- [Chrome Extensions: Match patterns](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns)
