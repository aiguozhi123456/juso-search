---
title: "Bottom SERP bar mounts to document.body to escape site stacking/containing-block traps"
date: 2026-07-30
last_updated: 2026-07-30
category: docs/solutions/ui-bugs
module: "serp-bar / content-script"
problem_type: ui_bug
component: tooling
symptoms:
  - "小红书 bottom bar is not pinned to the true viewport bottom — it floats at a wrong vertical position inside the page"
  - "抖音 bottom bar is covered by the site's share/settings floating layers (z-index beaten by site popups)"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags:
  - serp-bar
  - bottom-bar
  - content-script
  - containing-block
  - stacking-context
  - shadow-dom
  - document-body
  - xiaohongshu
  - douyin
  - position-fixed
  - entrypoints/serp-bar.content.ts
  - entrypoints/shared/serp-bar-styles.ts
---

# Bottom SERP bar mounts to `document.body` to escape site stacking/containing-block traps

## Problem

The bottom bar (`data-position="bottom"`) is a `position: fixed; bottom: 0` viewport overlay. On two cross-site pages it visibly broke: on 小红书 it was **not at the page bottom** (it floated inside the SPA subtree), and on 抖音 it was **covered by the site's share/settings popups**.

## Symptoms

- 小红书 `www.xiaohongshu.com/search_result`: the bottom bar sits at a wrong vertical position instead of pinned to the viewport bottom.
- 抖音 `www.douyin.com/search/...`: the bottom bar is hidden behind 抖音's floating share/settings layers.

## What Didn't Work

- **Raising `z-index` on `:host` alone (抖音).** The host was mounted *inside* the page subtree (`#search-result-container`), so the site ancestor's stacking context trapped the host's z-index — no host-level `z-index` can escape an ancestor's context. Symptom-only; the real constraint was the mount location.
- **Any `:host` CSS change for 小红书.** The misplacement was not a host style problem — it was an upstream *page* ancestor becoming the `position:fixed` containing block. No `:host` rule can repair an ancestor establishing a containing block.

## Solution

In bottom mode, mount the shadow host to **`document.body`** instead of the engine's inline anchor, and raise the host z-index to `2147483647` (int32 max). This is a structural fix: the DOM mount finally matches the design stated in the architecture doc — the bottom bar "ignores every engine's DOM."

`entrypoints/serp-bar.content.ts` — `createShadowRootUi` config:

```typescript
// anchor: bottom mode returns "body" so WXT's getAnchor always resolves
// (mountUi throws if the anchor is missing; on an SPA the engine anchor
// may not exist yet at document_idle).
anchor: () => {
  if (state.resolvedPosition === 'bottom') return 'body';
  strategy = pickAnchor(anchorsFor(state.engine));
  return strategy.selector;
},
// append: bottom mode ignores the anchor and appends to document.body.
append: (anchor, root) => {
  if (state.resolvedPosition === 'bottom') {
    (document.body ?? document.documentElement).appendChild(root);
    return;
  }
  switch (strategy.append) { /* …top-mode engine-anchor insertion… */ }
},
```

A `mountIfReady` fast-path makes the body mount **budget-independent** (bottom bar depends only on `document.body` existing, not on the engine anchor or `remountBudget`), so a `top → bottom` flip late in a long-lived page cannot exhaust the budget and silently drop the bar. The detach handler mirrors this (remount in bottom mode regardless of budget).

`entrypoints/shared/serp-bar-styles.ts`:

```css
:host([data-position="bottom"]) {
  position: fixed !important;
  bottom: 0 !important;
  /* … */
  /* body-mounted → escapes the site's stacking context; int32 max beats site popups (~1000+) */
  z-index: 2147483647 !important;
}
:host([data-position="bottom"]) .group-flyout--fixed-up {
  z-index: 2147483647 !important; /* host's fixed child; no need to exceed host */
}
```

Because the host's physical parent differs between modes (`document.body` vs engine anchor), a `top ↔ bottom` flip cannot be an in-place restyle — it is **teardown + remount** in both the `resize` (auto-breakpoint) and `onPrefMessage` (Options toggle) transition paths:

```typescript
state.resolvedPosition = next;
if (ui.mounted) safeRemove();
mountWhenAnchorReady(locationRevision);
```

Finally, `syncAlignedHost` is skipped in bottom mode (it writes `--juso-serp-*` vars computed against the host's `parentElement`, which the bottom `!important` rules ignore — pure redundant work).

## Why This Works

The CSS spec makes a `position:fixed` element's containing block the **viewport** — *unless* an ancestor has `transform` / `filter` / `will-change` / `contain` / `backdrop-filter`, in which case that ancestor becomes the containing block. 小红书's SPA subtree (where the host was inserted, `after #search-input`) carries such ancestors, so `bottom:0` anchored to the ancestor box, not the viewport. The same subtree's stacking context also trapped 抖音's host z-index beneath the site popups.

Mounting the host to `document.body` puts it at the page top level: no page ancestor can establish a containing block or a trapping stacking context, so `bottom:0` anchors to the viewport and `z-index: 2147483647` is reachable. `ui.remove()` (WXT `shadow-root.mjs`) detaches via `shadowHost.remove()` regardless of parent, so a body-mounted host cleans up correctly.

**Universality:** the branch is only `state.resolvedPosition === 'bottom'`, resolved uniformly by `resolveBarPosition` (user picks `bottom`, or `auto` + viewport ≤ 480px). There is **no per-engine / per-host condition** in the mount path — all six engines mount to `document.body` in bottom mode.

## Prevention

- **For a `position:fixed` overlay that misbehaves on specific sites (wrong anchor, or covered by site popups), suspect the *mount location* first, not the CSS.** A fixed overlay's containing block and stacking context are set by its page ancestor chain. If the overlay is mounted inside a rich SPA subtree (transform/will-change/contain), no host-level CSS can fix it — mount it at `document.body`.
- **Test guards added** (`tests/serp-bar-layout.test.ts`): the bottom host and fixed-up flyout carry `z-index: 2147483647 !important`; the content script's bottom `append` mounts to `document.body` (source-shape assertions, since the content script is an untestable IIFE). Run `npm test` after any change to these paths.
- **A position flip that changes the physical parent must remount, not restyle.** `applyPositionChrome` only swaps `data-position` + pad/pageStyles; if the parent differs between modes, do teardown + remount so `append`/`onMount` re-apply for the new location.

## Related

- [serp-bar-bottom-position-and-scroll-hide](../architecture-patterns/serp-bar-bottom-position-and-scroll-hide.md) — the bottom-bar architecture. §4g is the deep treatment of this body-mount fix (the ancestor containing-block chain, the `mountIfReady` fast-path rationale, the z-index choice, and the remount-on-flip rule). This doc is the symptom-first entry; §4g is the rationale.
- [serp-bar-engine-specific-anchors](./serp-bar-engine-specific-anchors.md) — the **top-bar** inline-anchor model and stacking decisions that the bottom variant deliberately *replaces* with the body mount. Different problem (top anchor selection), not superseded.
- [serp-bar-spa-remount-and-last-resort-upgrade](./serp-bar-spa-remount-and-last-resort-upgrade.md) — the SPA detach/remount budget and last-resort anchor upgrade. The bottom fast-path reuses the same `mountWhenAnchorReady` flow but bypasses the budget/anchor gates because a body mount depends on neither.
