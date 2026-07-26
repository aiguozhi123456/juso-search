---
title: "Hidden source remained injected/active across serp-bar, search page, and options page"
date: 2026-07-23
category: ui-bugs
module: "source-switcher-visibility"
problem_type: ui_bug
component: tooling
symptoms:
  - "Setting an engine hidden did not stop the quick-switch bar from being injected on that engine's own SERP; the bar survived a hard reload (BUG 1, primary user report)"
  - "On the search page, hiding the active source left the SourceSwitcher with no highlight target and handleSearch still routed to the hidden engine's SERP (BUG 2)"
  - "On the options page, the active-source dropdown listed hidden sources and allowed selecting + persisting a hidden source as active (BUG 3)"
root_cause: logic_error
resolution_type: code_fix
severity: medium
applies_when:
  - "A projection (sourceHidden) removes a SourceId from allSources but downstream hosts make mount / active-source decisions from URL match or an unfiltered list without consulting it"
  - "A host must distinguish display-layer visibility from persisted active state for the same SourceId"
tags: [source-hidden, serp-bar, quick-switch-bar, active-source, content-script, mv3, projection, visibility, chrome-storage]
---

# Hidden source remained injected/active across serp-bar, search page, and options page

## Problem

The "quick switch bar" (快切栏) projects its pills from a unified `allSources()` view that removes any id listed in the persisted `sourceHidden: SourceId[]` preference. The architecture doc `docs/solutions/architecture-patterns/config-preference-pipeline.md` deliberately blesses hiding as **orthogonal** to the active source at the *storage* layer: `activeSourceId` and `sourceHidden` are independent keys, so hiding the active source must not mutate the user's saved active preference (least surprise on cancel-hide). That orthogonality is correct *for storage*. But three separate code paths treated visibility as orthogonal to *everything* — the mount decision, the active-source render, and the active-source select — and none of them reconciled a hidden active source at the display/execution layer. The result was a bar that injected itself on the hidden engine's own SERP with no live target, an active pill with no highlight, and an options dropdown that happily let you persist a hidden selection.

All three fixes land on branch `fix/serp-bar-hidden-engine-no-mount`, verified green: typecheck, lint, 618 tests passing, build OK。

## Symptoms

- **BUG 1 (primary user report "当设置 engine 隐藏时快切栏依旧在当前 engine 作用"):** Navigate to a hidden engine's results page (e.g. `google.com/search?q=...` while `google` is in `sourceHidden`). The shadow-root bar mounts, but **none** of its pills is the active target — `allSources()` already filtered the host engine out. A hard reload re-runs the content script and the bar comes back identically.
- **BUG 2:** `activeSourceId: 'google'` persisted with `sourceHidden: ['google']` → the search page renders the switcher with no highlighted pill, and submitting a query does `location.assign(google.buildSerpUrl(query))` — onto the SERP of the engine the user explicitly hid.
- **BUG 3:** The options "默认搜索引擎" dropdown still shows a hidden `Google` option; picking it persists `google` as active, which the search page can then neither highlight nor execute against.

## What Didn't Work

- **BUG 1 — mount decided the engine from URL alone.** `matchEngineByUrl(url)` returned the engine, and `loadBarState` *did* read `config.sourceHidden` — but only to filter the `sources` array passed into `SourceSwitcher`. Nothing consulted `sourceHidden` at the *mount decision*, so the bar kept mounting on a host whose engine was no longer a valid target. Reloading was useless because the missing check ran identically every mount.

- **BUG 2 — the naive first fix fell back to `sources[0]` whenever `active` had no matching pill:**

  ```tsx
  // FIRST ATTEMPT (wrong) — visibleActive always resolved to sources[0] when active unmatched
  const visibleActive = sources.some((s) => s.id === active) ? active : sources[0]?.id ?? null;
  ```

  On the very first render `getProviderConfig` has not resolved yet, so `configuredProviderIds = []`. With no providers configured, `allSources([], ...)` returns **only engines** (engines always show). So `sources[0]` was an engine — the first query went through `handleSearch`, `visibleActive` (an engine) sat ahead of `active` (still `null`) in the chain, the `isEngineId` branch fired, and the page redirected to that engine's SERP. **9 of the existing `doSearch` tests went red** because they assert a `search` message is sent, not a `location.assign`. The fix had to keep `visibleActive === null` until `active` was actually resolved, so `handleSearch` would fall through to its pre-existing `await loadSourceSnapshot()` fallback (the baseline behavior).

- **BUG 3 — one array fed two regions with different rules.** Both the management list *and* the active-source dropdown were built from the same `configuredSources`, deliberately **not** filtered by `sourceHidden`. That omission is correct *for the management list* (the `allSources` invariant: keep hidden items so their show/hide buttons stay reachable — filtering would make them un-hideable). But the same unfiltered array fed the dropdown, where hidden items must not appear. And `getActiveSourceId()` does not re-validate against `sourceHidden`, so a selected hidden id was silently persisted as active.

## Solution

### BUG 1 — gate the mount on `sourceHidden`

A new pure function in `lib/serp-bar-mount.ts` — the same module that already houses the injectable decision functions (`pickAnchor`, `canAttemptMount`, `shouldUpgradeFromLastResort`):

```ts
// lib/serp-bar-mount.ts
export function shouldMountForEngine(
  engineId: string,
  sourceHidden?: readonly SourceId[],
  matchingVisibleSiteId?: string,
): boolean {
  if (!sourceHidden || sourceHidden.length === 0) return true;
  if (matchingVisibleSiteId) return true; // 隐藏的 backing engine 在有可见 Site Engine 时仍可挂载
  return !sourceHidden.includes(engineId as SourceId);
}
```

`BarState` gains a `sourceHidden: SourceId[]` field, and `loadBarState` returns the config snapshot (mirroring the existing `sourceOrder` / `configuredProviderIds` snapshot pattern — deliberately *not* a live-sync channel; that is a separate concern). The guard runs at both entry points:

```ts
// entrypoints/serp-bar.content.ts
async main(ctx) {
  const engine = matchEngineByUrl(window.location.href);
  if (!engine) return;
  const state = await loadBarState(engine, window.location.href);
  // (1) Initial mount: hidden engine → bail before any mount work.
  if (!shouldMountForEngine(engine.id, state.sourceHidden)) return;
  // ...
  const syncLocation = (url: string) => {
    const nextEngine = matchEngineByUrl(url);
    if (!nextEngine) { safeRemove(); return; }
    // (2) SPA navigation onto a hidden engine's page: tear down and stop.
    //     Reverse navigation (hidden → visible) resumes the normal mount path.
    if (!shouldMountForEngine(nextEngine.id, state.sourceHidden)) {
      safeRemove();
      return;
    }
    state.engine = nextEngine;
    // ...normal mount/render path resumes...
  };
}
```

Because the check runs at the top of every mount (initial and every `wxt:locationchange`), a reload is also suppressed. The decision was extracted as a pure function because the mount entry lives inside the WXT content-script IIFE, which per repo convention (documented at the top of `lib/serp-bar-mount.ts`) cannot be imported by tests.

### BUG 2 — derive a `visibleActive` on the search page

```tsx
// entrypoints/search/App.tsx
const sources = allSources(configuredProviderIds, sourceOrder, sourceHidden);
// active unresolved → null (so handleSearch falls through to loadSourceSnapshot).
// active hidden → first visible source. active visible → active itself.
const visibleActive = active == null
  ? null
  : sources.some((s) => s.id === active)
    ? active
    : sources[0]?.id ?? null;

<SourceSwitcher sources={sources} activeId={visibleActive} ... />

async function handleSearch(rawQuery, opts = {}) {
  // visibleActive BEFORE active: a hidden active is overridden.
  // When visibleActive is null (first render), we fall through to
  // loadSourceSnapshot(), matching the pre-fix baseline.
  source = opts.providerId ?? opts.sourceId ?? visibleActive ?? active ?? await loadSourceSnapshot();
}
```

`active` itself is **never mutated** — the user's persisted `activeSourceId` keeps its original value, so cancel-hide restores the original highlight/target automatically.

### BUG 3 — split the dropdown from the management list + reselect on hide

```tsx
// entrypoints/options/App.tsx
const configuredSources = allSources(configuredProviderIds, sourceOrder);
// active-source dropdown lists ONLY visible sources.
// Management list still uses configuredSources (the allSources invariant —
// filtering the management list would make hidden items un-hideable).
const visibleSources = allSources(configuredProviderIds, sourceOrder, sourceHidden);
const activeVisible = active == null
  ? null
  : visibleSources.some((s) => s.id === active)
    ? active
    : visibleSources[0]?.id ?? null;

<select value={activeVisible ?? ''} onChange={(e) => choose(e.target.value as SourceId)}>
  {visibleSources.map((s) => <option ...>...</option>)}
</select>
```

`toggleHidden` reselects *and persists* when hiding the active source:

```tsx
async function toggleHidden(sourceId: SourceId) {
  const previous = sourceHidden;
  const isHidden = sourceHidden.includes(sourceId);
  const next = isHidden ? sourceHidden.filter((id) => id !== sourceId) : [...sourceHidden, sourceId];

  // Hiding the active source: reselect to the first source visible AFTER the hide.
  // Uses allSources(..., next) so it never picks the id being hidden.
  const reselectTo = !isHidden && active === sourceId
    ? allSources(configuredProviderIds, sourceOrder, next).find((s) => s.id !== sourceId)?.id
    : undefined;

  sourceHiddenRevision.current += 1;
  setSourceHiddenState(next);            // optimistic
  if (reselectTo) setActive(reselectTo); // optimistic
  setSavingSourceHidden(true);
  try {
    await sendMessage('setSourceHidden', next);
    if (reselectTo) await sendMessage('setActiveSource', reselectTo);  // persist reselect
  } catch {
    sourceHiddenRevision.current += 1;
    setSourceHiddenState(previous);      // roll back hidden
    if (reselectTo) setActive(sourceId); // roll back active
  } finally {
    sourceHiddenRevision.current += 1;
    setSavingSourceHidden(false);
  }
}
```

## Why This Works

All three bugs are the same conceptual gap: **`sourceHidden` was modeled as a display-layer projection, but three code paths treated visibility as orthogonal and never reconciled it.**

- **BUG 1 (SERP mount)** never consulted `sourceHidden` at all — the projection existed only inside `allSources()`, so the mount injected a bar onto a host whose engine was no longer a valid target.
- **BUG 2 (search page render + execute)** consumed `active` directly, ignoring that it had been projected out of the visible list.
- **BUG 3 (options select + persist)** fed the dropdown from the same unfiltered array as the management list, and the persist path did not re-validate.

The architecture doc's "hiding orthogonal to active" invariant is correct and was **preserved verbatim at the storage layer**: `activeSourceId` is never mutated by a hide (cancel-hide restores it — least surprise). What the doc did not spell out — and what all three fixes supply — is that the **display and execution** layers need a *reconciled view* of the active source (`visibleActive` / `activeVisible` / `reselectTo`), and the **mount** layer needs to consult the hidden set at all (`shouldMountForEngine`). The two coupled properties that make BUG 2 work: `visibleActive` is `null` while `active` is unresolved (avoids the first-render engine misselect), and `visibleActive` sits *before* `active` in the resolution chain (a hidden active is overridden by a visible id).

## Prevention

- **A projection that removes items must be consulted at every site that depends on membership.** For `sourceHidden` that is three sites: the mount decision (does this engine deserve a bar), the active-source render/execute (highlight + route), and the active-source select + persist (can the user choose/keep it). Future projections should route through `shouldMountForEngine` or a sibling gate rather than only through `allSources()`.
- **Any reconciliation that falls back to `sources[0]` must first check whether the preference has resolved yet.** Otherwise the first render (before async config loads) will misselect from a partial list — the 9-red-tests trap in BUG 2.
- **When one source array feeds two UI regions with different rules, split them.** `configuredSources` (unfiltered, for management) vs `visibleSources` (filtered, for selection).
- **Re-validating the active source against `sourceHidden` at persist time** (`setActiveSource` / `getActiveSourceId`) would be the deeper fix and make this class of bug impossible from any host; the current fix does it at the options-page write site, which is the only place a hidden-active can be persisted through the UI.
- Tests added: `tests/serp-bar-mount.test.ts` (`shouldMountForEngine`, 3 cases), `tests/search-page.test.tsx` (active hidden → reselect, 1 case), `tests/options-page.test.tsx` (dropdown excludes hidden; hiding active reselects+persists, 2 cases).

## Related Issues

- [config-preference-pipeline](../architecture-patterns/config-preference-pipeline.md) — documents the "隐藏与激活来源正交" invariant (rule 3). Correct at storage; this fix adds the display-layer reselect the invariant did not spell out. A refresh note clarifying "orthogonal at storage; display may reselect" is warranted.
- [persistent-source-order-and-visible-projection](../architecture-patterns/persistent-source-order-and-visible-projection.md) — the `allSources` projection rule and the "settings page must NOT filter, only the consumer projection" boundary. BUG 3 is the mirror failure of that boundary for `sourceHidden` at the dropdown.
- [serp-switch-bar-and-unified-source-model](../architecture-patterns/serp-switch-bar-and-unified-source-model.md) — the `SourceSwitcher` two-host design the bugs live inside.
- [separate-active-search-source-from-active-byok-provider](../architecture-patterns/separate-active-search-source-from-active-byok-provider.md) — the `getActiveSourceId` fallback chain; confirms storage should stay orthogonal (the chain should NOT skip hidden sources, so unhiding restores the user's choice).
- [serp-bar-spa-remount-and-last-resort-upgrade](./serp-bar-spa-remount-and-last-resort-upgrade.md) — shares `entrypoints/serp-bar.content.ts` / `lib/serp-bar-mount.ts`; documents the schema-v2 default-hidden engines (`douyin`/`xiaohongshu`) that most often trigger BUG 1.
