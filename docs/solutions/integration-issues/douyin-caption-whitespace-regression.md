---
title: "Douyin extractor returned no-results because caption whitespace was treated as a stable contract"
date: 2026-09-13
last_updated: 2026-11-01
category: integration-issues
module: engines
problem_type: integration_issue
component: tooling
symptoms:
  - "`engine-search --engine douyin` returns `{\"error\":\"no-results\"}` on every attempt since ~2026-08"
  - "The SERP renders normally: manual recon counts 20 `waterfall_item_` cards, no captcha, no login wall"
  - "The card DOM contract is unchanged (`[id^=\"waterfall_item_\"]`, `.search-result-card`, no `<a>`) yet `extract()` yields 0 rows"
  - "Unit tests pass — the fixtures encode the old caption text format"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [douyin, engine-extractor, serp-extraction, whitespace, text-parsing, misdiagnosis]
related_components:
  - lib/engines/extractors/douyin.ts
  - lib/engine-search.ts
  - entrypoints/engine-extractor.content.ts
---

# Douyin extractor returned no-results because caption whitespace was treated as a stable contract

## Problem

The `douyin` extractor (`lib/engines/extractors/douyin.ts`) parsed the card's caption as a whitespace-separated token stream: video cards had to match `^\d{1,2}:\d{2}(?:\s|$)` (duration + space), note cards `^图文(?:\s|$)`, and the author tail had to be preceded by `\s+@`. Sometime between 2026-07-31 and 2026-09-13, Douyin stopped emitting whitespace between those tokens in `textContent` — live captions became `10:041.3万新疆…`, `图文408感觉…`, and `#话题@作者 · 时间` (hashtag glued to the `@`). Every card failed classification, `extract()` returned `[]`, and `extractEngineSearch` mapped that to `no-results`.

## The misdiagnosis

`docs/solutions/integration-issues/douyin-automated-tab-antibot-no-results.md` (2026-07-31; consolidated into this doc on 2026-11-01 — its misdiagnosis conclusion was retracted by an erratum, its still-valid guidance lives on below) attributed the same `no-results` to anti-bot gating of programmatically-created tabs and closed the issue as a documented headless limitation. That investigation verified **selector counts** ("the same selectors return 25 cards"), never the extractor's **yield** — and both failures surface as the same `no-results` string, because cards-present-but-zero-extracted and cards-absent both funnel through `results.length === 0`. Live recon on 2026-09-13 (huashu-chrome, logged-in profile, programmatically-created background tab) rendered 20 cards with zero challenge markers, and replaying the extractor's classification against them yielded 0/20 — proving the dominant failure was the parser, not anti-bot. The occasional `challenge` errors in the old report were real, but rare.

The six-week anti-bot investigation did establish real negative results, inherited here: lengthening the wait window (4s → 12s poll, 10s → 20s `COMPLETE_TIMEOUT_MS`) still yielded `no-results`, ruling out hydration latency (reverted — a longer window only slows every engine's no-result path); opening the tab with `active: true` made no difference, ruling out `document.visibilityState` as the gate. Once the parser fix landed, the anti-bot limitation callout was **removed** from `skills/juso-search*/reference/engines.md` — the current skill surface only notes that occasional `challenge` (captcha/slider) can still appear in the automated flow and should be retried.

## Solution

Rewrite the extractor so nothing depends on inter-token whitespace (`lib/engines/extractors/douyin.ts`), in two layers merged field-by-field:

1. **Leaf-shape parsing (primary).** Collect leaf elements (no element children, non-empty text). A leaf matching `^\d{1,2}:\d{2}$` classifies the card as video; a bare `图文` leaf classifies it as note; neither → user-aggregate/related-search/live card, dropped. Likes = first leaf matching `^[\d.]+万?$`; body = longest leaf; author = the text of the element right after the bare `@` leaf. This mirrors the real DOM: duration badge, like count, caption, and the `@`+name+`· time` triple are separate leaves.
2. **Tolerant blob parsing (fallback).** When leaf parsing does not classify the card (e.g. caption is a bare text node, as in the 2026-07-31-era fixtures), classify on `textContent` with prefix regexes that do not require whitespace (`^\d{1,2}:\d{2}` / `^图文`), take an optional leading `[\d.]+万?` as likes, and split the author tail by anchoring on the **last** `@` that is followed by `·` — anchoring on the last `@` keeps mid-caption `·` separators and `@` mentions from breaking the split.

Both layers share one `splitAuthorTail` helper. Tests add `tests/fixtures/engines/douyin-glued.html` (replica of the 2026-09-13 DOM, glued text) alongside the retained spaced-format fixture, which must keep passing.

## Why This Works

Every field Douyin exposes has a content-driven text shape (`mm:ss`, `图文`, `N万`, `@`, `· time`) that survives whitespace changes, class obfuscation, and token reordering, because each shape is pinned to what the text *is*, not where it sits. Whitespace between tokens, by contrast, is a rendering artifact the site has already changed once. The two-layer merge means a card whose duration is structural but whose caption is a bare text node still parses; a full-leaf card never falls back at all.

## Prevention

- **Verify the extractor's yield, not the selector's hit count.** `querySelectorAll(...).length === 20` says nothing about `extract().length`. The error string `no-results` conflates "cards absent (anti-bot)" with "cards present, zero parsed (parser bug)" — before blaming anti-bot, replay the extraction logic against the live DOM and count what comes out.
- **Treat `no-results` vs `challenge` vs `timeout` as different signals.** `no-results` (cards absent) + manual-DevTools success = anti-bot gating; `challenge` = explicit captcha/slider; `timeout` = load-window issue. The error taxonomy in `EngineExtractionErrorKind` exists precisely to make this triage fast. (Inherited from the consolidated 2026-07-31 investigation.)
- **Do not lengthen global wait constants to fix one slow site.** A no-result path that always runs to the deadline slows every engine's failure mode; confirm latency is actually the cause (cards appear late) before touching timeouts. (Inherited; also proven empirically here — 12s of polling still yielded zero cards because the cards were gated by parsing, not by latency.)
- **Treat `textContent` whitespace as a rendering artifact, never a parsing contract.** Sites re-emit markup with or without whitespace text nodes at will. Parse by per-node text shapes (leaf classification), or by regexes that tolerate both glued and spaced tokens.
- **When "site blocked us" and "our parser broke" produce the same error string, instrument before documenting.** A best-effort limitation note that outlives its wrong root cause misleads every later debugging session — this issue sat behind the anti-bot diagnosis for six weeks.
- **Keep the extractor code and unit tests even when the live flow is unreliable.** The code is correct and verified; a flow-level limitation is environmental. Removing the code would lose the investment and force a rewrite if the site's anti-bot later relaxes. (Inherited — this is why the douyin extractor survived the six-week misdiagnosis and could be fixed in place.)
- **Fixture formats drift from reality silently.** Unit fixtures encode the DOM as understood when written. When a live-flow failure contradicts passing tests, diff the fixture against the live DOM text, not just the selectors.

## Related Issues

- The 2026-07-31 anti-bot investigation this document corrects was consolidated into this doc on 2026-11-01 (see "The misdiagnosis" above); its retracted conclusion and erratum are preserved in git history.
- `lib/engines/extractors/douyin.ts` — the two-layer (leaf-shape + tolerant blob) extractor.
- `tests/fixtures/engines/douyin-glued.html` — regression fixture for the glued-caption era.
