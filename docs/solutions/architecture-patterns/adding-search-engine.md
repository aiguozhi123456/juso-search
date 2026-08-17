---
title: Adding a conventional search engine to Juso — the full twelve-touchpoint registration pattern
date: 2026-08-13
last_updated: 2026-08-17
category: docs/solutions/architecture-patterns/
module: lib/engines
problem_type: architecture_pattern
component: tooling
severity: low
applies_when:
  - Adding a new conventional Search Engine (SERP-scraping engine) to the Chrome extension
  - Wiring a new engine into the registry, extractor, scopes, content script, schema, and i18n
  - Default-hiding a new engine via schema migration without breaking existing user state
tags: [search-engine, engine-adapter, dom-extractor, serp-scope, schema-migration, content-script, antispider-challenge, integration-checklist]
related_components:
  - lib/engines/registry
  - lib/engines/extractors
  - lib/engines/scopes
  - entrypoints/engine-extractor.content
  - wxt.config
  - lib/schema
  - lib/i18n
---

# Adding a conventional search engine to Juso: the full registration pattern

## Context

Juso (the `search` Chrome MV3 extension built on WXT + React + TypeScript)
ships a fixed set of "conventional" search engines — navigation-only SERP
targets that contrast with the BYOK AI *providers* (`lib/providers/`). An
engine has no key, no `answer`, and no `search()`. It only knows how to
build a SERP URL, recognize its own SERP, extract the query from it, tell
the SERP-injection content script where to mount the switch bar, and —
when an agent requests it — scrape ordinary result links from the rendered
DOM.

Through nine engines (`google`, `bing`, `baidu`, `douyin`, `xiaohongshu`,
`bilibili`, `yandex`, `duckduckgo`, and now `weixin`) the codebase has
accrued a **registration pattern that touches twelve files in one
cohesive change**. The pattern is not encoded as a single checklist in the
repo; it has to be reconstructed by diffing prior engine additions. During
the `weixin` addition (Sogou WeChat public-account article search) an
Oracle review caught three integration misses — a challenge-page regex
that silently excluded the new engine's anti-bot redirect host, a missing
website icon drift-lock copy, and a stale reference-doc comment — and one
substantive design decision (returning the Sogou redirect-wrapper URL
instead of the real `mp.weixin.qq.com` article URL) that had to be
documented for agent consumers.

This document captures the end-to-end pattern so the next engine addition
can follow it deliberately rather than by archaeology, and so the three
classes of miss caught during the `weixin` review (challenge-host
allowlist, drift-lock mirrors, agent-facing reference docs) are checked
explicitly.

## Guidance

### Treat engine registration as a twelve-touchpoint cohesive change

A conventional engine is not "one new file." It is a twelve-touchpoint
change across three capability layers (navigation, extraction, default
visibility) plus cross-cutting wiring (i18n, manifest, content-script host
allowlist, agent-facing reference docs, website drift-lock). The
`weixin` addition is the canonical recent example. Each touchpoint is
small, but omitting any one produces a silent failure mode that tests do
not always catch — the bar never mounts, the extractor never receives
messages on challenge pages, the favicon 404s in the SERP shadow root,
or an agent over-claims a capability the extractor does not provide.

The full touchpoint list, grouped by layer:

**Layer 1 — Navigation / SERP-mount (`lib/engines/`)**
1. `lib/engines/<id>.ts` — the engine adapter implementing `SearchEngine`
   (`buildSerpUrl`, `buildHomeUrl`, `matches`, `extractQuery`, `anchors`).
2. `lib/engines/types.ts` — add the id to the `EngineId` union (this is
   the identifier set, not a capability declaration — see
   *engine-capability-is-per-registry-not-per-id-union*).
3. `lib/engines/registry.ts` — register the adapter in the
   `Record<EngineId, SearchEngine>` map.
4. `lib/engines/scopes.ts` — declare the SERP host list
   (`<ID>_SERP_HOSTS`), add it to the `SERP_HOSTS` aggregate and to
   `SERP_CONTENT_MATCH_PATTERNS`, and export an `is<Id>SerpHostname`
   helper.

**Layer 2 — Agent extraction (`lib/engines/extractors/`)**
5. `lib/engines/extractors/<id>.ts` — the DOM extractor implementing
   `EngineExtractor` (`extract`, `pageState`, `hasNaturalResultsArea`).
6. `lib/engines/extractors/registry.ts` — register the extractor.

**Layer 4 — Default visibility (`lib/schema.ts`)**
7. `lib/schema.ts` — append a new `mergeHiddenFactory` migration entry
   and bump `CURRENT_SCHEMA_VERSION`.

**Cross-cutting wiring**
8. `entrypoints/engine-extractor.content.ts` — add a `hostsForEngine`
   case (so challenge/consent redirect pages on the new host are
   recognized) and add the id to the `isRequest` allowlist literal.
9. `wxt.config.ts` — add the favicon to the `resources` arrays of BOTH
   `web_accessible_resources` entries: the SERP-scope entry (matched
   against `SERP_HOST_MATCH_PATTERNS`) and the `<all_urls>` entry
   (which serves favicons to the selection-search popup on arbitrary
   pages). The two lists are kept identical; omitting the second entry
   makes the favicon 404 in the popup.
10. `lib/i18n.ts` + `public/_locales/{zh_CN,en}/messages.json` — add the
    `engine_<id>` message-name constant and its localized label.
11. `public/icons/<id>.svg` — the favicon, plus a mirror copy to
    `website/static/icons/` (the website drift-lock enforces byte
    equality; see *website-drift-lock-enforcement*).
12. Agent-facing reference doc — add a `## <id>` section to
    `public/agent-skill/reference/engines.md` documenting any
    non-obvious result-shape caveats (wrapper URLs, rich-metadata
    snippets, anti-bot behavior).

> A stale-comment touchpoint (e.g. the engine list in
> `lib/engines/extractors/unsupported.ts`) is not strictly required for
> behavior but should be updated in the same change so the next author
> does not read a stale "current engines" comment and omit the new id.

### Write the engine adapter as a self-contained module

Since the v3 refactor (see *standardized-provider-engine-adapter-layers*),
`SearchEngine` is a behavioral interface, not a data record. Each engine
owns its URL template, query parameter, host matcher, and anchor
candidates as private module constants. There are no free functions to
edit in `registry.ts` — registration is a single map entry.

The `weixin` adapter is the minimal example: a pure navigation target with
no extraction logic in the adapter file (extraction lives in the
extractor module).

```ts
// lib/engines/weixin.ts
import type { AnchorStrategy, SearchEngine } from './types';
import { isSerpUrl, isWeixinSerpHostname } from './scopes';

const SERP_URL_TEMPLATE = 'https://weixin.sogou.com/weixin?type=2&query={q}&ie=utf8';
const SERP_URL = new URL(SERP_URL_TEMPLATE);
const QUERY_PARAM = 'query';
// Anchor candidates (descending priority):
//   primary `#main + first`: inserted as #main's first child, inherits parent width.
//   fallback `.results + before`: inserted before the results container when #main is absent.
//   last resort `ul.news-list + before`: directly above the results list (most stable SSR element).
const ANCHORS: AnchorStrategy[] = [
  { selector: '#main', append: 'first' },
  { selector: '.results', append: 'before' },
  { selector: 'ul.news-list', append: 'before' },
];

export const weixinEngine: SearchEngine = {
  id: 'weixin',
  label: 'engine_weixin',
  favicon: '/icons/weixin.svg',
  buildSerpUrl(query: string): string {
    return SERP_URL_TEMPLATE.replace('{q}', encodeURIComponent(query));
  },
  buildHomeUrl(): string {
    return SERP_URL.origin + '/';
  },
  matches(url: string): boolean {
    try {
      return isSerpUrl(new URL(url), isWeixinSerpHostname, '/weixin');
    } catch {
      return false;
    }
  },
  extractQuery(url: string): string | null {
    try {
      const parsed = new URL(url);
      if (!isWeixinSerpHostname(parsed.hostname)) return null;
      return parsed.searchParams.get(QUERY_PARAM);
    } catch {
      return null;
    }
  },
  anchors: ANCHORS,
};
```

Two conventions worth noting from this example:

- **Encoding parameter.** Sogou defaults to GBK encoding; `ie=utf8` is
  mandatory in the template or Chinese queries arrive mojibake. When an
  engine's default encoding is not UTF-8, the encoding parameter is part
  of the URL contract, not an afterthought.
- **`type` parameter.** `type=2` searches articles; `type=1` searches
  accounts and has a different DOM. The adapter fixes `type=2` because
  the extractor is written for the article DOM. Document this so a future
  author does not "helpfully" parameterize `type`.

### Keep scopes centralized: hosts, match patterns, and the challenge regex

`lib/engines/scopes.ts` is the single source of truth for which hosts are
SERP hosts, which path prefixes are canonical SERP routes, and —
critically — which URL path patterns count as challenge/consent
redirects that the extractor content script must still be allowed to
receive messages on.

For each new engine:

1. Add a `<ID>_SERP_HOSTS` constant.
2. Spread it into `SERP_HOSTS` (this drives
   `SERP_HOST_MATCH_PATTERNS`, which is consumed by `wxt.config.ts` for
   `web_accessible_resources.matches` and by
   `ENGINE_EXTRACTOR_CONTENT_MATCH_PATTERNS`).
3. Add a `serpContentMatchPattern(host, '<path>')` entry to
   `SERP_CONTENT_MATCH_PATTERNS` (the canonical SERP route, used for
   bar injection — *not* for extractor message receipt).
4. Export an `is<Id>SerpHostname` helper backed by a `Set`.

```ts
// lib/engines/scopes.ts
export const WEIXIN_SERP_HOSTS = ['weixin.sogou.com'] as const;
// ...spread into SERP_HOSTS...
export const SERP_CONTENT_MATCH_PATTERNS = [
  // ...existing entries...
  ...WEIXIN_SERP_HOSTS.map((host) => serpContentMatchPattern(host, '/weixin')),
];
// ...Set + helper...
const weixinSerpHosts = new Set<string>(WEIXIN_SERP_HOSTS);
export function isWeixinSerpHostname(hostname: string): boolean {
  return weixinSerpHosts.has(hostname);
}
```

#### The challenge-host regex is the highest-blast-radius touchpoint

The single most dangerous integration miss during the `weixin` addition
was **BUG-1 (Medium)**: the `/antispider/` challenge page was
unreachable by the extractor content script.

The content script (`entrypoints/engine-extractor.content.ts`) matches
`ENGINE_EXTRACTOR_CONTENT_MATCH_PATTERNS` (= `SERP_HOST_MATCH_PATTERNS`),
so it *is* injected on `weixin.sogou.com/antispider/...`. But when the
background orchestrator sends the `juso:extract-engine-results` message,
the content script's `matchesRequestUrl` guard accepts the message only
if either (a) the URL is a canonical SERP route for that engine, or (b)
`isEngineChallengeOrConsentUrlForHost(url, hostsForEngine(engineId))`
returns true.

`isEngineChallengeOrConsentUrl` delegates to a single regex:

```ts
// lib/engines/scopes.ts — BEFORE the fix
return /\/(?:sorry|captcha|challenge|consent)(?:\/|$)/i.test(url.pathname);
```

Sogou's anti-bot redirects to `/antispider/`, which is **not** in that
alternation. The result: the content script was injected on the
challenge page but silently ignored the extraction message (the guard
returned `undefined`), the orchestrator's 4-second wait timed out, and
the agent received a `timeout` instead of the correct `challenge`
classification. The extractor's own `pageState` — which *does* detect
`/antispider/` — was never reached.

The fix is one word, but it must be remembered per engine:

```ts
// lib/engines/scopes.ts — AFTER the fix
return /\/(?:sorry|captcha|challenge|consent|antispider)(?:\/|$)/i.test(url.pathname);
```

**Lesson:** when an engine has a site-specific challenge/consent/bot
redirect path, that path *must* be added to the
`isEngineChallengeOrConsentUrl` alternation. The content-script
injection surface (`SERP_HOST_MATCH_PATTERNS`) is broad enough to cover
the redirect, but the message-receipt guard is narrow. A missing
alternation token degrades a fast `challenge` signal into a slow
`timeout` — the worst kind of failure for an agent, because it looks like
a hang rather than an anti-bot reaction.

### Write the extractor with three signals: pageState, hasNaturalResultsArea, extract

The `EngineExtractor` contract (in
`lib/engines/extractors/types.ts`) is three methods:

```ts
export interface EngineExtractor {
  extract(document: Document, pageUrl: string): EngineResult[];
  pageState(document: Document, pageUrl: string): EngineExtractionErrorKind | null;
  hasNaturalResultsArea(document: Document): boolean;
}
```

- `pageState` runs first. If it returns `'challenge'` (or `'consent'`),
  the orchestrator short-circuits with that error kind — no extraction
  attempted. Return `null` to proceed.
- `hasNaturalResultsArea` gates the "are we on the right page at all"
  check. Returning `false` produces an `unsupported-layout` error.
- `extract` runs only if the first two pass, and returns the result
  array (title, url, snippet per item).

The `weixin` extractor demonstrates multi-signal challenge detection and
a non-obvious URL strategy.

#### Multi-signal challenge detection

Sogou's anti-bot surfaces in three independent ways; check all three so
that a partial signal (e.g. the CSS loaded but the URL hasn't changed
yet) is still caught:

```ts
// lib/engines/extractors/weixin.ts
pageState(document, pageUrl): EngineExtractionErrorKind | null {
  // Signal 1: URL path — redirected to /antispider/.
  if (/\/antispider(?:\/|$)/i.test(new URL(pageUrl, 'https://invalid.local').pathname)) return 'challenge';
  // Signal 2: body text — captcha / abnormal-visit markers (Chinese).
  const bodyText = document.body?.textContent ?? '';
  if (/请输入验证码|此验证码用于确认|异常访问|用户您好/i.test(bodyText)) return 'challenge';
  // Signal 3: anti-bot stylesheet loaded.
  if (document.querySelector('link[href*="anti.min.css" i]')) return 'challenge';
  return null;
},
```

The URL-path signal and the `isEngineChallengeOrConsentUrl` regex (from
`scopes.ts`) are **two different checks on the same path**. The scopes
regex gates *message receipt* on the content-script side; the
`pageState` signal gates *extraction* once the message is received. Both
must recognize `/antispider/`, or the system reports `timeout` instead
of `challenge`. They are intentionally separate because `pageState` may
also detect challenge conditions that have not (yet) changed the URL
(the text and CSS signals).

#### Returning a wrapper URL when the real URL is not in the DOM

This is the substantive design decision from the `weixin` work, and it
generalizes to any engine whose SERP obfuscates or encrypts the real
result URL server-side.

Sogou WeChat search embeds the article link as a Sogou redirect wrapper
(`weixin.sogou.com/link?url=…`). The real `mp.weixin.qq.com` URL is
server-side encrypted and is **not** present in the SERP DOM — it cannot
be decoded client-side without following the redirect. The extractor
returns the wrapper URL as-is:

```ts
// lib/engines/extractors/weixin.ts
extract(document, pageUrl): EngineResult[] {
  return [...document.querySelectorAll(ITEM_SELECTOR)].flatMap((item) => {
    const anchor = item.querySelector<HTMLAnchorElement>(TITLE_SELECTOR);
    const title = titleText(anchor);
    // Sogou redirect wrapper (weixin.sogou.com/link?url=…), resolved to absolute.
    const url = anchor ? absoluteHttpUrl(anchor.getAttribute('href'), pageUrl) : null;
    if (!title || !url) return [];
    const snippet = snippetText(item.querySelector(SNIPPET_SELECTOR)) || buildWeixinSnippet(item);
    return [{ title, url, snippet }];
  });
},
```

This matches SearXNG's behavior. The wrapper resolves to the real
article when opened in a browser, but an agent that fetches the URL via
`web_fetch` will receive Sogou's redirect HTML, not the article content.
That caveat **must** be documented in the agent-facing reference doc
(`public/agent-skill/reference/engines.md`) so agents do not treat the
returned `url` as a directly fetchable article URL:

```markdown
## `weixin`

Results are scraped from `weixin.sogou.com/weixin?type=2` (article search;
`type=1` would search accounts, a different DOM). The `url` field is a
**Sogou redirect wrapper** (`weixin.sogou.com/link?url=…`), not the real
`mp.weixin.qq.com` article URL — the real URL is server-side encrypted and
not present in the SERP DOM. The wrapper resolves to the article when opened
in a browser, but an agent fetching it via `web_fetch` will get Sogou's
redirect HTML, not the article content. `snippet` is the article summary
when available, or falls back to rich metadata (`公众号: … · 时间: …`).
Anti-bot is aggressive: expect `challenge` errors (redirect to
`/antispider/`) frequently in the automated flow.
```

**General rule:** when an extractor returns a URL that is not the
canonical content URL (redirect wrappers, synthesized URLs, encoded
proxies), document the indirection in `engines.md` in the same change.
An agent that trusts `result.url` to be fetchable content will otherwise
silently receive the wrong page.

### Add the default-hidden schema migration as a versioned, idempotent step

New engines are registered but **default-hidden** from the quick-switch
bar so the bar does not grow out of the box. This requires a real data
migration (not a no-op version bump) because a read-side merge into an
explicit user preference list would not be idempotent — see
*dual-domain-storage-schema-versioning* for why the getter-fallback
shortcut does not apply here.

The `weixin` migration is v8→v9, following the same shape as the
yandex/duckduckgo migration (v5→v6):

```ts
// lib/schema.ts
export const CURRENT_SCHEMA_VERSION = 9;

// v8→v9: Sogou WeChat engine added — default-hidden (appears in management
// UI but not the quick-switch bar; user shows it manually).
const DEFAULT_HIDDEN_ENGINE_IDS_V5: readonly string[] = ['weixin'];

export const migrations: Migration[] = [
  // ...v1 through v7...
  { version: 8, migrate: mergeHiddenFactory(DEFAULT_HIDDEN_ENGINE_IDS_V5) },
];
```

`mergeHiddenFactory` produces an idempotent merge: it appends the new id
to `sourceHidden` only if not already present, preserving first-seen
order. Once a user manually unhides the engine (removing the id from
`sourceHidden`), the migration never re-adds it, because the version
stamp has advanced and the migration chain does not re-run.

#### Migration ordering: append after AI-engine ids

The migration appends `weixin` to `sourceHidden` **after** the v6→v7
AI-engine migration (`DEFAULT_HIDDEN_AI_ENGINE_IDS`) has already run.
This ordering is load-bearing: the v7 migration merges the five AI
engine ids (deepseek, chatgpt, gemini, doubao, grok) into
`sourceHidden`, and the v9 migration appends `weixin` after them. Because
`mergeHiddenFactory` preserves order and deduplicates, the final
`sourceHidden` for a fresh v0→v9 upgrade is:

```
[..., <ai engine ids from v7>, 'weixin']
```

The order does not affect behavior (the quick-switch bar visibility is a
set membership test), but it does mean the v9 migration must not be
inserted before v7 in the chain — migrations run in ascending `version`
order, and a v9 entry placed at `version: 6` would run before the AI
engine ids exist in the union and would still be correct (the merge is
order-independent), but the version-numbering convention is that each
migration advances `version → version + 1` in the order features were
added. Keep the chain monotonic in both `version` and feature-addition
chronology.

### Wire the content-script host allowlist and request guard

The extractor content script (`entrypoints/engine-extractor.content.ts`)
is the bridge between the background orchestrator and the SERP DOM. Two
per-engine additions are required:

1. **`hostsForEngine` case** — so
   `isEngineChallengeOrConsentUrlForHost(url, hostsForEngine(engineId))`
   can recognize challenge redirects on the new engine's host.
2. **`isRequest` allowlist literal** — the `engineId` field validation
   includes a hardcoded `.includes([...])` literal array; the new id
   must be added or the message is silently rejected as malformed.

```ts
// entrypoints/engine-extractor.content.ts
function hostsForEngine(engineId: EngineId): readonly string[] {
  switch (engineId) {
    case 'google': return GOOGLE_SERP_HOSTS;
    // ...
    case 'weixin': return WEIXIN_SERP_HOSTS;
  }
}

function isRequest(value: unknown): value is Request {
  // ...
  && ['google', 'bing', 'baidu', 'douyin', 'xiaohongshu', 'bilibili',
      'yandex', 'duckduckgo', 'weixin'].includes((value as Request).engineId)
  // ...
}
```

> The `isRequest` literal is a runtime guard, not a type check —
> TypeScript's `EngineId` narrowing does not apply across the
> `unknown`-typed message boundary. Forgetting to add the id here means
> the orchestrator's message is dropped silently and the 4-second wait
> times out. This is the same failure mode as BUG-1 (a narrowed guard
> excluding the new engine) but at a different layer.

### Mirror the favicon to the website drift-lock directory

The website (`website/`) mirrors certain extension assets to enforce
that the public marketing site and the extension stay in sync. The
`website/static/icons/` directory must contain a byte-identical copy of
`public/icons/<id>.svg`, or the website drift-lock test fails (see
*website-drift-lock-enforcement*). This is a copy, not a symlink,
because the website is a static Hugo build.

For `weixin`, this was INT-1 (Low) in the Oracle review — the icon was
added to `public/icons/` but not mirrored. The fix:

```
public/icons/weixin.svg  →  website/static/icons/weixin.svg  (byte copy)
```

### Register the favicon in web_accessible_resources

Favicons load inside the SERP shadow root (the extension injects a
shadow DOM onto the host SERP page), so they must be listed in
`web_accessible_resources` in `wxt.config.ts` or they 404:

```ts
// wxt.config.ts
web_accessible_resources: [
  {
    resources: [
      // ...
      'icons/weixin.svg',
      // ...
    ],
    matches: SERP_HOST_MATCH_PATTERNS,
  },
  {
    // The selection-search popup renders favicons on any page.
    resources: [ /* …the same icon list… */ ],
    matches: ['<all_urls>'],
  },
],
```

### Add the i18n label in both locales

The engine label is a message-name constant in `lib/i18n.ts` (`MSG`)
plus a `messages.json` entry in both `zh_CN` and `en`. The `label` field
on the engine adapter is the message *name* (`engine_weixin`), not the
displayed string — the renderer resolves it via `t()`.

```ts
// lib/i18n.ts
export const MSG = {
  // ...
  engine_weixin: 'engine_weixin',
  // ...
} as const;
```

```jsonc
// public/_locales/zh_CN/messages.json
"engine_weixin": { "message": "搜狗公众号" },
// public/_locales/en/messages.json
"engine_weixin": { "message": "WeChat Articles" },
```

## Why This Matters

The twelve-touchpoint pattern is small at each touchpoint but brittle in
aggregate. The three miss classes caught during the `weixin` review each
illustrate a distinct failure mode that the test suite did not cover:

- **BUG-1 (challenge regex, Medium):** A single missing alternation token
  in a shared regex (`scopes.ts:96`) silently downgraded a `challenge`
  signal into a `timeout` for one engine, while every other engine
  continued to work. The test suite mocked `fetch` and storage but did
  not exercise the real Sogou `/antispider/` redirect flow, so the miss
  was invisible until an agent actually hit the anti-bot page. The
  lesson: a broad injection surface (`SERP_HOST_MATCH_PATTERNS`) is
  necessary but not sufficient — the *message-receipt guard* is a
  second, narrower surface that must be updated per engine, and a
  third, narrower still *extraction* check (`pageState`) must also
  recognize the same paths. Three checks, one concern; all three must
  agree or the error taxonomy degrades.
- **INT-1 (website icon drift, Low):** The drift-lock test exists
  precisely to catch this, but only if the author knows to run
  `website` tests. The fix is trivial (copy a file), but the miss
  signals that the "mirror to website" step is easy to forget because
  it lives outside the `lib/` + `public/` tree that the author is
  primarily editing.
- **INT-2/INT-3 (reference doc + stale comment, Low):** Neither affects
  runtime behavior, but both affect the next author and the agent
  consumer. The `engines.md` caveat about wrapper URLs is the only
  place an agent learns that `result.url` for `weixin` is not a directly
  fetchable article URL; omitting it causes silent wrong-page fetches.
  The stale comment in `unsupported.ts` listing engines without
  `weixin` would mislead the next author into thinking the extractor
  registry is incomplete.

Following the pattern deliberately — and checking all twelve
touchpoints plus the three review-derived miss classes in one cohesive
change — keeps the engine registry internally consistent across
layers and prevents the "works in tests, fails for agents" gap that
characterized the `weixin` review findings.

## When to Apply

- **Adding any new conventional search engine** to the `EngineId` union
  (navigation-only SERP target, no BYOK key). The pattern applies in
  full: all twelve touchpoints plus the three review-derived checks
  (challenge regex token, website icon mirror, reference-doc caveat +
  stale-comment update).
- **Adding a new AI provider** (`lib/providers/`) — *do not* use this
  pattern. Providers have their own adapter layer
  (`ProviderAdapter.search`, BYOK key wiring, `defineProvider` factory)
  and do not touch `EngineId`, `scopes.ts` SERP hosts, or the
  engine-extractor content script. See
  *standardized-provider-engine-adapter-layers* for the provider-side
  parallel.
- **Elevating a navigation-only engine to support agent extraction** —
  only touchpoints 5 and 6 (extractor module + extractor registry) and
  the reference doc (12) apply, plus a `pageState` challenge check if
  the site has anti-bot. The `EngineId` union, scopes, schema
  migration, and i18n are already in place from the navigation-only
  addition.
- **Adding a site-specific challenge/consent redirect path** to an
  existing engine (e.g. a site introduces a new captcha URL) — update
  the `isEngineChallengeOrConsentUrl` alternation in `scopes.ts` and the
  `pageState` URL signal in the extractor, in the same change. These
  two are a pair; updating one without the other reintroduces the
  BUG-1 `timeout`-instead-of-`challenge` failure mode.
- **Reviewing a PR that adds an engine** — verify all twelve
  touchpoints are present, that the challenge regex recognizes the
  new engine's anti-bot path (if any), that the favicon is mirrored to
  `website/static/icons/`, and that `engines.md` documents any
  non-obvious result-shape caveats.

## Examples

### The `weixin` addition: all twelve touchpoints

| # | Touchpoint | File | Change |
|---|-----------|------|--------|
| 1 | Engine adapter | `lib/engines/weixin.ts` | New: `weixinEngine` with URL template `…/weixin?type=2&query={q}&ie=utf8`, 3-tier anchors |
| 2 | EngineId union | `lib/engines/types.ts` | Added `'weixin'` to the union |
| 3 | Engine registry | `lib/engines/registry.ts` | `weixin: weixinEngine` |
| 4 | Scopes | `lib/engines/scopes.ts` | `WEIXIN_SERP_HOSTS`, match pattern `/weixin`, `isWeixinSerpHostname`, **and `antispider` added to the challenge regex** (BUG-1 fix) |
| 5 | Extractor | `lib/engines/extractors/weixin.ts` | New: `weixinExtractor` with 3-signal `pageState`, wrapper-URL `extract`, rich-metadata snippet fallback |
| 6 | Extractor registry | `lib/engines/extractors/registry.ts` | `weixin: weixinExtractor` |
| 7 | Schema migration | `lib/schema.ts` | v8→v9: `mergeHiddenFactory(['weixin'])`, `CURRENT_SCHEMA_VERSION = 9` |
| 8 | Content-script allowlist | `entrypoints/engine-extractor.content.ts` | `hostsForEngine` case + `isRequest` literal |
| 9 | Manifest resources | `wxt.config.ts` | `'icons/weixin.svg'` in `web_accessible_resources` — note the `<all_urls>` entry postdates weixin; new engines must hit both entries |
| 10 | i18n | `lib/i18n.ts` + `_locales/{zh_CN,en}/messages.json` | `engine_weixin` → "搜狗公众号" / "WeChat Articles" |
| 11 | Favicon + mirror | `public/icons/weixin.svg` + `website/static/icons/weixin.svg` | New SVG, byte-identical copy (INT-1 fix) |
| 12 | Agent reference doc | `public/agent-skill/reference/engines.md` | `## weixin` section documenting wrapper-URL caveat + anti-bot (INT-2 fix) |
| — | Stale comment | `lib/engines/extractors/unsupported.ts` | Added `weixin` to the "current engines" comment (INT-3 fix) |

### The challenge regex fix (BUG-1)

**Before** — `/antispider/` not recognized, content script ignores the
extraction message on Sogou's anti-bot page, orchestrator times out:

```ts
return /\/(?:sorry|captcha|challenge|consent)(?:\/|$)/i.test(url.pathname);
```

**After** — `/antispider/` recognized, content script receives the
message, `pageState` returns `'challenge'`, orchestrator returns the
correct error kind immediately instead of after a 4-second timeout:

```ts
return /\/(?:sorry|captcha|challenge|consent|antispider)(?:\/|$)/i.test(url.pathname);
```

### The wrapper-URL decision and its documentation

**The extractor** returns the Sogou redirect wrapper, not the real
article URL (which is server-side encrypted and absent from the DOM):

```ts
const url = anchor ? absoluteHttpUrl(anchor.getAttribute('href'), pageUrl) : null;
// url is now weixin.sogou.com/link?url=…, not mp.weixin.qq.com/s/…
```

**The reference doc** (`engines.md`) makes the indirection explicit so
agents do not treat `result.url` as directly fetchable article content:

```markdown
The `url` field is a **Sogou redirect wrapper** (`weixin.sogou.com/link?url=…`),
not the real `mp.weixin.qq.com` article URL — the real URL is server-side
encrypted and not present in the SERP DOM. The wrapper resolves to the
article when opened in a browser, but an agent fetching it via `web_fetch`
will get Sogou's redirect HTML, not the article content.
```

### The v8→v9 default-hidden migration

```ts
// lib/schema.ts
export const CURRENT_SCHEMA_VERSION = 9;

// v8→v9: 搜狗微信公众号引擎加入快切栏——默认隐藏（中文二线引擎，开箱不膨胀快切栏）。
const DEFAULT_HIDDEN_ENGINE_IDS_V5: readonly string[] = ['weixin'];

export const migrations: Migration[] = [
  // ...v1→v7...
  // v7→v8: serpBarPosition 'top' redefinition (omitted for brevity).
  { version: 7, migrate: (config) => config.serpBarPosition === 'top' ? { ...config, serpBarPosition: 'inline' } : config },
  // v8→v9: weixin default-hidden. Runs AFTER v6→v7 AI-engine migration,
  // so 'weixin' is appended after the AI engine ids in sourceHidden.
  { version: 8, migrate: mergeHiddenFactory(DEFAULT_HIDDEN_ENGINE_IDS_V5) },
];
```

### Anchor inference without real-device probing

The `weixin` anchors (`#main`, `.results`, `ul.news-list`) were inferred
from documented page structure and cross-validated against six
production implementations (WechatSogou, RSSHub, SearXNG, SearchOS,
feedgrab, BasicWebCrawler), **not** probed on a live page. This
contrasts with the `duckduckgo` addition, where anchors were probed via
a DevTools snippet on the real SERP (see
*duckduckgo-react-serp-anchors-and-real-device-probing*). When real-device
probing is not available, document the inference method in the engine
adapter's comment block so a future maintainer knows the anchors are
unverified and can probe them if the bar fails to mount:

```ts
// lib/engines/weixin.ts
// Anchor candidates (descending priority):
//   primary `#main + first`: inserted as #main's first child, inherits parent width.
//   fallback `.results + before`: inserted before the results container when #main is absent.
//   last resort `ul.news-list + before`: directly above the results list (most stable SSR element).
```

If the bar silently fails to mount on the real `weixin.sogou.com` SERP,
the first debugging step is to probe the live DOM with the labeled-bar
snippet technique and correct the anchor list — the same recovery
documented for DuckDuckGo.

## Related

- [Standardized provider/engine adapter layers](../architecture-patterns/standardized-provider-engine-adapter-layers.md) — the abstract "add a route-specific navigation engine" checklist (§487-505) that this doc instantiates for `weixin`
- [Engine capability is layered per registry](../architecture-patterns/engine-capability-is-per-registry-not-per-id-union.md) — the four-layer capability model (navigation / extraction / agent-vocabulary / default-visibility); the twelve touchpoints map onto these layers
- [Yandex canonical SERP redirect antibot](../integration-issues/yandex-canonical-serp-slash-redirect-antibot.md) — established the "emit canonical URLs only" rule that the weixin wrapper-URL strategy applies
- [Douyin automated-tab antibot no-results](../integration-issues/douyin-automated-tab-antibot-no-results.md) — same anti-bot/challenge problem class; established the "document the limitation at the skill surface" resolution pattern
- [DuckDuckGo React SERP anchors](../ui-bugs/duckduckgo-react-serp-anchors-and-real-device-probing.md) — codified the "probe real SERP, do not trust scraping guides" anchor strategy that weixin's unverified anchors defer to
- [Google/Bing SERP scope minimization](../architecture-patterns/google-bing-serp-scope-minimization.md) — governs the wxt.config / host_permissions / content-script match integration
- [Website drift-lock enforcement](../architecture-patterns/website-drift-lock-enforcement.md) — the CI test that catches the website icon mirror miss (INT-1)
- [Dual-domain storage schema versioning](../architecture-patterns/dual-domain-storage-schema-versioning.md) — governs the default-hidden schema migration pattern
