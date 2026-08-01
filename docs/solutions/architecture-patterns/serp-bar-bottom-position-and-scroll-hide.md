---
title: "SERP Switch Bar bottom-position model: fixed overlay, groups coexistence, and CSS/interaction traps"
date: 2026-07-29
last_updated: 2026-08-01
category: docs/solutions/architecture-patterns/
module: SERP Switch Bar
problem_type: architecture_pattern
component: tooling
severity: medium
applies_when:
  - "Adding a new position variant (top/bottom/auto) to a shadow-DOM-injected UI element driven by a content script"
  - "Implementing scroll-to-hide behavior on a position:fixed bar that must survive SPA navigations"
  - "Resolving an auto position preference against viewport width with a mobile-first breakpoint"
  - "Wiring a user preference through the full MV3 stack: storage -> schema -> ui-pref-sync -> background broadcast -> content-script hook -> component"
  - "Handling mobile visual polish: backdrop blur, safe-area insets, larger touch targets, centered chips"
  - "Resetting CSS rules inherited from a sibling variant (e.g. flex-wrap) when switching positioning modes"
  - "Keeping fixed-bar hide state consistent across SPA route changes that do not remount the content script"
  - "Merging two parallel feature tracks that both touch the same shadow-DOM UI region (bottom bar + source groups)"
  - "Debugging a fixed flyout/popover that vanishes or mis-anchors under overflow:auto or backdrop-filter ancestors"
  - "Wiring touch-friendly open/close on a popover where focus-open races click-toggle"
  - "Adding a config knob to an import/export pipeline without a schema version bump"
tags:
  - serp-bar
  - bottom-bar
  - scroll-hide
  - mobile
  - shadow-dom
  - content-script
  - mv3
  - wxt
  - coexistence
  - containing-block
  - flyout
  - touch
---

# SERP Switch Bar bottom-position variant with scroll-to-hide and mobile polish

## Context

The SERP Switch Bar (快切栏) was **top-only**. On every supported engine it is inserted as an *inline anchor* — a preceding sibling of a persistent results container (`#rcnt` on Google, `#b_content` on Bing, `#container` on Baidu, etc.), horizontally aligned to the main content column via parent-relative `getBoundingClientRect()` math. That model works well on desktop, where the bar sits naturally above the fold. But mobile users had no thumb-friendly option: the top of a SERP is the least reachable region of the screen, and the inline-anchor model pushes the bar even further from the thumb once results render.

A "bottom" position was developed on a feature branch that **diverged from main**. Adding a bottom bar is not a matter of reusing the existing anchor machinery: the per-engine inline-anchor model is structurally incapable of generalizing to a bottom bar (there is no persistent "bottom of results" element that survives SPA navigation across six engines, and even if there were the bar would scroll away). A bottom bar is fundamentally a **fixed viewport overlay** — `position: fixed; bottom: 0` — not an inline DOM insertion. That single difference cascades into a different positioning model (pad the page so the fixed bar does not cover content), a different interaction model (scroll-to-hide so the overlay yields screen real estate), and a mobile polish layer (safe-area insets, horizontal chip scroll).

While the bottom-bar branch was in flight, **main independently added two things**: *source groups* (collapsible group pills with hover/click flyouts, projected by `projectLayout`) and *schema v5* (the `groupConfig` whitelist entry). The bottom-bar branch never saw groups — it shipped a flat row of chips. Only the **tip commit** (the bottom bar itself) was cherry-picked onto the now-groups-aware main. The merge therefore had to resolve conflicts between two parallel feature tracks that both reshape the same shadow-DOM UI region, and then fix the **coexistence bugs** that neither track's tests caught alone — because each track was tested in isolation against a UI the other track had already transformed. Three rounds of Oracle review surfaced and closed the traps (backdrop-filter containing block, overflow-clipping subtlety, touch focus/click race, shadow-safe outside dismiss, scroll-hide/flyout interplay). The coexistence fixes are the core learning recorded here: they are not one-off mistakes but recurring traps for *any* fixed-position overlay that also hosts a flyout/popover child.

This document captures the architecture pattern that emerged: two positioning models bridged by a `data-position` host attribute; a single `applyPositionChrome` helper that unifies every position-transition path; a compact mobile track with active-centering; the groups × bottom coexistence traps and their fixes; a config knob added without a schema bump; and the bottom-mode rule that engine pageStyles must be skipped.

## Guidance

### 1. Two positioning models — top (per-engine inline anchor) vs bottom (universal fixed overlay)

The two positions are structurally different and must not share an anchor strategy.

**Top** is *per-engine inline*: each engine declares an anchor cascade (`engine.anchors`) and an alignment target (`engine.alignTo`); the content script inserts the host as a sibling of a persistent container and syncs `--juso-serp-offset-left` / `--juso-serp-width` from the target's content box. Some engines are themselves fixed (Douyin pins the bar under its 56px search header):

```css
:host([data-engine="douyin"]) {
  position: fixed !important;
  top: 56px !important;
  left: var(--juso-serp-left, 72px) !important;
  width: var(--juso-serp-width, 801px) !important;
  max-width: calc(100vw - 24px) !important;
  z-index: 600 !important;
}
```

**Bottom** is *universal*: `position: fixed; bottom: 0; width: 100%` ignores every engine's DOM. No anchor, no alignment target. One CSS block serves all six engines:

```css
:host([data-position="bottom"]) {
  position: fixed !important;
  bottom: 0 !important;
  left: 0 !important;
  right: 0 !important;
  width: 100% !important;
  margin-left: 0 !important;
  max-width: none !important;
  z-index: 600 !important;
  /* ...mobile polish... */
}
/* Explicit reset so Douyin's top:56px does not survive into bottom mode. */
:host([data-engine="douyin"][data-position="bottom"]) {
  top: auto !important;
  left: 0 !important;
  width: 100% !important;
  max-width: none !important;
}
```

The two are bridged by a `data-position` host attribute — the same convention as the existing `data-engine` / `data-theme` / `data-style` bridge. Because WXT's `createShadowRootUi` injects the stylesheet inside the shadow root, the only way for CSS to branch on runtime conditions is for `onMount` (and later event handlers) to stamp attributes on the outer host, and for `:host([data-...])` selectors to react. The bottom block is placed **at the end of the stylesheet** so that, at equal specificity, source order lets it override engine-specific top-positioning rules.

Which model applies is resolved by a pure function with a 480px mobile breakpoint:

```typescript
/** auto 模式：视口宽度 <= 480px 时用底栏，否则顶栏。 */
export function resolveBarPosition(pref: BarPositionPref, viewportWidth: number): 'top' | 'bottom' {
  if (pref === 'top') return 'top';
  if (pref === 'bottom') return 'bottom';
  return viewportWidth <= 480 ? 'bottom' : 'top';
}
```

`auto` (the default) is re-resolved against the live viewport on every `resize`, every SPA navigation, and every live pref-sync message — it is never stored as a resolved value. The rule for adopting this pattern: **any runtime-switchable visual axis becomes a `data-*` host attribute, never an inline `style` longhand.** Inline longhands on the outer host lose to WXT's `:host { all: initial !important }` shadow reset; the attribute bridge keeps the cascade inside the shadow context where it can win, and keeps the stylesheet the single source of layout truth.

### 2. `applyPositionChrome` unification — one helper for every position-transition path

A position can flip on five independent paths: initial `onMount`, SPA `syncLocation`, viewport `resize` (auto threshold crossing), live `onPrefMessage` (user toggled the pref in Options), and the scroll-hide baseline. Each path has different guards, but the **position-transition body** is identical. Rather than scatter that logic, a single helper centralizes it:

```typescript
/**
 * Apply position chrome: dataset, pageStyles vs pad, scroll-hide baseline.
 * Does NOT render — callers re-render when React props (e.g. bottomMode) must change.
 */
const applyPositionChrome = (pos: 'top' | 'bottom', opts?: { resetScrollBaseline?: boolean }) => {
  if (!mountedHost) return;
  mountedHost.dataset.position = pos;
  if (pos === 'bottom') {
    // bottom must NOT keep top-bar engine shims (Douyin etc.)
    removePageStyles();
    injectBottomPadStyles();
    delete mountedHost.dataset.hidden;
    if (opts?.resetScrollBaseline !== false) lastScrollY = window.scrollY;
  } else {
    removeBottomPadStyles();
    injectPageStyles(state.engine);
    delete mountedHost.dataset.hidden;
    lastScrollY = 0;
  }
};
```

Every position-change path calls it, then re-renders so the `bottomMode` prop enters the React tree (the flyout anchoring and touch handlers branch on `bottomMode`; outside-dismiss is unified across both modes since 2026-08-01 — see §4e):

```typescript
// onMount (serp-bar.content.ts:229)
applyPositionChrome(state.resolvedPosition);

// syncLocation — SPA nav (serp-bar.content.ts:422)
applyPositionChrome(state.resolvedPosition);
syncAlignedHost(mountedHost, strategy);
if (mountedRoot) render(mountedRoot, state, selectSource, selecting);

// resize — auto threshold crossing (serp-bar.content.ts:444-455)
ctx.addEventListener(window, 'resize', () => {
  if (mountedHost && document.contains(mountedHost)) {
    syncAlignedHost(mountedHost, strategy);
    const next = resolveBarPosition(state.barPositionPref, window.innerWidth);
    if (next !== state.resolvedPosition) {
      state.resolvedPosition = next;
      applyPositionChrome(next);
      // bottomMode 进 React 树：位置变化必须 re-render。
      if (mountedRoot) render(mountedRoot, state, selectSource, selecting);
    }
  }
});

// onPrefMessage — live sync from Options (serp-bar.content.ts:462-471)
const onPrefMessage = (message: unknown) => {
  if (!isUiPrefChangedMessage(message) || message.key !== 'serpBarPosition') return;
  state.barPositionPref = message.value;
  const next = resolveBarPosition(message.value, window.innerWidth);
  if (next === state.resolvedPosition) return;
  state.resolvedPosition = next;
  if (!mountedHost) return;
  applyPositionChrome(next);
  if (mountedRoot) render(mountedRoot, state, selectSource, selecting);
};
```

Three discipline points:

- **The helper owns the four operations** (stamp `data-position`, swap pageStyles↔pad, clear `data-hidden`, baseline `lastScrollY`); callers own only their own guards and the re-render. This makes each path auditable without duplicating the transition body.
- **No-op when resolved position is unchanged.** The `resize` and `onPrefMessage` paths early-return when `next === state.resolvedPosition`, so toggling `top → auto` on a wide viewport (both resolve to `top`) never touches the DOM.
- **`resetScrollBaseline` is the one escape hatch.** `onMount` passes it implicitly (defaults to true); a path that must preserve the existing scroll baseline can pass `{ resetScrollBaseline: false }`.

### 3. Compact mobile track + active centering

The bottom bar is the mobile-first surface, so it is deliberately **compact**. The bar's vertical footprint shrank from the tip-branch's 56px to ~36px (host `padding: 4px 8px`), and the page pad mirrors the real footprint:

```typescript
/** 扁底栏 footprint（与 serp-bar-styles 底栏 padding/chip 同源）：
 *  上下 padding ~4px×2 + chip ~28px ≈ 36px，用 40px 留余量。 */
export const BOTTOM_BAR_PAD_PX = 40;

export function injectBottomPadStyles(doc: Document = document): void {
  const existing = doc.head.querySelector<HTMLStyleElement>(`style#${BOTTOM_PAD_STYLES_ID}`);
  if (existing) existing.remove();
  const styleEl = doc.createElement('style');
  styleEl.id = BOTTOM_PAD_STYLES_ID;
  styleEl.textContent = `html{padding-bottom:calc(${BOTTOM_BAR_PAD_PX}px + env(safe-area-inset-bottom,0px)) !important}`;
  doc.head.append(styleEl);
}
```

The pad is a **separate `<style>` id** (`juso-serp-bottom-pad`) from the engine shim (`juso-serp-page-styles`). The engine shim is removed/re-injected on every mount and SPA navigation; if the pad shared that id, an engine remount would wipe the pad. The dedicated id is inject/remove-idempotent and lifecycle-independent of the engine shim. The pad height includes `env(safe-area-inset-bottom)` so the page's last scrollable content does not slide under the iOS home indicator — the bar's own `padding-bottom: calc(4px + env(safe-area-inset-bottom))` lifts its chips above the indicator, and the pad must mirror the bar's total footprint.

Horizontal chip scroll lives on a dedicated **`.switcher-track`** element, not on `.source-switcher`. Separating the scroll container from the flyout host is what lets the fixed flyout escape the scroll clip (see §4b). The track is `nowrap` with a hidden scrollbar:

```css
:host([data-position="bottom"]) .switcher-track {
  display: flex !important;
  flex-wrap: nowrap !important;
  justify-content: flex-start !important;
  width: 100% !important;
  max-width: 100% !important;
  overflow-x: auto !important;
  overflow-y: hidden !important;
  scrollbar-width: none !important;
  -webkit-overflow-scrolling: touch !important;
  padding: 2px 4px !important;
  gap: 2px !important;
  /* 半透明底色提供"磨砂"观感；不放 backdrop-filter——它是 fixed flyout 的祖先，
   * 会建立 containing block 并配合 overflow-y:hidden 裁切向上浮层。host 同理不带。 */
  background: color-mix(in srgb, var(--bg) 88%, transparent) !important;
}
:host([data-position="bottom"]) .switcher-track::-webkit-scrollbar {
  display: none !important;
}
```

The `!important` on `flex-wrap: nowrap` is **mandatory**, not stylistic: the base `.switcher-track` rule is `flex-wrap: wrap` (chips reflow on desktop). A non-important override would be sufficient by source order, but `!important` defends against any future base-rule change that adds `!important` to `wrap`. Horizontal scroll and wrap are mutually exclusive; `overflow-x: auto` does not imply `nowrap`.

The sliding indicator lives **inside the track** (same scroll context as the pills), and the active pill is scrolled to the track's horizontal center by a pure function:

```typescript
/**
 * 把 child 滚到 scrollParent 可视区域的水平中心。
 * 纯函数：只读写 scrollLeft，不依赖 React。clamp 到 [0, maxScroll]。
 */
export function scrollChildToCenter(scrollParent: HTMLElement, child: HTMLElement): void {
  const maxScroll = Math.max(0, scrollParent.scrollWidth - scrollParent.clientWidth);
  if (maxScroll <= 0) {
    scrollParent.scrollLeft = 0;
    return;
  }
  let childLeft = child.offsetLeft;
  let node: HTMLElement | null = child.offsetParent as HTMLElement | null;
  while (node && node !== scrollParent) {
    childLeft += node.offsetLeft;
    node = node.offsetParent as HTMLElement | null;
  }
  if (node !== scrollParent) {
    const parentRect = scrollParent.getBoundingClientRect();
    const childRect = child.getBoundingClientRect();
    childLeft = childRect.left - parentRect.left + scrollParent.scrollLeft;
  }
  const target = childLeft - (scrollParent.clientWidth - child.offsetWidth) / 2;
  scrollParent.scrollLeft = Math.min(maxScroll, Math.max(0, target));
}
```

Both the indicator measurement and the centering use `trackRef` as the measure root, so the indicator coordinates are in the track's own (scrolled) coordinate space:

```tsx
// Indicator: measured against the track (same scroll context as pills in bottom mode).
useLayoutEffect(() => {
  const measureRoot = trackRef.current ?? containerRef.current;
  if (!measureRoot || indicatorKey == null) { setIndicator(null); return; }
  const target = measureRoot.querySelector<HTMLElement>(`[data-key="${CSS.escape(indicatorKey)}"]`);
  if (!target) { setIndicator(null); return; }
  setIndicator({ x: target.offsetLeft, y: target.offsetTop, w: target.offsetWidth, h: target.offsetHeight });
}, [indicatorKey, layout, bottomMode]);

// Active centering: bottom mode only.
useLayoutEffect(() => {
  if (!bottomMode || centerKey == null) return;
  const track = trackRef.current;
  if (!track) return;
  const target = track.querySelector<HTMLElement>(`[data-key="${CSS.escape(centerKey)}"]`);
  if (!target) return;
  scrollChildToCenter(track, target);
}, [bottomMode, centerKey, layout]);
```

`scrollChildToCenter` is extracted to `lib/` as a pure function (injectable, testable in jsdom) rather than a content-script named export — the same extraction discipline as `resolveBarPosition` and `injectBottomPadStyles`, because content-script named exports break the WXT build.

### 4. Groups × bottom coexistence traps (the core learning)

This is the heart of the merge. Source groups add a **flyout** (`.group-flyout`) that, in top mode, is `position: absolute; top: 100%` — anchored to its trigger, clipped only by the (non-scrolling) page. In bottom mode that flyout must open **upward**, above the bar. The naive approach — keep it `absolute` — fails because the bar's own `overflow` and the page's bottom edge clip it. The fix is `position: fixed` with JS-anchored viewport coordinates. But making a descendant `fixed` inside a shadow host that is *itself* `fixed` and styled for scroll-hide exposes a chain of CSS-spec traps that cost a full Oracle round each.

#### 4a. `backdrop-filter` / `transform` / `filter` create a containing block for `position:fixed`

The CSS spec is non-obvious: a `position: fixed` element is normally contained by the **viewport** — *unless* an ancestor has `transform`, `perspective`, `filter`, `backdrop-filter: not none`, `will-change: transform`, or `contain: paint/layout/strict`. Any of those on an ancestor makes that ancestor the containing block, so the "fixed" child is positioned relative to the ancestor, not the viewport.

The bottom bar's host originally carried `backdrop-filter: saturate(180%) blur(20px)` (frosted glass). Once groups added a `position: fixed` flyout *inside the host*, that `backdrop-filter` made the host the flyout's containing block. The flyout's JS-anchored `left`/`bottom` (computed as viewport coordinates via `getBoundingClientRect`) were then interpreted relative to the host box, so the flyout landed in the wrong place and "vanish under overflow" followed (§4b).

**Fix: no `backdrop-filter`, `transform`, or `filter` on any ancestor of the fixed flyout** — host, `.source-switcher`, `.switcher-track`, `.switcher-group`. The frosted look is replaced by a `color-mix` translucent background only. The stylesheet encodes the reason inline so the trap is not re-introduced:

```css
:host([data-position="bottom"]) {
  /* ... */
  background: var(--bg) !important;
  background: color-mix(in srgb, var(--bg) 88%, transparent) !important;
  /* 不在 host 上用 backdrop-filter：会把 fixed 子元素的 containing block 变成 host，
   * 导致 flyout 的 left/bottom 视口坐标错位。毛玻璃改挂在 .switcher-track。 */
  transition: transform 280ms cubic-bezier(0.16, 1, 0.3, 1) !important;
}
:host([data-position="bottom"]) .switcher-track {
  /* ... */
  /* 半透明底色提供"磨砂"观感；不放 backdrop-filter——它是 fixed flyout 的祖先，
   * 会建立 containing block 并配合 overflow-y:hidden 裁切向上浮层。host 同理不带。 */
  background: color-mix(in srgb, var(--bg) 88%, transparent) !important;
}
```

The one `transform` that *does* appear — the scroll-hide `translateY(100%)` — is **gated behind `[data-hidden="true"]`**:

```css
:host([data-position="bottom"][data-hidden="true"]) {
  transform: translateY(100%) !important;
}
```

This is safe because scroll-hide **closes the flyout first** (§4f): by the time `data-hidden="true"` is stamped and the transform applies, `openGroupId` is already `null` and no fixed flyout is in the tree. The transform only ever exists when there is no fixed descendant to mis-contain. This gating is the load-bearing coincidence that lets scroll-hide and fixed-flyout coexist on the same host.

#### 4b. `overflow` clipping does *not* clip `position:fixed` — unless the scroll container is its containing block

A second spec subtlety: `overflow-x: auto` + `overflow-y: hidden` on the track does **not** clip a `position: fixed` descendant *unless* the track is that descendant's containing block. The track becomes a containing block only if it has `transform`/`filter`/`backdrop-filter` (§4a) — which we just removed. So with `backdrop-filter` gone, the fixed flyout **escapes** the track's `overflow-y: hidden` and renders viewport-true above the bar. 

This is the exact opposite of the naive intuition ("`overflow: hidden` clips everything inside it"). The trap is that the *first* instinct when a flyout vanishes is to add `overflow: visible` or remove the scroll container — but the real cause was an upstream `backdrop-filter` silently turning the scroll container into a containing block, at which point `overflow-y: hidden` *did* clip the flyout. Removing the `backdrop-filter` (not touching the overflow) is the fix. This round was the most expensive Oracle finding because the symptom (flyout clipped) pointed at the wrong property (overflow) while the root cause lived in an unrelated ancestor (host `backdrop-filter`).

#### 4c. Fixed upward flyout with JS-anchored coordinates

With the containing-block chain clean, the flyout is `position: fixed` and its `left`/`bottom` are written by JS from the trigger's viewport box. CSS only owns appearance:

```css
/* fixed 向上 flyout：位置由 JS 写入 left/bottom；样式只负责外观。 */
:host([data-position="bottom"]) .group-flyout--fixed-up {
  position: fixed !important;
  top: auto !important;
  z-index: 700 !important;
  padding-top: 4px !important;
  padding-bottom: 6px !important;
  box-shadow: 0 -6px 20px rgba(0,0,0,0.15) !important;
}
```

The anchor is computed in a `useLayoutEffect` that reads the trigger's `getBoundingClientRect()` and converts to viewport-relative `left` / `bottom: innerHeight - rect.top + 4` (4px gap above the trigger). It re-runs on `resize` and capture-phase `scroll` so the flyout tracks the trigger as the page scrolls:

```tsx
// 底栏 fixed flyout：按 trigger 视口盒锚定到上方（host 无 backdrop-filter 时 fixed 相对 viewport）。
useLayoutEffect(() => {
  if (!open || !bottomMode) { setFlyoutAnchor(null); return; }
  const trigger = triggerRef.current;
  if (!trigger) return;
  const update = () => {
    const rect = trigger.getBoundingClientRect();
    let left = rect.left;
    // 粗略右缘夹紧，避免 flyout 贴出视口（flyout 宽度未知时用 200 作下限估计）。
    const maxLeft = Math.max(0, window.innerWidth - 200);
    if (left > maxLeft) left = maxLeft;
    if (left < 0) left = 0;
    setFlyoutAnchor({ left, bottom: window.innerHeight - rect.top + 4 });
  };
  update();
  window.addEventListener('resize', update);
  window.addEventListener('scroll', update, true);
  return () => {
    window.removeEventListener('resize', update);
    window.removeEventListener('scroll', update, true);
  };
}, [open, bottomMode]);

const flyoutStyle: React.CSSProperties | undefined = bottomMode && flyoutAnchor
  ? { position: 'fixed', left: flyoutAnchor.left, bottom: flyoutAnchor.bottom, top: 'auto', right: 'auto' }
  : undefined;
```

#### 4d. Touch focus/click race — `onFocus` must not open in bottom mode

Top mode opens the flyout on `hover` *and* `focus` (keyboard users tab to the trigger and the flyout opens). Reusing that in bottom mode breaks touch: a tap fires `focus` (→ open) *then* `click` (→ toggle = close). The first tap therefore opens-then-closes = a no-op; the user must tap twice.

**Fix: `onFocus` returns early in `bottomMode`**; touch users open via `click → onToggle`, and keyboard users open via `Enter`/`Space → onToggle` (with `preventDefault` so the synthesized click does not double-toggle):

```tsx
onFocus={() => {
  // 底栏：不靠 focus 开层。触屏 focus 先于 click，若 focus 开层会被 click 关掉
  // （首次点触空操作）；键盘用户用 Enter/Space 触发 click→onToggle 开层。
  if (bottomMode) return;
  onOpen();
}}
// ...
onKeyDown={(e) => {
  if (e.key === 'Escape' && open) {
    triggerRef.current?.focus();
    onClose();
    return;
  }
  // 底栏键盘路径：Enter/Space 显式切换（与 click→onToggle 等价，兜底防止
  // 某些合成键盘事件不派发 click）。
  if (bottomMode && (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar')) {
    if (e.target === triggerRef.current) {
      e.preventDefault();
      e.stopPropagation();
      onToggle();
    }
  }
}}
// ...
onClick={(e) => {
  // 点击切换（两模式一致）：收起→打开并固定；瞬态展开→固定；固定→关闭。
  e.stopPropagation();
  onToggle();
}}
```

> **2026-08-01: click became the unified open/pin path in both modes.** The bottom-mode-only `onClick` (above) was generalized: `onToggle` is now a three-branch state machine — collapsed → open **and pin**; transiently open (hover/focus) → **pin**; pinned → close. Hover/focus still open *transiently* via `onOpen` (which clears any other group's pin; hovering back onto a previously pinned group does not restore the pin), while `scheduleClose` skips its delayed close when the group is pinned (`pinnedRef`). So the hover/focus path is transient open; **only click pins**. Outside-dismiss (§4e), Escape, and blur all clear the pin. See [source-switcher-click-to-pin](../ui-bugs/source-switcher-click-to-pin.md).

A secondary touch guard: `onMouseEnter` is suppressed on coarse pointers so a tap does not leave a sticky hover-open state after the finger lifts:

```tsx
onMouseEnter={() => {
  // 底栏 + 粗指针（触屏）：禁用 hover 开层，避免点触后 hover 粘滞。
  if (bottomMode && typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches) return;
  cancelClose();
  onOpen();
}}
```

The lesson: **touch interaction cannot reuse desktop hover/focus patterns without race analysis.** Anywhere a `focus` handler and a `click` handler both mutate the same open-state, touch will fire both in sequence. Either gate `focus` out of the touch path or make `click` idempotent against the `focus`-initiated state.

#### 4e. Shadow-safe outside dismiss — `document` capture + `composedPath()`

Top mode closes a *transiently-open* flyout on `mouseleave` (with a 120ms hover-intent delay for the trigger/flyout seam). Touch has no reliable hover-out, and a pinned flyout (click-to-pin, §4d) has no hover-out by definition — so **both modes share one pointer-down-outside dismiss** (unified 2026-08-01; previously bottom-only). Two wrong implementations:

- **`getRootNode()` / `element.contains(target)`** — only sees nodes inside the same root. A tap on the *page* (outside the shadow root) is not in `groupRef.contains`, so it would be treated as "outside" and close — but a tap *inside the shadow root but outside the group* is also not seen, and worse, retargeting across shadow boundaries means `target` is the shadow host, not the inner element, so `contains` checks are unreliable.
- **`document.getElementById(groupId)`** — fails entirely inside a closed shadow root; the id is not queryable from the document.

**Fix: listen on `document` with `capture: true`, and test membership via `event.composedPath()`**, which returns the full retargeted path *through* shadow boundaries. `path.includes(groupRef.current)` / `path.includes(flyoutRef.current)` correctly identifies taps inside the group or flyout regardless of shadow boundaries:

```tsx
// 点外部关闭（两种模式统一）：触屏无可靠 hover-out（底栏主路径），
// 顶栏/搜索页固定态同理。监听 document（capture），页面（shadow 外）的点击
// 也能命中；composedPath 含 shadow 内后代，path.includes(groupRef/flyoutRef)
// 判断对 shadow 内点击同样有效。
useEffect(() => {
  if (!open) return;
  const onPointerDown = (e: Event) => {
    const path = typeof (e as PointerEvent).composedPath === 'function'
      ? (e as PointerEvent).composedPath()
      : [];
    if (groupRef.current && path.includes(groupRef.current)) return;
    if (flyoutRef.current && path.includes(flyoutRef.current)) return;
    handleClose();
  };
  document.addEventListener('pointerdown', onPointerDown, true);
  return () => document.removeEventListener('pointerdown', onPointerDown, true);
}, [open, handleClose]);
```

`capture: true` matters: it guarantees the document-level handler runs before any shadow-internal handler that might `stopPropagation`. The `pointerdown` (not `click`) event is chosen so dismiss happens on finger-down, matching native popover feel and avoiding the focus/click race from §4d. Note the handler now calls `handleClose` (the local wrapper that cancels any pending hover-intent close timer) rather than raw `onClose`, so a stale timer cannot re-fire an idempotent close afterwards.

#### 4f. Scroll-hide closes the flyout — MutationObserver on `data-hidden`

Scroll-hide stamps `data-hidden="true"` on the host when the user scrolls down (§2 helper clears it on show). If a flyout is open when the bar hides, the fixed flyout would be left floating at stale viewport coordinates above a now-invisible bar. The flyout must close *before* the `translateY(100%)` transform applies (this is also what keeps §4a's transform safe).

The component cannot know about scroll-hide directly (it lives in the content script). Instead it observes the host's `data-hidden` attribute via a `MutationObserver` and closes on change. The host is reached from inside the shadow root via `getRootNode()` → `ShadowRoot.host` (falling back to `closest('[data-position]')` for the non-shadow search-page case):

```tsx
// 底栏 host 被 data-hidden 藏起时关闭浮层（scroll-hide 不走 unmount）。
useEffect(() => {
  if (!bottomMode) return;
  const el = containerRef.current;
  if (!el) return;
  const root = el.getRootNode();
  const host = root instanceof ShadowRoot
    ? (root.host as HTMLElement)
    : (el.closest?.('[data-position]') as HTMLElement | null);
  if (!host) return;
  const obs = new MutationObserver(() => {
    if (host.dataset.hidden === 'true') {
      setOpenGroupId(null);
      setPinnedGroupId(null); // 固定态同样清除——scroll-hide 关闭一切展开
    }
  });
  obs.observe(host, { attributes: true, attributeFilter: ['data-hidden'] });
  return () => obs.disconnect();
}, [bottomMode]);
```

And the content-script side that drives it (the `data-hidden` stamp that the observer reacts to):

```typescript
const handleScrollHide = () => {
  if (!mountedHost || state.resolvedPosition !== 'bottom') return;
  const currentY = window.scrollY;
  // 近顶部始终显示，避免页面顶端无栏可用。
  if (currentY < 10) {
    delete mountedHost.dataset.hidden;
    lastScrollY = currentY;
    return;
  }
  const delta = currentY - lastScrollY;
  // 仅在有意义位移时切换，避免微小抖动反复触发。
  if (Math.abs(delta) < SCROLL_HIDE_THRESHOLD) return;
  if (delta > 0) {
    // 向下滑动——藏栏。SourceSwitcher 经 MutationObserver 关 flyout。
    mountedHost.dataset.hidden = 'true';
  } else {
    // 向上滑动——显栏。
    delete mountedHost.dataset.hidden;
  }
  lastScrollY = currentY;
};
ctx.addEventListener(window, 'scroll', handleScrollHide, { passive: true });
```

The cross-boundary contract is deliberately one-directional and attribute-based: the content script owns the hide *intent* (`data-hidden`), the component owns the *reaction* (close flyout). Neither side calls into the other; they communicate only through the host attribute. This is the same `data-*` bridge discipline as `data-position`, extended to a runtime behavioral signal.

#### 4g. Body-mount in bottom mode — escape the *page* ancestor containing block (the cross-site trap)

§4a fixed the containing-block trap for the bar's **own** host (`backdrop-filter` on `:host`). But `position:fixed` is vulnerable to *any* ancestor in the page DOM, not just the bar's internal ancestors. The bottom bar was originally inserted into the same inline anchor as the top bar — a sibling of a results container *inside the page*. Two cross-site bugs traced to that:

- **小红书:** the host was inserted `after #search-input`, deep in the SPA subtree. 小红书's SPA renders ancestors carrying `transform`/`will-change`/`contain`; those become the containing block of the `position:fixed` host, so `bottom:0` anchored to the ancestor box, not the viewport → the bar floated at the wrong vertical position ("not at the page bottom"). No CSS on `:host` can fix this — the trap is upstream, in the page.
- **抖音:** the host was inserted before `#search-result-container`, again inside a page subtree whose stacking context trapped the `z-index: 600` host beneath 抖音's share/settings popups (~1000+). Even raising `z-index` could not escape a low ancestor stacking context.

**Fix — in bottom mode the host is mounted to `document.body`, ignoring the engine anchor.** This aligns the DOM mount with the design stated in §1 ("bottom is *universal*: … ignores every engine's DOM") — the CSS already treated the bottom bar as a viewport overlay, but the mount had not caught up. Mounting to `document.body` puts the host at the page top level, so no page ancestor can establish a containing block or a trapping stacking context.

Three implementation details make this safe:

1. **The WXT `anchor` returns `'body'` in bottom mode.** `createShadowRootUi`'s internal `getAnchor` resolves a string selector via `querySelector`; if it returns nothing, `mountUi` **throws** `"could not find anchor element"`. On an SPA the engine anchor may not exist yet at `document_idle`, so returning the engine selector would make the bottom bar fail to mount early. `'body'` always exists, so `getAnchor` always resolves and the custom `append` (below) takes over placement.

2. **The custom `append` redirects to `document.body` in bottom mode.** WXT calls `options.append(anchor, root)` when `append` is a function (the existing override); we branch on `state.resolvedPosition === 'bottom'` and do `(document.body ?? document.documentElement).appendChild(root)`, ignoring the `anchor` argument entirely. The engine-anchor `switch (strategy.append)` path runs only in top mode.

```typescript
append: (anchor, root) => {
  if (state.resolvedPosition === 'bottom') {
    (document.body ?? document.documentElement).appendChild(root);
    return;
  }
  switch (strategy.append) { /* …top-mode engine-anchor insertion… */ }
}
```

3. **A `mountIfReady` fast-path makes the body mount budget-independent.** The engine-anchor path gates mounting on `canAttemptMount` (which needs `remountBudget > 0` and a preferred/last-resort anchor present). A bottom bar depends on neither — only on `document.body` existing — so the bottom branch checks `document.body` and mounts directly, never consuming the remount budget. The detach handler mirrors this: it remounts in bottom mode regardless of budget (a body-mounted host's parent is stable; the budget gate exists to fight hostile SPA teardown of *inline* anchors). This is what prevents the bar from silently disappearing after a `top → bottom` flip late in a long-lived page when the budget is exhausted.

**z-index is raised to `2147483647` (int32 max).** With the host body-mounted, its stacking context is the page root, so a maximal z-index guarantees it sits above every site floating layer (抖音 share/settings popups, etc.). The fixed-up flyout (`.group-flyout--fixed-up`) uses the same max: it is a child of the (now-body-level) host, so it does not need to exceed the host, and the same value keeps it above site popups too.

```css
:host([data-position="bottom"]) {
  position: fixed !important;
  bottom: 0 !important;
  /* … */
  z-index: 2147483647 !important;   /* int32 max: body-mounted → escapes site stacking context */
}
:host([data-position="bottom"]) .group-flyout--fixed-up {
  z-index: 2147483647 !important;   /* host's fixed child; no need to exceed host */
}
```

**Remount on `top ↔ bottom` flip.** The host's physical parent differs between modes (engine anchor subtree vs `document.body`), so a position flip cannot be an in-place `applyPositionChrome` + re-render — that only changes `data-position` and the pad/pageStyles, leaving the host in the *old* DOM location. The `resize` (auto-breakpoint crossing) and `onPrefMessage` (Options toggle) transition paths now do **teardown + remount**: `state.resolvedPosition = next` → `safeRemove()` → `mountWhenAnchorReady(locationRevision)`, reusing the current `locationRevision` so no budget/observer bookkeeping resets. `onMount`'s call to `applyPositionChrome(state.resolvedPosition)` restamps `data-position` and swaps pad↔pageStyles during the remount, so the helper remains the single owner of those operations.

The generalizable lesson: **a `position:fixed` overlay's containing block is determined by its *page* ancestor chain, not its CSS alone.** Mounting such an overlay inside a rich SPA subtree (transforms, will-change, contain) silently breaks its viewport anchoring and traps its z-index, and no amount of `:host` CSS can repair it — the fix is structural: mount the overlay at the page top level (`document.body`).

### 5. `CONFIG_KEYS` without a schema bump

`serpBarPosition` is a persisted pref that must survive config export/import, so it has to be in the config-domain whitelist. But like `groupConfig`, `agentBridgeEnabled`, `engineSearchEnabled`, and `providerMaxResults` before it, its default is supplied by a **getter** (`getBarPositionPref` normalizes any missing/unknown value to `'auto'`). A missing key is therefore safe without a migration: there is nothing to transform, just a default to fall back to. So it is added to `CONFIG_KEYS` **without** bumping `CURRENT_SCHEMA_VERSION` and **without** a migration entry:

```typescript
export const CURRENT_SCHEMA_VERSION = 5;

// config 域白名单：迁移只读写这些键（外加 schemaVersion 本身）。
// ⚠️ 新增 config 键时，必须同步加进此数组，否则 ensureSchema 不会读/写它。
// agentBridgeEnabled / engineSearchEnabled / providerMaxResults / groupConfig / serpBarPosition 默认值由 getter 兜底，不 bump 版本（无需迁移）。
export const CONFIG_KEYS = ['providerKeys', 'activeProvider', 'activeSource', 'themePref', 'localePref', 'sourceOrder', 'sourceHidden', 'siteEngines', 'agentBridgeEnabled', 'engineSearchEnabled', 'providerMaxResults', 'groupConfig', 'serpBarPosition'] as const;
```

The rule, encoded in the comment: a new config key joins `CONFIG_KEYS` so `ensureSchema` reads/writes it during export/import, but a version bump + migration is needed **only** when legacy stored data must be transformed. A getter-defaulted key with no legacy population needs neither. The getter is the single source of the default:

```typescript
export async function getBarPositionPref(): Promise<BarPositionPref> {
  const got = await browser.storage.local.get(BAR_POSITION_KEY);
  const stored = got[BAR_POSITION_KEY];
  return stored === 'top' || stored === 'bottom' ? stored : 'auto';
}
```

Any unknown/missing value normalizes to `'auto'`, so a legacy storage state without the key is safe with zero migration code.

### 6. Bottom mode skips engine pageStyles

Top-bar shims must not apply in bottom mode. Douyin's `pageStyles` pushes its filter toolbar down to make room for a *top* bar at `top: 56px`; injecting that shim in bottom mode would corrupt the host page layout for a bar that is no longer at the top. `applyPositionChrome` handles this in the transition body (§2): the `bottom` branch calls `removePageStyles()` before injecting the pad, and the `top` branch calls `injectPageStyles(state.engine)`:

```typescript
if (pos === 'bottom') {
  // bottom must NOT keep top-bar engine shims (Douyin etc.)
  removePageStyles();
  injectBottomPadStyles();
  // ...
} else {
  removeBottomPadStyles();
  injectPageStyles(state.engine);
  // ...
}
```

The stylesheet also defends against the engine-specific *host* rule that would otherwise survive: `:host([data-engine="douyin"]) { top: 56px }` is neutralized by the explicit `:host([data-engine="douyin"][data-position="bottom"]) { top: auto }` override (§1). Belt and suspenders — the page shim is removed at the DOM level, and the host rule is overridden at the cascade level, so neither top-bar artifact leaks into bottom mode.

## Why This Matters

- **Two parallel feature tracks touching the same UI region will produce coexistence bugs that neither track's tests catch alone.** The bottom-bar branch was tested against a flat chip row; the groups branch was tested against a top bar. Merged, the fixed flyout inside a fixed-and-backdrop-blurred host broke in a way only an integrated review could see. The Oracle review loop (3 rounds) was essential — each round closed one trap (containing block → overflow clipping → touch race) that the previous round's fix exposed. The lesson generalizes: when cherry-picking a tip commit onto a diverged main, budget for an integration-review pass that exercises the *intersection* of both tracks, not just each track's own tests.

- **CSS containing-block rules for `position:fixed` are non-obvious and silent.** `backdrop-filter`, `transform`, `filter`, `will-change`, and `contain` on *any ancestor* of a `position: fixed` element silently make that ancestor the containing block — the "fixed" child is then positioned relative to the ancestor, not the viewport, and may be clipped by the ancestor's `overflow`. There is no console warning; the flyout just lands in the wrong place or vanishes. This is a recurring trap for *any* fixed overlay that also hosts a flyout/popover child, and the symptom (flyout clipped) mis-points at `overflow` while the root cause is an unrelated ancestor property. Recording the full chain — ancestor property creates containing block → `overflow` now clips → flyout vanishes — is what prevents re-deriving it.

- **A `position:fixed` overlay's containing block is set by its page ancestor chain, not by its own CSS — so where you *mount* it matters as much as how you *style* it.** §4a fixed the trap for the bar's own `:host` (`backdrop-filter` on the host). §4g is the cross-site corollary: mounting the bottom bar inside a rich SPA subtree (小红书's `#search-input` ancestors, 抖音's `#search-result-container`) meant a *page* ancestor — not the host — established the containing block (bar not at the real viewport bottom) and a trapping stacking context (z-index trapped below site popups). No `:host` CSS can fix an upstream-page-ancestor trap; the fix is structural — mount the overlay at `document.body`. The recurring lesson: when a fixed overlay misbehaves on one site and not others, suspect the mount location inside that site's transform/will-change/contain subtree, and prefer a top-level mount for overlays that must ignore page geometry.

- **Touch interaction cannot reuse desktop hover/focus patterns without race analysis.** A tap synthesizes `focus` then `click` on the same element; if both mutate open-state, the first tap is a no-op. The desktop `onFocus={onOpen}` is correct for keyboard users on a top bar but must be gated out of the touch (bottom) path, with `click`/`Enter`/`Space` carrying the open action instead. Any popover that supports both pointer and touch will hit this unless the focus and click paths are deliberately disambiguated.

## When to Apply

- **Adding a fixed-position overlay variant to an inline-anchored component** — the `data-position` attribute bridge, the universal fixed-bottom + page-pad approach (replacing per-engine anchors), and the `applyPositionChrome` helper that unifies every transition path.
- **A `position:fixed` overlay that misbehaves on specific sites (wrong vertical anchor, or covered by site popups)** — mount it to `document.body` instead of an inline anchor inside the site's transform/will-change/contain subtree (§4g); raise z-index to int32 max (`2147483647`) only *after* escaping the site's stacking context. Remount (teardown + re-mount), not in-place restyle, on any `top↔bottom` flip so the host's physical parent changes.
- **Merging parallel feature tracks that both touch the same UI region** — budget for an integration-review pass exercising the intersection; do not assume each track's isolation tests cover the merge.
- **Debugging a flyout/popover that vanishes or mis-anchors under `overflow:auto` or `backdrop-filter` ancestors** — check the *ancestor chain* for `backdrop-filter`/`transform`/`filter`/`will-change`/`contain` (each creates a containing block for fixed descendants); the `overflow` is a symptom, not the cause.
- **Wiring touch-friendly open/close where focus-open races click-toggle** — gate `onFocus` out of the touch path; let `click`/`Enter`/`Space` own the open action; suppress `mouseenter` on coarse pointers to avoid hover-stick.
- **Adding a config knob to an import/export pipeline without a schema bump** — add the key to `CONFIG_KEYS`, supply the default via a normalizing getter, and skip the migration/version-bump unless legacy data must transform.

## Examples

### Backdrop-filter removal from the host (before: trapped flyout; after: viewport-true fixed)

**Before** — host carries `backdrop-filter`, which makes the host the containing block for the fixed flyout. The flyout's viewport-coordinate `left`/`bottom` are reinterpreted relative to the host box, and once the host (or an `overflow:hidden` descendant like the track) is the containing block, the flyout is clipped:

```css
/* BROKEN: backdrop-filter on host makes host the containing block for
   the fixed .group-flyout--fixed-up → flyout mis-anchored + clipped. */
:host([data-position="bottom"]) {
  position: fixed !important;
  bottom: 0 !important;
  width: 100% !important;
  background: var(--bg) !important;
  backdrop-filter: saturate(180%) blur(20px) !important;   /* ← trap */
  -webkit-backdrop-filter: saturate(180%) blur(20px) !important;
}
```

**After** — no `backdrop-filter` (or `transform`/`filter`) on the host or any track ancestor; the translucent look comes from `color-mix` alone. The only `transform` is the scroll-hide `translateY(100%)`, gated behind `[data-hidden="true"]` — at which point the flyout is already closed, so there is no fixed descendant to mis-contain:

```css
:host([data-position="bottom"]) {
  position: fixed !important;
  bottom: 0 !important;
  width: 100% !important;
  background: var(--bg) !important;
  background: color-mix(in srgb, var(--bg) 88%, transparent) !important;
  /* 不在 host 上用 backdrop-filter：会把 fixed 子元素的 containing block 变成 host，
   * 导致 flyout 的 left/bottom 视口坐标错位。 */
  transition: transform 280ms cubic-bezier(0.16, 1, 0.3, 1) !important;
}
:host([data-position="bottom"][data-hidden="true"]) {
  transform: translateY(100%) !important;   /* safe: flyout closed first (§4f) */
}
```

### `onFocus` guard (before: first tap no-op; after: click-only open in bottom mode; later: unified click-to-pin)

**Before** — `onFocus` opens unconditionally. A touch tap fires `focus` (open) then `click` (toggle → close): the first tap is a no-op.

```tsx
/* BROKEN: touch focus-opens then click-closes = first tap does nothing. */
onFocus={() => onOpen()}
onClick={() => { if (bottomMode) onToggle(); }}
```

**After** — `onFocus` returns early in `bottomMode`; `click` owns open via `onToggle`, and `Enter`/`Space` do the same for keyboard with `preventDefault` to avoid a double-toggle from synthesized click. (Since 2026-08-01 the `onClick` branch is no longer `bottomMode`-gated: `onToggle` runs in **both** modes and doubles as the click-to-pin state machine — collapsed → open+pin, transient → pin, pinned → close. See [source-switcher-click-to-pin](../ui-bugs/source-switcher-click-to-pin.md).)

```tsx
onFocus={() => {
  // 底栏：不靠 focus 开层。触屏 focus 先于 click，若 focus 开层会被 click 关掉
  // （首次点触空操作）；键盘用户用 Enter/Space 触发 click→onToggle 开层。
  if (bottomMode) return;
  onOpen();
}}
onKeyDown={(e) => {
  if (bottomMode && (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar')) {
    if (e.target === triggerRef.current) {
      e.preventDefault();
      e.stopPropagation();
      onToggle();
    }
  }
}}
onClick={(e) => {
  // 点击切换（两模式一致）：收起→打开并固定；瞬态展开→固定；固定→关闭。
  e.stopPropagation();
  onToggle();
}}
```

### Outside dismiss (before: ShadowRoot-only; after: `document` + `composedPath`)

**Before** — membership tested with `getRootNode()` / `contains`, which misses page taps (outside the shadow root) and is unreliable across shadow retargeting; or `getElementById`, which fails entirely inside a closed shadow root:

```tsx
/* BROKEN: page taps not seen; retargeting makes contains unreliable;
   getElementById fails in closed shadow root. */
const onPointerDown = (e: PointerEvent) => {
  const root = groupRef.current!.getRootNode() as ShadowRoot | Document;
  const target = e.target as Node;
  if (groupRef.current!.contains(target)) return;     // ← misses page taps
  onClose();
};
```

**After** — listen on `document` with `capture: true`; test membership via `composedPath()`, which traverses shadow boundaries so both page taps and inner-shadow taps are correctly classified. Since 2026-08-01 the guard is **not** `bottomMode`-gated — both modes share the outside-dismiss (a pinned flyout in top/search mode has no hover-out either), and the callback routes through `handleClose` so a pending hover-intent timer cannot fire a stale close afterwards:

```tsx
useEffect(() => {
  if (!open) return;
  const onPointerDown = (e: Event) => {
    const path = typeof (e as PointerEvent).composedPath === 'function'
      ? (e as PointerEvent).composedPath()
      : [];
    if (groupRef.current && path.includes(groupRef.current)) return;
    if (flyoutRef.current && path.includes(flyoutRef.current)) return;
    handleClose();
  };
  document.addEventListener('pointerdown', onPointerDown, true);
  return () => document.removeEventListener('pointerdown', onPointerDown, true);
}, [open, handleClose]);
```

## Related

- [serp-switch-bar-and-unified-source-model](./serp-switch-bar-and-unified-source-model.md) — the foundational SERP bar architecture: shadow-DOM isolation, self-contained token stylesheet keyed by `data-theme`, and the inline-anchor insertion model that the bottom variant deliberately replaces with a fixed overlay.
- [serp-bar-engine-specific-anchors](../ui-bugs/serp-bar-engine-specific-anchors.md) — the per-engine inline-anchor model for the top bar (`#rcnt`/`#b_content`/`#container`), the `data-engine` attribute bridge, and the shadow-cascade precedence rules (`:host { all: initial !important }`) that the `data-position` bridge reuses. The bottom bar's explicit `:host([data-engine="douyin"][data-position="bottom"]) { top: auto }` override exists because of Douyin's fixed-top rule documented here.
- [config-preference-pipeline](./config-preference-pipeline.md) — the eight-layer pipeline for adding a persisted pref (storage → schema `CONFIG_KEYS` → messaging → gateway → background → config-io → i18n → UI). `serpBarPosition` traverses this pipeline; the getter-default-no-migration shortcut (§5) is the content-schema-side complement.
- [testable-content-script-helpers-via-lib-extraction](./testable-content-script-helpers-via-lib-extraction.md) — why `resolveBarPosition`, `injectBottomPadStyles`, `removeBottomPadStyles`, and `scrollChildToCenter` live in `lib/` (pure/injectable, testable) rather than as content-script named exports (which break the WXT build).
- [theme-persistence-i18n-key-hygiene](../best-practices/theme-persistence-i18n-key-hygiene.md) — the worker-side `storage.onChanged` → `broadcastUiPref` pattern and the desensitized-config trust boundary that the bar-position live-sync channel plugs into.
