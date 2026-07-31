---
title: "Douyin returns no-results/challenge in the automated engine-search flow despite a correct extractor"
date: 2026-07-31
category: integration-issues
module: engines
problem_type: integration_issue
component: tooling
symptoms:
  - "`engine-search --engine douyin` returns `{\"error\":\"no-results\"}` consistently across retries"
  - "Occasional `{\"error\":\"challenge\"}` (captcha/slider) and rare `{\"error\":\"timeout\"}`"
  - "The same selectors return 25 cards when the tab is open and visible (verified via DevTools recon)"
  - "bilibili and xiaohongshu succeed in the identical automated flow on the same profile"
root_cause: incomplete_setup
resolution_type: documentation_update
severity: medium
tags: [douyin, engine-extractor, anti-bot, content-script, mv3, serp-extraction]
related_components:
  - lib/engines/extractors/douyin.ts
  - lib/engine-search.ts
  - entrypoints/engine-extractor.content.ts
  - skills/juso-search/SKILL.md
---

# Douyin returns no-results/challenge in the automated engine-search flow despite a correct extractor

## Problem

The `douyin` `EngineExtractor` (`lib/engines/extractors/douyin.ts`) is verified correct — its selectors and caption parser return 25 result cards when the SERP tab is open and visible. But in the real `engine-search` flow (the agent bridge → `runEngineSearch` opens the SERP in a programmatically-created tab → content script extracts), Douyin consistently returns `no-results`, with intermittent `challenge` and rare `timeout`. `bilibili` and `xiaohongshu` succeed in the identical flow on the same logged-in profile.

The user-visible impact: the agent receives no usable Douyin results, so `douyin` is effectively best-effort while the other two Chinese sites are reliable.

## Symptoms

- `engine-search --engine douyin` returns `{"error":"no-results"}` on most attempts.
- Occasional `{"error":"challenge"}` — Douyin's captcha/slider is served.
- Rare `{"error":"timeout"}` — the tab did not reach `complete` within the load window.
- The same DOM query, run manually in a visible tab's DevTools, returns 25 `waterfall_item` cards and 0 challenge markers.
- `bilibili` (`search.bilibili.com/all`) and `xiaohongshu` (`www.xiaohongshu.com/search_result`) succeed immediately in the same flow.

## What Didn't Work

- **Lengthening the wait window.** Raised `waitAndExtract`'s poll deadline (4s → 12s) and `COMPLETE_TIMEOUT_MS` (10s → 20s). Still `no-results` within 12s — proving it is not hydration latency. Reverted: the longer window only slowed every engine's no-result path.
- **Opening the SERP as an active tab** (`tabs.create({ active: true })` for douyin). Still `no-results`. Douyin's anti-bot keys on more than `document.visibilityState`; a programmatically-created tab is fingerprinted regardless of active state. Reverted to the shared `active: false`.
- **Manual timing recon.** Asked the user to run a probe at page load, but DevTools itself takes time to open, so the first sample landed at ~3500ms with 0 cards — an artifact of late instrumentation, not evidence about the page.

## Solution

The extractor code is retained (it is correct and unit-tested), and the **headless limitation is documented** in both `skills/juso-search/SKILL.md` and `skills/juso-search-dev/SKILL.md` so callers treat `douyin` as best-effort:

```markdown
> **`douyin` headless limitation (2026-07-31):** the extractor code is correct
> (verified: the same selectors return 25 cards when the tab is open and visible),
> but in the automated `engine-search` flow — which opens the SERP as a
> programmatically-created tab — Douyin's anti-bot frequently returns `no-results`
> (cards not rendered) or `challenge` (captcha/slider). This is a site anti-bot
> reaction to the automated tab, not an extraction bug. Retry, or treat `douyin`
> as best-effort; `bilibili` and `xiaohongshu` are reliable in the same flow.
```

The extractor, registry entry, CLI whitelist, and unit tests all remain — the limitation is environmental (anti-bot), not a code defect.

## Why This Works

Root cause: **Douyin's anti-bot distinguishes a programmatically-created tab from a user-navigated one.** The `runEngineSearch` flow uses `chrome.tabs.create({ url })`, which Douyin detects and responds to by either not rendering result cards (→ `no-results`, because `extract()` finds zero `waterfall_item` nodes) or by serving a captcha/slider (→ `challenge`). This is independent of:

- **Login state** — the profile is logged in (bilibili/xiaohongshu prove the shared cookie jar works).
- **Extractor correctness** — manual DevTools recon returns 25 cards with the exact selectors in `douyin.ts`.
- **Wait time** — 12s of polling still yields zero cards; the cards are gated, not slow.
- **Tab activation** — `active: true` made no difference; the fingerprint is on the creation event, not visibility.

Documenting the limitation is the correct resolution because the failure is the site's intentional anti-bot behavior, not something a code fix on our side can reliably bypass without ongoing cat-and-mouse (headless detection evasion), which is out of scope for this extension.

## Prevention

- **Before assuming an extractor is broken, separate "selector correctness" from "automated-flow reachability."** Run the extractor's selectors manually in a visible tab (DevTools recon) to prove the DOM contract; then run the `engine-search` flow. A selector that works manually but fails in the flow points to anti-bot/environment, not the extractor.
- **Treat `no-results` vs `challenge` vs `timeout` as different signals.** `no-results` (cards absent) + manual success = anti-bot gating; `challenge` = explicit captcha; `timeout` = load/window issue. The error taxonomy in `EngineExtractionErrorKind` exists precisely to make this triage fast.
- **Do not lengthen global wait constants to fix one slow site.** A no-result path that always runs to the deadline slows every engine's failure mode; confirm latency is actually the cause (cards appear late) before touching timeouts.
- **When a site's anti-bot cannot be bypassed, document the limitation at the skill surface (SKILL.md), not just in code comments** — agents reading the skill need to know to retry or fall back, and need to know which sibling engines are reliable.
- **Keep the extractor code and tests even when the live flow is unreliable.** The code is correct and verified; the limitation is environmental. Removing the code would lose the investment and force a rewrite if Douyin's anti-bot later relaxes.

## Related Issues

- `docs/solutions/architecture-patterns/engine-capability-is-per-registry-not-per-id-union.md` — the four-layer capability model; this learning is why `douyin` now ships a real extractor (Layer 2) while documenting a runtime caveat, rather than mapping to `UNSUPPORTED_EXTRACTOR`.
- `lib/engines/extractors/douyin.ts` — the retained extractor (URL synthesis from `waterfall_item_{id}`, caption-text parsing).
- `skills/juso-search/SKILL.md` / `skills/juso-search-dev/SKILL.md` — the `douyin` headless-limitation callout.
