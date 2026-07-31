---
title: "DuckDuckGo React SERP had no #react-results anchor; bar never mounted until anchors were probed on the real page"
date: 2026-07-31
category: ui-bugs
module: serp-bar
problem_type: ui_bug
component: ui
symptoms:
  - "The SERP Switch Bar never appeared on DuckDuckGo result pages — the injected shadow host was absent"
  - "The two declared anchor candidates (#react-results, main) did not exist on the real duckduckgo.com SERP"
  - "Only section[data-testid='mainline'] (the results column itself) was present, which React can rebuild"
root_cause: wrong_api
resolution_type: code_fix
severity: high
tags:
  - serp-bar
  - duckduckgo
  - anchors
  - react-serp
  - content-script
  - devtools
---

# DuckDuckGo React SERP had no #react-results anchor; bar never mounted until anchors were probed on the real page

## Problem

After adding DuckDuckGo, the SERP Switch Bar never injected on
`duckduckgo.com` result pages. The content script's mount depends on finding one
of the engine's declared anchor candidates; both candidates were wrong for the
real page, so `pickAnchor` resolved nothing and the bar stayed unmounted.

## Symptoms

- On a DuckDuckGo SERP, `document.querySelector('juso-serp-switch-bar')` was
  `null` — the host was never created.
- Declared candidates `#react-results` and `main`: both absent (`✗ ... 不存在`).
- The only relevant node present was `section[data-testid="mainline"]` (the
  results column), `left:31, width:672` — but it is the results list itself, not
  a stable shell, so anchoring into it risks being rebuilt on SPA navigation.

## What Didn't Work

- **Deriving anchors from web research / scraping guides.** Multiple guides
  (userscripts, Firefox SERP telemetry, scraping blogs) referenced
  `#react-results` / `ol.react-results--main` as the DuckDuckGo results shell.
  On the real `duckduckgo.com` neither existed; DuckDuckGo ships a different
  markup that rotates and is not the documented SSR shell. Anchors copied from
  these sources failed silently — the bar just never mounted, with no error.

## Solution

Stop guessing anchors; probe the real page and let the user confirm position.
A throwaway DevTools snippet renders labeled colored bars at each candidate
position so the right one is chosen by eye, then the chosen element becomes the
anchor.

Real DuckDuckGo structure (probed 2026-07-31): the persistent, column-aligned
element is the **`nav`** tabs strip (`left≈31, width≈672`, matches the results
column), with `#header_wrapper` (full-width header, `width≈1000`) as a stable
fallback higher up.

```ts
// lib/engines/duckduckgo.ts
const ANCHORS: AnchorStrategy[] = [
  // primary: nav is column-aligned with results; bar sits between tabs and results
  { selector: 'nav', append: 'after', alignTo: 'nav' },
  // fallback: full-width header shell, higher up but persistent
  { selector: '#header_wrapper', append: 'after', alignTo: '#header_wrapper' },
];
```

The probing snippet (paste in DevTools on the SERP): for each candidate
`{sel, position}`, build a `position:relative` colored `<div>` sized to the
results column and `el.before/after(bar)` it; the user picks A/B/C/D and the
winner becomes the anchor. Cleanup:
`document.querySelectorAll('[data-juso-test-bar]').forEach(e=>e.remove())`.

## Why This Works

The bar injector resolves anchors by `document.querySelector` on each mount
(`pickAnchor`, `entrypoints/serp-bar.content.ts`). If no candidate exists, it
falls to a last-resort anchor or stays unmounted — **silently**, with no error.
A React SERP like DuckDuckGo's has no stable, documented, named results shell;
the only reliable way to find a persistent, column-aligned insertion point is to
enumerate the real DOM and choose visually. `nav` survives React re-renders
(it's the top tab strip, not part of the results subtree), so the host isn't
carried away when results re-render — the same property Bing's `#b_content`
and Baidu's `#container` provide on their SERPs.

## Prevention

- **Never trust scraping-guide selectors for anchors.** Anchors must be a
  *persistent* element present at first paint that is not part of the rebuilt
  results subtree. Guides describe result *items*, not injection shells. Verify
  on the real page.
- **Use the labeled test-bar probe when adding any SPA SERP.** Render colored
  bars at each candidate position and pick by eye — it removes the guesswork and
  catches the silent no-mount failure mode immediately.
- **A missing bar is a no-error failure.** If the bar doesn't show, first check
  whether any declared anchor exists on the real page; the injector fails open
  (unmounted) rather than throwing.
- **Align the bar to a column-matching element.** The `alignTo` rect should be an
  element whose `left`/`width` match the results column (DuckDuckGo `nav`,
  Bing `#b_content`, Baidu `#content_left`), so the bar lines up with results
  rather than the full page width.

## Related Issues

- `docs/solutions/architecture-patterns/serp-switch-bar-and-unified-source-model.md`
  — the SERP Switch Bar mount/anchor cascade this adapter plugs into.
- `docs/solutions/integration-issues/yandex-canonical-serp-slash-redirect-antibot.md`
  — the other half of the same Yandex/DuckDuckGo addition (Yandex navigation).
