---
title: "Engine-Specific SERP Bar Injection Anchors for Google and Bing"
date: 2026-07-09
last_updated: 2026-07-14
category: ui-bugs
module: "serp-bar / content-script"
problem_type: ui_bug
component: tooling
severity: high
symptoms:
  - "Bing host keeps computed display:inline and margin-left:0 despite external inline important styles"
  - "Bing bar visual position or clickable geometry diverges from the main results content box"
  - "Google bar appears below AI Overview instead of above the complete result experience"
root_cause: logic_error
resolution_type: code_fix
tags:
  - wxt
  - content-script
  - bing
  - google
  - shadow-dom
  - css-cascade
  - ai-overview
  - serp-bar
related_components:
  - entrypoints/serp-bar.content.ts
  - entrypoints/shared/serp-bar-styles.ts
  - lib/engines/google.ts
  - lib/engines/bing.ts
  - lib/engines/types.ts
  - lib/engines/registry.ts
  - lib/serp-bar-layout.ts
  - tests/engines.test.ts
  - tests/serp-bar-layout.test.ts
---

# Engine-Specific Shadow DOM Anchors for SERP SourceSwitcher

## Problem

The "聚搜" Chrome extension injects a `SourceSwitcher` UI bar into Google and Bing SERP pages via WXT's `createShadowRootUi` (shadow DOM). The bar must stay outside fragile result internals, appear before the complete result experience, and remain horizontally aligned to each engine's main content box. Bing and Google violate those requirements in different ways: Bing combines a Shadow DOM cascade boundary with legacy overlapping layout, while Google can place AI Overview before the ordinary result column.

## Symptoms

- Bing: the SourceSwitcher bar vanishes after performing a new search (SPA pushState navigation). The bar also appeared left-offset (full-bleed, x=0) when anchored to page-level persistent elements that sit outside the centered results column.
- Bing: when the bar is placed inside the results column, click hit-tests are offset — the visible button position does not match the clickable region because the shadow DOM host participates in Bing's legacy inline flow and overlapping transparent layers steal mouse events.
- Google: the bar appears left-offset when anchored to `#cnt` or `#appbar` because those elements' positioning does not align with the search box column.
- Google AIO: the bar appears below AI Overview because `#search + before` places it inside `#center_col`, while Google renders the AI Overview wrapper before `#center_col` inside `#rcnt`.
- All engines: the bar disappears permanently on Bing SPA navigation when anchored to `#b_results` because that element is aggressively rebuilt on pushState.
- Bing DevTools evidence at viewport `1112`, DPR `1.5`: the host `style` attribute contained `display:block!important`, `margin-left:113px!important`, and `width:983.667px!important`, but computed styles remained `display:inline`, `position:static`, `margin-left:0`, and `width:1096.667px`.

## What Didn't Work

**Phase 1 — `pickAnchor()` with `append:'before'` on `#search`/`#rso`/`#b_results` (d8dde21):** The initial design used `mount()` with a runtime anchor selector (`#search` for Google, `#b_results` for Bing). Works on initial load. Bing fails on SPA navigation because Chrome content scripts do not re-run on pushState/replaceState. The `wxt:locationchange` handler triggers re-render but the shadow DOM host is a sibling of `#b_results` — when Bing rebuilds `#b_results`, the host is detached and never re-mounted.

**Phase 2 — `autoMount()` with function anchor (244ba66):** Replaced `mount()` with `autoMount()` and a function anchor. Hypothesis: `autoMount` observes the anchor and re-mounts when the SPA removes/re-adds the results container. Failed because:
- The function anchor is called once at setup to freeze the selector string — mechanically identical to a plain string anchor (`shared.mjs:95`).
- `autoMount`'s `isNotExist` ping-pong deadlocks on coalesced SPA swaps: Bing removes old `#b_results` and adds new `#b_results` in one synchronous task. The `MutationObserver` batches into one microtask after the swap completes. `getAnchor()` at that point returns the **new** node, so `isNotExist(newNode)` returns false. The `waitElement` with `isNotExist` never resolves. The re-mount cycle parks forever (`shared.mjs:103`, `index.mjs:52-71`).
- The host is a sibling of `#b_results` inside the anchor's parent (`shared.mjs:52`). When Bing rebuilds the parent's children, the host is detached. Combined with the deadlock, the bar vanishes permanently.

**Phase 3 — Persistent anchors `#b_header` / `#appbar` with `append:'after'` (2484a79):** Reverted to `mount()`. Used `#b_header` (Bing) and `#appbar` (Google) — page-level persistent elements not swapped during SPA navigation. The host becomes a body-level sibling (full-bleed, x=0) while Bing's search box and results are in a centered fixed-width column (`#b_header { width: 1243px; margin: 0 auto }`, left edge ≈ 338px at 1920px). This caused left-offset misalignment. Same issue on Google.

**Phase 4 — Centered column `#b_content` / `#cnt` with `append:'first'` (e65ddf4):** Switched to `#b_content` + `first` (Bing) and `#cnt` + `first` (Google). The host lives inside the centered column and inherits alignment automatically. Google alignment mostly worked but Bing suffered click hit-test offset. Root cause: WXT's `createShadowRootUi` inserts `:host { all: initial !important }` in shadow CSS (`shadow-root.mjs:19`), overriding the non-important `:host { display: block }` from `serp-bar-styles.ts`. The host becomes inline/initial. Bing's `#b_content` has legacy inline result layout: `<main>` and `<aside>` are inline, `#b_results` and `#b_context` are `inline-block`, and `#b_tween` inside `<main>` has `margin-top: -28px` with `position: relative`. This overlapping transparent layer steals mouse events — the visual button position does not equal the clickable region.

**Google `#search + before` (superseded by AIO):** This placed the host as a preceding sibling of `#search` inside `#center_col`, so it was only above ordinary results. On a 883px viewport AIO page, real DevTools measured `#rcnt` at `left=0, top=162, width=868`; its direct child at index 1 was the AI Overview wrapper at `top=162, width=868, height=554`, while direct child index 2 was `#center_col` at `left=52, top=716, width=652`. The host consequently remained at `left=52, top=716`, below AIO. No AI-specific selector can make this sibling cross the preceding `#rcnt` child.

**External inline `!important` host longhands (6f2c511 predecessor):** The content script wrote `display`, `position`, `margin-left`, `width`, and related properties directly on the custom element. This assumed inline important declarations would beat WXT's shadow rule `:host { all: initial !important }`. For important declarations the inner shadow encapsulation context has priority over the outer document context, so the declarations existed in the style attribute but never became computed values. Rewriting them on resize, navigation, RAF, or a timer could not change that cascade outcome.

**Document-coordinate geometry:** The same implementation converted `getBoundingClientRect().left` with `window.scrollX` and wrote that document coordinate as a normal-flow `margin-left`. A margin is relative to the host parent's content origin, not the document origin. The calculation was therefore only correct while the parent happened to start at zero, and it also omitted target borders from the content-box width.

**Pre-existing bug in `lib/i18n.ts`:** Module-level side effect calling `browser.i18n.getUILanguage()` at load time broke WXT build-time vite-node evaluation when the new content script was first built. Fixed by lazy-loading the i18n function (module load no longer executes environment-dependent code).

**Regression test mislabel:** The regression test and comments mistakenly listed `#search` as "SPA-swapped/forbidden". This conflated Google's `#search` (element identity persists across SPA nav) with Bing's `#b_results` (aggressively rebuilt). Corrected.

## Solution

The final solution combines one shared host-layout primitive with engine-specific structural boundaries.

### Restore the host inside the shadow cascade

Pass the component stylesheet through `createShadowRootUi`'s `css` option. WXT appends this CSS after its reset inside the same shadow context:

```typescript
const ui = await createShadowRootUi(ctx, {
  name: 'juso-serp-bar',
  position: 'inline',
  anchor: strategy.selector,
  append: strategy.append,
  css: serpBarStyles,
  onMount(uiContainer, _shadow, shadowHost) {
    syncAlignedHost(shadowHost, strategy);
    // Mount React into uiContainer.
  },
});
```

Static host longhands are restored by later shadow-tree important declarations. Runtime code does not attempt to override those longhands from the outer document. It writes only two namespaced custom properties:

```css
:host {
  display: block !important;
  position: relative !important;
  z-index: 20 !important;
  box-sizing: border-box !important;
  padding: 8px 0 !important;
  margin-left: var(--juso-serp-offset-left, 0px) !important;
  width: var(--juso-serp-width, auto) !important;
  visibility: visible !important;
  pointer-events: auto !important;
}
```

CSS `all` does not reset custom properties, so the outer host can safely provide dynamic values consumed by the later inner rule.

### Choose an outer boundary per engine

The original engine split landed in commit 9351872. Commits 6f2c511 and 3b98e43 completed it by fixing the shadow cascade/geometry bridge and raising Google above the full result container:

### Google: `#rcnt` + `before` + `#center_col` content-box synchronization

```typescript
// Each engine now declares its anchor inline as `engine.anchor`
// (lib/engines/google.ts, lib/engines/bing.ts):
//   google: { selector: '#rcnt', append: 'before', alignTo: '#center_col' }
//   bing:   { selector: '#b_content', append: 'before', alignTo: '#b_content' }
```

The host becomes a preceding sibling of the complete `#rcnt` results container, so it is before both the AI Overview wrapper and `#center_col`. It uses the same parent-relative content-box calculation as Bing to align with `#center_col`. On the measured 883px AIO viewport, `#center_col` is `left=52, width=652`; the runtime subtracts the actual host parent's content origin instead of assuming document coordinates. This structural strategy also applies to ordinary result pages without AIO; it does not depend on detecting any AI-specific node.

### Bing: `#b_content` + `before` + runtime content-box synchronization

```typescript
// bing engine anchor (lib/engines/bing.ts) — engine.anchor
bing: { selector: '#b_content', append: 'before', alignTo: '#b_content' },
```

When the strategy has `alignTo` set, the content script syncs the host's position on mount, on resize, and on `wxt:locationchange`. The target is the **Bing main result area `#b_content` content box**, not the search input.

```typescript
function syncAlignedHost(host: HTMLElement, strategy: AnchorStrategy): void {
  if (!strategy.alignTo) return;
  const target = document.querySelector(strategy.alignTo);
  const parent = host.parentElement;
  if (!(target instanceof HTMLElement) || !(parent instanceof HTMLElement)) return;
  const layout = calculateAlignedHostLayout(
    parent.getBoundingClientRect(),
    readHorizontalBoxStyle(window.getComputedStyle(parent)),
    target.getBoundingClientRect(),
    readHorizontalBoxStyle(window.getComputedStyle(target)),
  );
  host.style.setProperty('--juso-serp-offset-left', `${layout.offsetLeft}px`, 'important');
  host.style.setProperty('--juso-serp-width', `${layout.width}px`, 'important');
}
```

`calculateAlignedHostLayout` is a DOM-independent helper. Parent and target rectangles both remain in viewport coordinates; the helper computes the target content box relative to the actual host-parent content origin:

```typescript
const parentContentLeft = parentRect.left + parentStyle.borderLeft + parentStyle.paddingLeft;
const targetContentLeft = targetRect.left + targetStyle.borderLeft + targetStyle.paddingLeft;
const targetContentWidth =
  targetRect.width - targetStyle.borderLeft - targetStyle.borderRight
  - targetStyle.paddingLeft - targetStyle.paddingRight;

return {
  offsetLeft: Math.max(0, targetContentLeft - parentContentLeft),
  width: Math.max(0, targetContentWidth),
};
```

No `scrollX` conversion is involved, borders and paddings are accounted for, and negative values clamp to zero. `syncAlignedHost` exposes the result only through the namespaced variables:

```typescript
host.style.setProperty('--juso-serp-offset-left', `${layout.offsetLeft}px`, 'important');
host.style.setProperty('--juso-serp-width', `${layout.width}px`, 'important');
```

The host is a body-level sibling placed BEFORE `#b_content`. This keeps it outside `#b_content`'s legacy inline result layout entirely — the overlapping `#b_tween` layer cannot steal clicks.

### Events that trigger position sync

```typescript
// On mount (called directly from onMount)
// On wxt:locationchange (SPA nav)
ctx.addEventListener(window, 'wxt:locationchange', () => {
  if (mountedHost) syncAlignedHost(mountedHost, strategy);
});
// On resize
ctx.addEventListener(window, 'resize', () => {
  if (mountedHost) syncAlignedHost(mountedHost, strategy);
});
```

## Why This Works

**Root cause**: Google and Bing SERP DOM layout and SPA behavior are qualitatively different:

| Aspect | Google | Bing |
|--------|--------|------|
| Results container | `#rcnt` (contains AIO and `#center_col`) | `#b_results` (aggressively rebuilt on pushState) |
| Results shell | `#center_col` (main column, aligned dynamically) | `#b_content` (stable outer shell) |
| Layout model | Block/flow — no overlapping layers | Legacy inline layout with `inline-block` children and `position: relative` overlapping elements |
| SPA behavior | Inner content swapped, top-level elements preserved | DOM rebuilt aggressively including parent ordering |

A unified anchor strategy must either: (a) live inside an engine's layout and risk hit-test offset on Bing, or (b) live outside and risk misalignment on both engines, or (c) live outside and track alignment for both. Google and Bing use the third layout pattern with engine-specific persistent shells and alignment targets, while retaining their distinct DOM anchors.

The shared host primitive works because responsibilities are separated at the actual browser boundaries:

1. The shadow stylesheet owns static host longhands in the same encapsulation context as WXT's reset.
2. Namespaced custom properties bridge dynamic values across the reset without competing for the longhand cascade.
3. Parent and target rectangles stay in one coordinate system, and the helper converts target content geometry into a parent-relative offset.
4. Each engine chooses an outer structural boundary that precedes its complete result experience and avoids replaceable or overlapping internals.

The **Bing fix** works because:
1. **The host lives outside `#b_content`** — it is a body-level sibling inserted before `#b_content`, not inside it. This avoids participation in Bing's legacy inline flow entirely. The overlapping `#b_tween` layer inside `<main>` cannot steal clicks from the host.
2. **`#b_content` is a persistent shell** — it is not SPA-swapped. Only its internal children are rebuilt. The host survives navigation.
3. **The custom shadow stylesheet follows WXT's reset** — its important host rules restore display, positioning, hit-testing, visibility, and box sizing in the same encapsulation context. External inline important longhands do not override the shadow reset.
4. **Runtime position synchronization** via paired `getBoundingClientRect()` values on mount, resize, and SPA navigation keeps the bar aligned to the Bing main result area's `#b_content` content box without participating in that column's layout. The offset is parent-relative, so it remains correct when the body has non-zero border or padding.

The **Google fix** works because:
1. **The host is outside `#rcnt`** — it precedes the entire result container, so it appears before a Google AI Overview regardless of whether that module exists.
2. **`#center_col` provides the correct horizontal target** — paired viewport rects convert its content box into a parent-relative offset and width without assuming document coordinates.
3. **No AIO selector is required** — normal and AIO result pages have the same `#rcnt`/`#center_col` strategy, so no observer, timer, or re-mount behavior is needed.

## Prevention

- **Never use `autoMount()` with function anchors as a workaround for SPA-rebuilt elements** — the `isNotExist`/`waitElement` ping-pong deadlocks when DOM mutation is coalesced into a single microtask. Instead, anchor to a persistent parent shell that survives SPA navigation.
- **Verify regression test assumptions about specific DOM elements** — the `#search` element was incorrectly labeled "SPA-swapped" in comments and tests because it was conflated with Bing's `#b_results`. Always verify each engine's element lifecycle independently.
- **Test anchor strategies on each engine independently** — do not assume a strategy that works on one engine will work on another. Google and Bing SERP DOM are qualitatively different.
- **Anchor Google above `#rcnt`, not merely above `#search`** — AIO is a preceding `#rcnt` child. Keep `#center_col` solely as the content-box alignment target and record real-page geometry in the regression tests.
- **When using `createShadowRootUi`, restore the host in custom shadow CSS after WXT's reset** — WXT's `:host { all: initial !important }` resets display, visibility, position, and pointer events. Shadow-tree important declarations take precedence over external host inline important declarations, so external code should pass dynamic values through namespaced CSS custom properties instead of host longhands.
- **Add regression tests for each engine independently** — the test suite should cover Google and Bing SPA navigation scenarios separately, verifying bar presence and clickability after pushState.
- **Test with real browser layout** — unit tests and jsdom cannot catch inline flow interaction bugs like hit-test offset. Use browser-level testing (Playwright, dogfood) to verify click targets and visual alignment.
- **Lock the complete strategy objects** — tests assert Bing `{ selector: '#b_content', append: 'before', alignTo: '#b_content' }` and Google/default `{ selector: '#rcnt', append: 'before', alignTo: '#center_col' }`, not selectors alone.
- **Preserve measured geometry cases** — Bing must produce `offsetLeft=113`, `width≈983.667`; Google must produce `offsetLeft=52`, `width=652`; a non-zero parent/border/padding case must remain to prevent document-origin regressions.
- **Treat jsdom as a contract test, not browser proof** — unit tests can lock strategy data, formulas, and CSS text, but real DevTools must confirm computed styles, rectangles, hit testing, AIO ordering, resize, and SPA navigation.
- **Run the complete repository checks after anchor changes** — `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` all passed for the final fixes (`295` tests).

## Related Issues

- Commit `d8dde21` — original `pickAnchor()` design
- Commit `244ba66` — `autoMount()` attempt (failed)
- Commit `2484a79` — persistent anchor attempt (left-offset)
- Commit `e65ddf4` — centered column attempt (click offset)
- Commit `9351872` — original engine-specific strategy split
- Commit `6f2c511` — restores the Bing host in shadow CSS and introduces parent-relative content-box alignment
- Commit `3b98e43` — places the Google host before `#rcnt` and aligns it to `#center_col` above AI Overview
- `lib/i18n.ts` — module-level side effect bug discovered during Phase 2
- `docs/solutions/architecture-patterns/serp-switch-bar-and-unified-source-model.md` — the SERP bar architecture doc (anchor sections now superseded by this fix)
