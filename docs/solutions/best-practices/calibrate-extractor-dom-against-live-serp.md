---
title: "Calibrate extractor DOM branches against the live SERP before shipping (probe → inline-equivalence → fixture-as-photograph)"
date: 2026-09-14
last_updated: 2026-09-14
category: best-practices
module: engine-extractor / content-script / fixtures
problem_type: best_practice
component: frontend_stimulus
severity: medium
applies_when:
  - "Writing or fixing an engine extractor whose selectors come from guesswork, cached markup, or a stale fixture"
  - "Calibrating a construction-mode SERP (zhannei.baidu.com, bing q1, scoped google) whose DOM differs from the engine's main results page"
  - "Deciding whether a page element may feed a URL or snippet field (display metadata such as .c-showurl is not a URL source)"
  - "Rewriting extractor test fixtures so they mirror the real page structure with defensive variants"
  - "Verifying a content-script extraction pipeline end-to-end with browser automation before shipping"
root_cause: missing_validation
resolution_type: workflow_improvement
tags: [extractor, dom-calibration, zhannei, serp, browser-automation, test-fixture, content-script]
related_components:
  - "entrypoints/engine-extractor.content.ts"
  - "lib/engines/extractors/baidu.ts"
  - "lib/engines/baidu-zhannei.ts"
  - "lib/engine-search.ts"
  - "tests/engine-extractors.test.ts"
  - "tests/fixtures/engines/zhannei-basic.html"
---

# Calibrate extractor DOM branches against the live SERP before shipping (probe → inline-equivalence → fixture-as-photograph)

## Context

A new extraction branch for `zhannei.baidu.com` (Baidu CSE site-search — the landing page of baidu site instances in `zhannei` mode) was written from a real-machine **skeleton note**: `#wrap > #container > #center > #results.content-main > .result×N`. The container-level path was verified (a user devtools probe from the zhannei surface work), but the **card-level** selectors — which class a result card has, where the title link lives, where a usable URL and snippet come from — were unverified assumptions. Shipping unverified DOM assumptions for an extractor risks the worst failure mode the extractor layer has: a silent `no-results` / `unsupported-layout` on exactly the pages the new feature targets, discovered only by end users.

## Guidance

The practice, with the zhannei calibration as the worked example:

1. **Navigate to a real result page in the user's actual browser** via browser automation (huashu-chrome MCP: `tabs new` → navigate to a real `zhannei.baidu.com/cse/site?q=…&cc=<host>` URL → `wait idle` → `snapshot`). The user's real browser carries the cookies/locale/AB-buckets the extraction will actually face; a clean-room fetch may get a different page generation.
2. **Probe structure with in-page JS (`eval`)**, field by field, before believing any selector:
   - Container presence/shape: found `#results.content-main`, 11 children, first a `.support-text-top` count hint (so "first child is a card" is false — never assume `:first-child`).
   - Card class: `div.result.f.s0`.
   - Per-card fields: title = `h3.c-title > a[cpos="title"]` with `<em>` highlight inside (`textContent` survives highlighting); `.c-abstract` present 10/10 cards; `.c-showurl` is a "URL+date" **display strip**, not a URL source.
   - URL semantics: 10/10 anchors carry **direct hrefs** — no `mu` attributes, no `data-log`, no `baidu.com/link` redirect shells, unlike the main-site SERP.
   - Page-state false-positive risks: no `#passport-login-pop`, no captcha elements — the branch will not misclassify a healthy page as `consent`/`challenge`.
3. **Run an inline-equivalence probe**: an in-page script that mirrors the extractor's exact logic — the same normalize/clamp/shell-filter functions (`baiduResultUrl`'s real-URL preference order, `isBaiduRedirectShell`) — over the live DOM, and inspect the *output quality* (10/10 clean title + direct URL + snippet) **before writing any fixture**. This is the step that converts "the selectors exist" into "the extraction produces good rows on this page".
4. **Rewrite the test fixture to the real structure** (`tests/fixtures/engines/zhannei-basic.html`, commented with the calibration date), and **keep defensive variants as behavior locks**: a card with a `mu` attribute over a shell href (mu preferred), a shell-only card with no real URL (dropped), a titleless card (skipped). These lock the extractor's *policy*, not just today's DOM.
5. **Carry probe findings back into product code where they generalize**: `fallbackSnippet`'s drop-list gained `.c-showurl` — a "URL+date" strip must never become a fallback snippet, and the fix benefits the main-site baidu path too. Upgrade code comments from "unverified" to the dated real-machine structure (2026-09-13, 卡片级 DOM 已真机校准), so the next reader knows which facts are measured.
6. **For end-to-end confirmation, use evidence stronger than the tool reply**: the browser History DB (sqlite, read-only, `?immutable=1` URI against a copy or the live file) proved the agent-path temporary tab actually navigated to `https://zhannei.baidu.com/cse/site?q=Python 逆向&cc=www.52pojie.cn` — construction → surface → extraction confirmed without screenshot access. Tool replies can be stale or partial; the History DB is the browser's own record of where tabs actually went.

## Why This Matters

Extractor branches ship against adversarial, obfuscated, changing pages; a fixture written from imagination verifies nothing — it proves the code matches the fixture, and the fixture matches nothing. Live calibration converts unknowns into dated facts and produces fixtures that are photographs, not sketches. It also surfaces site-specific surprises that would have been wrong to assume in *either* direction: zhannei serves direct hrefs where the main-site SERP wraps results in `/link` redirect shells. Assuming "same as main site" would have produced a branch that runs but discards every URL through the shell filter; assuming "direct links everywhere" would have broken the main-site path. Only the probe resolves which page does what — and the shared `baiduResultUrl` preference order turns out to handle both without branching.

The motivating instance of skipping this practice is [the douyin caption whitespace regression](../integration-issues/douyin-caption-whitespace-regression.md) (same session): selector assumptions verified by hit counts instead of yield, caught only by replaying the extractor against the live DOM. And the cautionary tale for letting an uncalibrated assumption stand is [the douyin anti-bot misdiagnosis](../integration-issues/douyin-automated-tab-antibot-no-results.md) — six weeks of a documented-but-wrong limitation, now carrying an erratum.

## When to Apply

- Adding any new page-region extraction branch (new host, new surface, new card layout).
- Touching selector constants in an extractor.
- After a reported extraction regression on a specific host — re-probe before re-coding; the page may have moved, not the code.
- When the skeleton note or fixture backing a branch is older than the current page generation (search pages redesign often; a months-old probe is a hypothesis again).

## Examples

The calibration checklist, condensed (this session's zhannei run):

```text
1. Open real SERP in user's browser (automation), wait idle, snapshot.
2. eval probes:
   container : !!document.querySelector('#results.content-main')          // true; 11 children, [0] = .support-text-top (count hint, not a card)
   card      : document.querySelectorAll('#results.content-main > .result')  // 10/10 match div.result.f.s0
   title     : card.querySelector('h3.c-title a')?.getAttribute('cpos')   // "title"; <em> inside → use textContent
   abstract  : card.querySelector('.c-abstract')                          // present 10/10
   showurl   : card.querySelector('.c-showurl')                           // "example.com/one 2026-9-10" → display metadata, NOT a URL source
   urls      : anchors' href — direct target URLs 10/10; no mu / data-log / baidu.com/link shells
   pagestate : no #passport-login-pop, no captcha nodes
3. Inline-equivalence: run the extractor's own preference order (mu → mdurl → data-log → sc_vurl → href, shell-filtered)
   over the live cards → 10/10 clean rows. Only now write the fixture.
4. Fixture = real structure + defensive variants (mu-over-shell preferred, shell-only dropped, titleless skipped).
5. Generalize findings: .c-showurl added to fallbackSnippet's drop-list; comments stamped with the calibration date.
6. E2E evidence: History DB (sqlite, immutable read) shows the temporary tab hit
   zhannei.baidu.com/cse/site?q=Python 逆向&cc=www.52pojie.cn — construction→surface→extraction confirmed.
```

The product-code deltas that came out of it:

```ts
// lib/engines/extractors/baidu.ts — fallbackSnippet drop-list gains the display strip
clone.querySelectorAll('h3, .t, cite, button, nav, script, style, svg, .c-showurl').forEach((element) => element.remove());

// zhannei branch comment: unverified note → dated real-machine structure
// 卡片级 DOM 已真机校准（2026-09-13，zhannei.baidu.com/cse/site?q=…&cc=zhihu.com 实测）：
// 卡片 = div.result.f.s0，标题 = h3.c-title > a[cpos="title"] …标题 href 为目标站直链
//（无 mu/data-log、无 baidu /link 壳）；仍走 baiduResultUrl 的真 URL 优先序…（+ 防御行为锁说明）
const ZHANNEI_RESULTS_SELECTOR = '#results.content-main > .result';
```

Positioning against the one documented exception: [adding-search-engine](../architecture-patterns/adding-search-engine.md) records weixin *anchors* as inferred-from-implementations rather than live-probed, with a recovery path. That remains a deliberate deviation for anchor inference when probing is unavailable — for **extractor DOM contracts**, probes are the default, and this doc is the recipe to reach for once probing becomes possible.

## Related

- [Douyin caption whitespace regression](../integration-issues/douyin-caption-whitespace-regression.md) — the concrete instance of this practice executed end-to-end the same session (live recon, inline yield replay, fixture-vs-live diff); the per-instance form of these rules.
- [Douyin automated tab anti-bot no-results](../integration-issues/douyin-automated-tab-antibot-no-results.md) — the cautionary precedent for uncalibrated assumptions (see its 2026-09-13 erratum; cite, don't re-correct).
- [Google SERP extractor nested wrapper](../logic-errors/google-serp-extractor-nested-wrapper.md) — the DevTools-dump-before-selectors precedent, and why web-fetch of a SERP fails (bot interstitial) — i.e. why a real browser probe is the only channel.
- [DuckDuckGo React SERP anchors and real-device probing](../ui-bugs/duckduckgo-react-serp-anchors-and-real-device-probing.md) — the anchor-side twin of the probe-don't-guess discipline.
- [Engine-search orchestration errors and Baidu URL extraction](../logic-errors/engine-search-orchestration-errors-and-baidu-url-extraction.md) — the URL preference order and CDP-probe evidence table the zhannei probe validated against.
- [CDP programmatic UI verification](../developer-experience/cdp-programmatic-ui-verification.md) — the how of programmatic browser evidence (numeric over screenshots, reload-before-assert traps); this doc owns the when/what for extractor DOM contracts.
- [Site instance construction modes and the zhannei surface](../architecture-patterns/site-instance-construction-modes-and-zhannei-surface.md) — how zhannei URLs get constructed and recognized (the surface engine carries the container-level skeleton note).
- `CONCEPTS.md` — Engine Extractor and Engine Extraction Error entries (the page-state vs orchestration discipline the page-state probe protects).
- Learnings store — the `zhannei.baidu.com` note saved this session (live-structure facts for the next calibration).
