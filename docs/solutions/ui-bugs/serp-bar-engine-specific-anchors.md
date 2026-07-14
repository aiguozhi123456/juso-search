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
  - "Bing SERP bar fails to appear or leaves a blank gap"
  - "Google SERP bar left edge misaligned with search box"
  - "Bing clickable chip position offset from visual position"
root_cause: logic_error
resolution_type: code_fix
tags:
  - chrome-mv3
  - wxt
  - content-script
  - bing
  - google
  - shadow-dom
  - serp-bar
related_components:
  - lib/engines/google.ts
  - lib/engines/bing.ts
  - lib/engines/registry.ts
  - entrypoints/shared/serp-bar-styles.ts
---

# Engine-Specific Shadow DOM Anchors for SERP SourceSwitcher

## Problem

The "聚搜" Chrome extension injects a `SourceSwitcher` UI bar into Google and Bing SERP pages via WXT's `createShadowRootUi` (shadow DOM). A single unified anchor strategy could not satisfy both search engines: Google and Bing differ fundamentally in their DOM layout and SPA navigation behavior, causing alignment failures, click-target offset, or permanent bar disappearance after SPA navigation.

## Symptoms

- Bing: the SourceSwitcher bar vanishes after performing a new search (SPA pushState navigation). The bar also appeared left-offset (full-bleed, x=0) when anchored to page-level persistent elements that sit outside the centered results column.
- Bing: when the bar is placed inside the results column, click hit-tests are offset — the visible button position does not match the clickable region because the shadow DOM host participates in Bing's legacy inline flow and overlapping transparent layers steal mouse events.
- Google: the bar appears left-offset when anchored to `#cnt` or `#appbar` because those elements' positioning does not align with the search box column.
- All engines: the bar disappears permanently on Bing SPA navigation when anchored to `#b_results` because that element is aggressively rebuilt on pushState.

## What Didn't Work

**Phase 1 — `pickAnchor()` with `append:'before'` on `#search`/`#rso`/`#b_results` (d8dde21):** The initial design used `mount()` with a runtime anchor selector (`#search` for Google, `#b_results` for Bing). Works on initial load. Bing fails on SPA navigation because Chrome content scripts do not re-run on pushState/replaceState. The `wxt:locationchange` handler triggers re-render but the shadow DOM host is a sibling of `#b_results` — when Bing rebuilds `#b_results`, the host is detached and never re-mounted.

**Phase 2 — `autoMount()` with function anchor (244ba66):** Replaced `mount()` with `autoMount()` and a function anchor. Hypothesis: `autoMount` observes the anchor and re-mounts when the SPA removes/re-adds the results container. Failed because:
- The function anchor is called once at setup to freeze the selector string — mechanically identical to a plain string anchor (`shared.mjs:95`).
- `autoMount`'s `isNotExist` ping-pong deadlocks on coalesced SPA swaps: Bing removes old `#b_results` and adds new `#b_results` in one synchronous task. The `MutationObserver` batches into one microtask after the swap completes. `getAnchor()` at that point returns the **new** node, so `isNotExist(newNode)` returns false. The `waitElement` with `isNotExist` never resolves. The re-mount cycle parks forever (`shared.mjs:103`, `index.mjs:52-71`).
- The host is a sibling of `#b_results` inside the anchor's parent (`shared.mjs:52`). When Bing rebuilds the parent's children, the host is detached. Combined with the deadlock, the bar vanishes permanently.

**Phase 3 — Persistent anchors `#b_header` / `#appbar` with `append:'after'` (2484a79):** Reverted to `mount()`. Used `#b_header` (Bing) and `#appbar` (Google) — page-level persistent elements not swapped during SPA navigation. The host becomes a body-level sibling (full-bleed, x=0) while Bing's search box and results are in a centered fixed-width column (`#b_header { width: 1243px; margin: 0 auto }`, left edge ≈ 338px at 1920px). This caused left-offset misalignment. Same issue on Google.

**Phase 4 — Centered column `#b_content` / `#cnt` with `append:'first'` (e65ddf4):** Switched to `#b_content` + `first` (Bing) and `#cnt` + `first` (Google). The host lives inside the centered column and inherits alignment automatically. Google alignment mostly worked but Bing suffered click hit-test offset. Root cause: WXT's `createShadowRootUi` inserts `:host { all: initial !important }` in shadow CSS (`shadow-root.mjs:19`), overriding the non-important `:host { display: block }` from `serp-bar-styles.ts`. The host becomes inline/initial. Bing's `#b_content` has legacy inline result layout: `<main>` and `<aside>` are inline, `#b_results` and `#b_context` are `inline-block`, and `#b_tween` inside `<main>` has `margin-top: -28px` with `position: relative`. This overlapping transparent layer steals mouse events — the visual button position does not equal the clickable region.

**Pre-existing bug in `lib/i18n.ts`:** Module-level side effect calling `browser.i18n.getUILanguage()` at load time broke WXT build-time vite-node evaluation when the new content script was first built. Fixed by lazy-loading the i18n function (module load no longer executes environment-dependent code).

**Regression test mislabel:** The regression test and comments mistakenly listed `#search` as "SPA-swapped/forbidden". This conflated Google's `#search` (element identity persists across SPA nav) with Bing's `#b_results` (aggressively rebuilt). Corrected.

## Solution

The fix implements **engine-specific anchor strategies** (commit 9351872), acknowledging that Google and Bing SERP DOM and SPA behavior are fundamentally different. Two independent strategies, selected at mount time based on the engine:

### Google: `#search` + `before` (original Phase 1 anchor)

```typescript
// Each engine now declares its anchor inline as `engine.anchor`
// (lib/engines/google.ts, lib/engines/bing.ts); values unchanged:
//   google: { selector: '#search', append: 'before' }
//   bing:   { selector: '#b_content', append: 'before', alignTo: '#b_content' }
```

The host becomes a preceding sibling of `#search` inside `#center_col` (Google's centered results column), automatically inheriting the column's left alignment with the search box. `#search` element identity persists across Google SPA navigation — only the inner `#rso` results subtree is updated — so the host is not taken down.

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
  const layout = calculateAlignedHostLayout(parentRect, parentStyle, targetRect, targetStyle);
  host.style.setProperty('--juso-serp-offset-left', `${layout.offsetLeft}px`, 'important');
  host.style.setProperty('--juso-serp-width', `${layout.width}px`, 'important');
}
```

`calculateAlignedHostLayout` is a DOM-independent helper: it calculates each content left as `rect.left + borderLeft + paddingLeft`, calculates target content width by subtracting both borders and paddings, then subtracts the parent content left from the target content left. Both results clamp to zero. No scroll offset is involved because both rects are in the same viewport coordinate system.

The host is a body-level sibling placed BEFORE `#b_content`. This keeps it outside `#b_content`'s legacy inline result layout entirely — the overlapping `#b_tween` layer cannot steal clicks.

The static host layout is defined in the custom shadow CSS passed as `css: serpBarStyles`:

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
}
```

This stylesheet is inserted after WXT's shadow reset. For the host, shadow-tree important declarations have encapsulation-context precedence over external important inline declarations. Therefore external inline longhand styles cannot reliably defeat `:host { all: initial !important }`; only the two namespaced custom properties are set externally.

### Events that trigger position sync (Bing)

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
| Results container | `#search` (element identity persists across SPA) | `#b_results` (aggressively rebuilt on pushState) |
| Results shell | `#center_col` (stable) | `#b_content` (stable outer shell) |
| Layout model | Block/flow — no overlapping layers | Legacy inline layout with `inline-block` children and `position: relative` overlapping elements |
| SPA behavior | Inner content swapped, top-level elements preserved | DOM rebuilt aggressively including parent ordering |

A unified anchor strategy must either: (a) live inside an engine's layout and risk hit-test offset on Bing, or (b) live outside and risk misalignment on both engines, or (c) live outside and track alignment for both — but Google's `#search` solution is simpler and more robust, so there is no reason to force a unified approach.

The **Bing fix** works because:
1. **The host lives outside `#b_content`** — it is a body-level sibling inserted before `#b_content`, not inside it. This avoids participation in Bing's legacy inline flow entirely. The overlapping `#b_tween` layer inside `<main>` cannot steal clicks from the host.
2. **`#b_content` is a persistent shell** — it is not SPA-swapped. Only its internal children are rebuilt. The host survives navigation.
3. **The custom shadow stylesheet follows WXT's reset** — its important host rules restore display, positioning, hit-testing, visibility, and box sizing in the same encapsulation context. External inline important longhands do not override the shadow reset.
4. **Runtime position synchronization** via paired `getBoundingClientRect()` values on mount, resize, and SPA navigation keeps the bar aligned to the Bing main result area's `#b_content` content box without participating in that column's layout. The offset is parent-relative, so it remains correct when the body has non-zero border or padding.

The **Google fix** works because:
1. **`#search` is not SPA-swapped** — unlike Bing's `#b_results`, Google's `#search` element identity persists across SPA navigation (only the inner `#rso` subtree updates). The host remains attached.
2. **`#center_col` provides free alignment** — the host is a preceding sibling of `#search` inside `#center_col`, Google's centered results column. The host inherits the column's left alignment with the search box automatically.
3. **No overlay/layer stealing** — Google's simpler block layout does not have the overlapping transparent layers that Bing has.

## Prevention

- **Never use `autoMount()` with function anchors as a workaround for SPA-rebuilt elements** — the `isNotExist`/`waitElement` ping-pong deadlocks when DOM mutation is coalesced into a single microtask. Instead, anchor to a persistent parent shell that survives SPA navigation.
- **Verify regression test assumptions about specific DOM elements** — the `#search` element was incorrectly labeled "SPA-swapped" in comments and tests because it was conflated with Bing's `#b_results`. Always verify each engine's element lifecycle independently.
- **Test anchor strategies on each engine independently** — do not assume a strategy that works on one engine will work on another. Google and Bing SERP DOM are qualitatively different.
- **When using `createShadowRootUi`, restore the host in custom shadow CSS after WXT's reset** — WXT's `:host { all: initial !important }` resets display, visibility, position, and pointer events. Shadow-tree important declarations take precedence over external host inline important declarations, so external code should pass dynamic values through namespaced CSS custom properties instead of host longhands.
- **Add regression tests for each engine independently** — the test suite should cover Google and Bing SPA navigation scenarios separately, verifying bar presence and clickability after pushState.
- **Test with real browser layout** — unit tests and jsdom cannot catch inline flow interaction bugs like hit-test offset. Use browser-level testing (Playwright, dogfood) to verify click targets and visual alignment.

## Related Issues

- Commit `d8dde21` — original `pickAnchor()` design
- Commit `244ba66` — `autoMount()` attempt (failed)
- Commit `2484a79` — persistent anchor attempt (left-offset)
- Commit `e65ddf4` — centered column attempt (click offset)
- Commit `9351872` — engine-specific anchor strategies (the fix)
- `lib/i18n.ts` — module-level side effect bug discovered during Phase 2
- `docs/solutions/architecture-patterns/serp-switch-bar-and-unified-source-model.md` — the SERP bar architecture doc (anchor sections now superseded by this fix)
