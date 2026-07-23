---
title: Google SERP extractor misses organic results nested under ULSxyf wrappers
date: 2026-07-23
category: logic-errors
module: engine-extractors
problem_type: logic_error
component: assistant
symptoms:
  - "engine-search google returns no-results for some queries while Bing and Baidu succeed"
  - "Some Google queries return only one result when max-results is higher"
  - "Real Chrome DOM has many h3 organic links under #rso but extractor yields zero"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags:
  - google
  - serp
  - engine-extractor
  - dom-structure
  - agent-bridge
  - engine-search
---

# Google SERP extractor misses organic results nested under ULSxyf wrappers

## Problem

After the Agent Bridge could claim successfully, Google `engine-search` still failed on some queries. A Chinese World Cup query returned `no-results` while Bing/Baidu returned full organic lists. Other Google queries returned only one result when more were requested.

## Symptoms

- `engine-search "2026世界杯" --engine google` → `{ "error": "no-results" }`
- Same bridge path with Bing/Baidu → multiple `{ title, url, snippet }` results
- English queries like `OpenAI GPT-5` sometimes returned only one result despite `max-results 5`
- Live Chrome console dump showed many `h3` nodes under `#rso`, each with external hrefs

## What Didn't Work

- Treating this as a bridge protocol failure: claim/complete already succeeded after the Service Worker `fetch` fix
- Blaming Chinese locale alone: `天气预报` returned Google results
- Fetching Google HTML via automated web fetch: Google served a bot interstitial (`SG_REL`), not real SERP DOM
- Relying only on fixtures shaped as `#rso > .g` direct children: production DOM no longer matched that shape

## Solution

Live DOM for the failing query looked like:

```text
#rso
  └── div.ULSxyf[data-hveid]
        └── div.tF2Cxc (organic result with h3 + a)
        └── div.tF2Cxc ...
```

Old extractor logic:

1. Selected only direct children: `#rso > .g, #rso > .MjjYud, #rso > div[data-hveid]`
2. Discarded any block that matched **or contained** special selectors, including `.ULSxyf`
3. Because Google wrapped **all** organic results in one `.ULSxyf` container, every result was discarded → `no-results`

New approach in `lib/engines/extractors/google.ts`:

1. Start from every `h3` under `#rso` / `#search` / `#center_col`
2. Walk up to the nearest result block: `.g, .MjjYud, div[data-hveid], .tF2Cxc`
3. Filter special blocks only with `block.matches(...)` on the result block itself (no descendant `querySelector` co-punishment)
4. Remove `.ULSxyf` from the special-block blacklist (it is now a generic wrapper, not only a featured card)
5. Keep `[data-attrid]` and other true special markers for AI overview / knowledge / ads
6. Deduplicate by seen result block before collecting title/url/snippet

Add fixtures and tests:

- `tests/fixtures/engines/google-nested-wrapper.html`
- `tests/fixtures/engines/google-nested-special.html`
- regression cases in `tests/engine-extractors.test.ts`

## Why This Works

Google SERP class names and nesting change frequently. Organic identity is more stable at the `h3` + external anchor pair than at a direct-child class under `#rso`. Filtering special content only on the leaf result block preserves organic siblings that share a generic wrapper with AI/knowledge modules.

## Prevention

- When SERP extractors fail with `no-results` but `#rso` exists, dump direct children and all `h3` ancestors in Chrome DevTools before changing selectors
- Prefer h3-driven discovery over brittle direct-child class lists
- Keep paired fixtures: nested wrappers that must extract, and nested special blocks that must still be filtered
- After bridge E2E changes, re-run multi-engine smoke queries (Google + Bing + Baidu, Chinese + English)

## Related Issues

- `docs/solutions/runtime-errors/service-worker-fetch-illegal-invocation.md` — bridge had to work first
- `docs/solutions/architecture-patterns/agent-skill-localhost-capability-bridge.md` — engine-search is a bridge action over real browser tabs
- `docs/solutions/logic-errors/engine-search-orchestration-errors-and-baidu-url-extraction.md` — later engine-search reliability: orchestration error kinds vs page-state, Baidu local URL fallbacks
