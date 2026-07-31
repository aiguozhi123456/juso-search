---
title: Yandex trailing-slash SERP URL triggered an antibot redirect loop and a human-verification wall on every navigation
date: 2026-07-31
category: integration-issues
module: engines
problem_type: integration_issue
component: search
symptoms:
  - "Every navigation to the Yandex SERP from the extension hit a human-verification (captcha) challenge before showing results"
  - "After passing verification, Yandex rewrote the URL from /search/?text=... to /search?text=...&utm_referrer=...&lr=87 (dropping the trailing slash and appending trackers)"
  - "Agent-bridge engine-search on Yandex returned error 'extract-failed' (orchestration), not a page-state error like 'challenge'"
  - "DuckDuckGo engine-search on the same code path worked fine, returning clean organic results — so the failure was Yandex-specific"
root_cause: wrong_api
resolution_type: code_fix
severity: high
tags:
  - yandex
  - serp
  - antifraud
  - canonical-url
  - redirect
  - engine-search
  - agent-bridge
---

# Yandex trailing-slash SERP URL triggered an antibot redirect loop and a human-verification wall on every navigation

## Problem

A newly added Yandex search engine adapter built SERP URLs as
`https://yandex.com/search/?text={q}` (path `/search/`, **with** trailing slash).
In a real browser every navigation to that URL hit a Yandex human-verification
challenge, and the agent-bridge `engine-search` action failed with
`extract-failed` instead of returning results.

## Symptoms

- Real-browser navigation: a captcha / "are you a human" interstitial appeared on
  **every** jump to Yandex, not occasionally.
- After solving it, the address bar showed Yandex had rewritten the URL to the
  no-slash form plus tracker params:
  `https://yandex.com/search?text=%E6%B5%8B%E8%AF%95&utm_referrer=https%3A%2F%2Fduckduckgo.com%2F&lr=87`.
- Agent bridge: `engine-search ... --engine yandex` returned
  `{"engine":"yandex","query":"react hooks","error":"extract-failed"}` (an
  **orchestration** error), while `--engine duckduckgo` and `--engine google`
  returned full result lists on the identical code path.

## What Didn't Work

- **Guessing the SERP DOM from web research.** Scraping blogs and userscripts
  described `#react-results` / `main` as Yandex/DuckDuckGo shells; neither
  existed on the real Yandex page, so the bar never mounted and the diagnosis
  started from the wrong assumption.
- **Treating `extract-failed` as an extractor bug.** The error is produced by
  the orchestration layer when the temp SERP tab never returns a valid reply
  (see `lib/engine-search.ts` `isExtractionReply`). The extractor never ran,
  because Yandex redirected the navigated tab to a challenge page whose URL no
  longer matched the canonical SERP — the content script's `matchesRequestUrl`
  guard (`entrypoints/engine-extractor.content.ts`) correctly ignored the
  message. The root cause was upstream of extraction.

## Solution

Build the **canonical** Yandex path without the trailing slash.
`matches()` still accepts both forms (the redirect transiently produces both),
but `buildSerpUrl` only emits the canonical one so no redirect is ever incurred.

```ts
// lib/engines/yandex.ts
// BEFORE (caused a 302 /search/ -> /search redirect = high-weight antifraud signal)
const SERP_URL_TEMPLATE = 'https://yandex.com/search/?text={q}';

// AFTER (canonical; no redirect)
const SERP_URL_TEMPLATE = 'https://yandex.com/search?text={q}';

matches(url) {
  // accept both /search and /search/ (both appear during the redirect),
  // but reject /searching, /search-result, etc.
  if (!isSerpUrl(parsed, isYandexSerpHostname, '/search', 'prefix')) return false;
  return /^\/search\/?$/.test(parsed.pathname);
}
```

The companion Python bridge skill's `ENGINES` tuple
(`skills/juso-search*/scripts/juso_search.py`) was also stale
`("google", "bing", "baidu")`, which rejected `--engine yandex` client-side
before the worker ever saw the request; it must mirror the worker allowlist.

## Why This Works

Yandex's canonical SERP route is `/search` (no trailing slash). A `/search/`
request triggers a Yandex `302` to `/search`. **A redirect chain is itself a
high-weight Yandex antifraud signal** — combined with the inactive/background
tab that `runEngineSearch` creates (`tabs.create({ active: false })`), it pushes
the request past the bot-detection threshold on every navigation, producing the
verification wall. Emitting the canonical URL removes the redirect, eliminating
one of the two signals (the other — background tab — is required by the
extraction design and cannot be removed).

The agent-bridge `extract-failed` vs DuckDuckGo success confirmed the code path
was sound: same orchestration, same allowlist wiring; only Yandex's external
redirect-and-challenge behavior differed.

## Prevention

- **Emit canonical URLs only.** When adding a search engine, determine the
  canonical SERP path from the URL the engine itself settles on after a real
  navigation (watch the address bar), not from scraping guides. Match the
  canonical form in `buildSerpUrl`; be lenient in `matches()`.
- **Read `error` taxonomy before debugging the wrong layer.** `extract-failed`
  is orchestration (tab/handshake), `challenge`/`unsupported-layout`/`no-results`
  is page-state. An `extract-failed` on one engine but not others points at the
  site's navigation/redirect behavior, not the extractor.
- **Mirror the worker allowlist in the bridge client.** The worker's
  `parseSearchRequest` allowlist (`lib/agent-bridge.ts`) and the Python skill's
  `ENGINES` tuple must list the same engine ids, or the client rejects valid ids
  before they reach the worker.
- **Residual: Yandex antifraud is not fully solvable in code.** Even with the
  canonical URL, Yandex still challenges some automated/background navigations.
  This is a platform characteristic; the fix above removes the avoidable trigger
  but cannot guarantee a clean extraction every time.

## Related Issues

- `docs/solutions/logic-errors/engine-search-orchestration-errors-and-baidu-url-extraction.md`
  — defines the `extract-failed` vs page-state error taxonomy relied on here.
- `docs/solutions/architecture-patterns/engine-capability-is-per-registry-not-per-id-union.md`
  — why adding an engine is several independent decisions (navigation,
  extraction, agent-surface, default visibility).
