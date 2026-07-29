---
title: "Source Groups: A Layout Layer Over the Source Projection"
category: architecture-patterns
module: source switch bar (source-groups + source projection)
date: 2026-07-30
problem_type: architecture_pattern
component: frontend_stimulus
severity: high
applies_when:
  - A flat UI list of many heterogeneous items (providers, engines, sites) needs grouping/layout without changing underlying visibility or order
  - Adding a new config concern (grouping) where you must keep it orthogonal to an existing projection layer (sourceOrder/sourceHidden)
  - Bumping a persisted schema version where no data migration is required because defaults can be derived lazily via getter fallback
  - A UI must render a mixed sequence of flat/pinned items plus folded group items with a sliding indicator that tracks only the active pinned item
related_components:
  - service_object
  - tooling
tags:
  - layered-architecture
  - layout-layer
  - projection
  - config-normalization
  - schema-versioning
  - lazy-defaults
  - react
  - chrome-extension
---

# Source Groups: A Layout Layer Over the Source Projection

## Context

The quick-switch bar is the toolbar's primary surface for picking a search source. As the source set grew, the old `SourceSwitcher` rendered **every** candidate in a single flat row: each configured AI provider, all six builtin engines, and every user-defined Site Engine. BYOK extensions make this worse than for a fixed product: users add and remove providers and Site Engines continuously, so the bar kept getting denser rather than settling.

The visible symptom was layout pressure. At modest counts the pills wrapped to a second line and crowded the surrounding toolbar; Site Engines in particular (which can be numerous and are added ad hoc) pushed the bar past its budget. Reordering helped only partially — the row was still a single undifferentiated list, and the more sources a power user configured, the worse the scanability became.

Grouping was the natural answer, but the codebase already had a mature **source projection layer** in `lib/sources.ts`: `sourceOrder` (the canonical ordering) and `sourceHidden` (visibility), each with its own normalization, its own storage key, its own mutation queue, and its own role in import/export diffs. Folding "grouping" into that layer — letting it reorder or hide sources — would have entangled three concerns (order, visibility, grouping) and risked regressions in every code path that already reasoned about projection. The durable decision was to add grouping as a **separate layout layer on top**, leaving the projection layer untouched. A group never changes which sources exist, which are visible, or their underlying order; it only decides which sources are flat-pinned in the top row versus collapsed into a labeled group pill.

## Guidance

### 1. The GroupConfig shape — three independent knobs

The layout layer is captured in a single persisted object (`lib/source-groups.ts`):

```ts
export interface GroupConfig {
  /** 分组定义（含顺序，决定设置页与新分组列表展示顺序）。 */
  groups: SourceGroup[];
  /** 顶层混合序列：置顶 source 与分组统一排序。 */
  layout: SwitcherItem[];
  /** sourceId → groupId；仅对「入组」的 source 记录，置顶 source 不出现。 */
  assignments: Record<string, SourceGroupId>;
}

export type SwitcherItem =
  | { kind: 'source'; sourceId: SourceId }
  | { kind: 'group'; groupId: SourceGroupId };
```

Three deliberately independent fields:
- **`groups`** — the group definitions (id + label), ordered as they appear in the editor. The three builtins — `ai-search`, `engines`, `sites` — always exist.
- **`layout`** — a single mixed sequence of top-row items. Each item is either a pinned source (rendered as a bare pill) or a group (rendered as a collapsible pill with a hover flyout). Pinned sources and groups are peers and share one ordering, so the user can interleave them freely.
- **`assignments`** — `sourceId → groupId`, recorded **only** for sources that live inside a group. A pinned source does not appear in `assignments` at all; pinning is expressed by its presence in `layout`.

### 2. The pin-or-group binary state

Every source is in exactly one of two states. **Pinned**: it appears as `{kind:'source', sourceId}` somewhere in `layout` and is rendered as a flat pill. **Grouped**: it has no layout entry but is assigned (explicitly or by type-default) to a group. `resolveGroupId` resolves a source's group — explicit assignment first, then a type-based fallback:

```ts
export function resolveGroupId(
  sourceId: SourceId,
  assignments: Record<string, SourceGroupId>,
): SourceGroupId {
  return assignments[sourceId] ?? defaultGroupForSourceId(sourceId);
}
```

where `defaultGroupForSourceId` maps providers → `ai-search`, engines → `engines`, `site:*` → `sites`. This means the out-of-box experience needs **zero** persisted assignments: every source falls through to its type group, and `assignments` only records deviations the user made. `SourceGroupEditor` flips between the two states with two operations: `pinSource` (append a `{kind:'source'}` entry, drop its assignment) and `foldIntoGroup` (remove its layout entry, write its assignment).

### 3. `normalizeGroupConfig` — the self-healing boundary

Any value read from storage passes through `normalizeGroupConfig(raw, allSourceIds)` before it is used or re-persisted. It is the contract that guarantees a `GroupConfig` is always self-consistent regardless of what is on disk — which matters acutely in a BYOK extension where the source set is volatile. Its guarantees:

- **`groups`** — drops labels that fail `isSourceLabel`, dedupes by id (first wins), and **backfills the three builtin groups in `DEFAULT_GROUPS` order**.
- **`layout`** — drops items referencing unknown sources or unknown groups (`isSwitcherItem` checks against the live source-set and the known-group-set), dedupes by key keeping first occurrence, and falls back to `[{ai-search}, {engines}, {sites}]` when layout is empty/missing.
- **`assignments`** — drops entries pointing at unknown sources, at deleted groups, and at sources that are currently pinned (a pinned source must not carry a stale assignment).

```ts
for (const [sid, gid] of Object.entries(rawAssignments)) {
  if (!knownSourceIds.has(sid as SourceId)) continue;          // 未知 source
  if (pinned.has(sid as SourceId)) continue;                    // 置顶 source 不应残留赋值
  if (typeof gid !== 'string' || !knownGroupIds.has(gid)) continue; // 指向已删除/未知分组
  assignments[sid] = gid;
}
```

Because the reader (`getGroupConfig`) re-normalizes and re-persists on every read, the persisted form drifts toward correctness over time. The writer (`setGroupConfig`) also normalizes before storing, so neither path can land a malformed config.

### 4. `projectLayout` — defensive projection to renderable items

`projectLayout(sources, config, activeId)` turns a normalized config plus the already-projected source list (with order and visibility already applied by `lib/sources.ts`) into the sequence the switcher renders. It is defensive against partial/invalid config, pins-once semantics, empty-group skip, and a fallback placement:

```ts
const safeConfig = config && typeof config === 'object' && Array.isArray(config.layout)
  ? config
  : defaultGroupConfig(sources.map((s) => s.id));
const pinned = pinnedSourceIds(safeConfig.layout);
for (const layoutItem of safeConfig.layout) {
  if (layoutItem.kind === 'source') {
    const source = sourceById.get(layoutItem.sourceId);
    if (!source) continue;                  // hidden / unconfigured / deleted
    items.push({ kind: 'source', source });
    continue;
  }
  const groupItems = sources.filter((s) => {
    if (pinned.has(s.id)) return false;     // pins-once: never double-listed
    return resolveGroupId(s.id, safeConfig.assignments) === layoutItem.groupId;
  });
  if (groupItems.length === 0) continue;    // empty group not rendered
  items.push({ kind: 'group', group, items: groupItems, containsActive: ... });
}
```

Pins-once is the key invariant: once a source appears as a pinned `{kind:'source'}`, it is excluded from every group's collection. The final loop is a safety net — any source that slipped past normalization is placed into its default group (or, in the extreme case where even the default group definition is gone, rendered as a pinned source so it stays visible). The config never crashed the render even mid-migration or under a partial test mock.

### 5. Schema bump without migration — lazy getter defaults

Adding a persisted config key normally means writing a migration. Here it did not. `lib/schema.ts` bumps `CURRENT_SCHEMA_VERSION` from 4 to 5, but the v4→v5 migration is a no-op:

```ts
// v4→v5: 引入来源分组布局（groupConfig）。开箱即分组：缺失键由 getter 回退默认配置，
// 故迁移无需填充数据——仅 bump 版本戳以纳入 CONFIG_KEYS 白名单（ensureSchema 会读它）。
{ version: 4, migrate: (config) => config },
```

The comment in `CONFIG_KEYS` spells out why this is safe: `agentBridgeEnabled / engineSearchEnabled / providerMaxResults / groupConfig 默认值由 getter 兜底，不 bump 版本（无需迁移）`. The version bump is purely so `ensureSchema` includes `groupConfig` in its whitelist read (and for cache invalidation), not to transform stored data. Every reader falls back to `defaultGroupConfig(...)` when the key is absent or invalid, so existing installs get the grouped out-of-box experience without any data being written for them.

### 6. `groupConfig` folded into the existing provider-config snapshot and worker message

There is one privileged read path for UI config: `getProviderConfigSnapshot`. `groupConfig` is folded into it alongside `sourceOrder`, `sourceHidden`, `siteEngines`, and `providerMaxResults`, computed from the same single exact-key `get`:

```ts
const got = await browser.storage.local.get([KEYS_KEY, ACTIVE_KEY, ACTIVE_SOURCE_KEY,
  SOURCE_ORDER_KEY, SOURCE_HIDDEN_KEY, SITE_ENGINES_KEY, MAX_RESULTS_KEY, GROUP_CONFIG_KEY]);
...
const groupConfig = got[GROUP_CONFIG_KEY] && typeof got[GROUP_CONFIG_KEY] === 'object'
  ? normalizeGroupConfig(got[GROUP_CONFIG_KEY], allKnownSourceIds(siteEngines))
  : defaultGroupConfig(allKnownSourceIds(siteEngines));
```

It is also a field on `ProviderConfigReply` in `lib/messaging.ts` (`/** 来源分组与顶层布局（开箱默认按类型分组，缺失时由 worker 回退默认配置）。 */ groupConfig: GroupConfig;`), and the worker exposes a `setGroupConfig(config)` handler. So grouping rides the same plumbing the projection layer already used: one snapshot, one message pair, one known source-id set (`allKnownSourceIds`) shared across both layers so they cannot drift on what counts as a source. Import/export (`lib/config-io.ts`) carries `groupConfig` as an optional field with a preview diff and re-normalizes it against the imported Site Engines view, and v4 imports are accepted as structurally-v5-without-`groupConfig`.

## Why This Matters

**Layering keeps three axes composable.** Source visibility, source order, and top-row layout are orthogonal. A user hiding a provider, reordering engines, and pinning a Site Engine to the top row are doing three independent things, and the design lets each happen without touching the others. `lib/sources.ts` keeps owning the projection (what exists, what is visible, the canonical order); `lib/source-groups.ts` only layers "which visible sources are pinned flat vs. collapsed into a group" on top. `projectLayout` consumes the already-projected source list — it never re-hides, never re-orders the underlying list; group-internal order is just the projection order filtered. Had grouping been folded into projection, every existing code path (the SERP inject bar, import merge, active-source resolution, the mutation queues) would have had to learn about groups, and the diff surface for a layout feature would have ballooned into the visibility model.

**Self-healing normalization plus lazy schema defaults match a BYOK reality.** Configured sources appear and disappear at runtime — a user adds a Site Engine, deletes a provider key, imports a backup. A persisted layout that points at a now-deleted source must not crash the render or strand the config. `normalizeGroupConfig` is the boundary that absorbs this churn: every read re-validates against the live source set and rewrites a clean config. Paired with the no-migration lazy-default getter pattern, new installs and old installs alike get a coherent default with zero migration code, and stale references heal themselves on the next read instead of accumulating. For an MV3 service worker that is frequently torn down and rebuilt, a read path that is also a repair path is what keeps the persisted state trustworthy.

**Pinning the indicator to only the pinned source keeps the segmented-control model coherent.** The switcher uses a sliding indicator — a single absolutely-positioned block that carries the brand color and slides between pills (segmented-control style). The indicator is anchored **only** to the active pinned source, never projected into a group:

```ts
const indicatorKey = useMemo(() => {
  if (activeId == null) return null;
  for (const item of layout.items) {
    if (item.kind === 'source') {
      if (item.source.id === activeId) return `s:${item.source.id}`;
    }
  }
  return null;
}, [activeId, layout]);
```

When the active source lives inside a group, the group's trigger shows a small badge (`containsActive`) but the indicator does not move onto the group. This keeps the indicator's meaning crisp — it always marks one concrete flat source — and avoids the incoherent state of an indicator "on" a group pill that actually contains an unrelated active source. The pin-or-group binary and the indicator rule are the same idea expressed at two layers: a source is lit up exactly where it lives, and a group is only ever a container, never a lit target.

## When to Apply

- **When a flat-list UI needs grouping without rewriting the underlying projection/visibility/order model.** If you already have a layer that owns ordering or visibility and it works, add grouping as a parallel layer that consumes its output rather than parameterizing the original layer with a group dimension. The cost is one normalization boundary; the benefit is that every existing consumer keeps working unchanged.

- **When adding a new persisted config key to an MV3 extension and you can avoid a data migration.** If the new key has a safe computed default and every reader already tolerates its absence, prefer a lazy getter default (`got[KEY] && typeof got[KEY] === 'object' ? normalize(got[KEY]) : defaultConfig(...)`) over a migration that writes placeholder data. Reserve the schema bump for cache invalidation and whitelist inclusion. This is the right call specifically when the migration would only be writing a default that the getter already produces.

- **When adding a nested/secondary UI axis to an existing primary axis.** The top-row layout (primary axis) and within-group membership (secondary axis) are separate concerns expressed in separate fields (`layout` vs. `assignments`). When a secondary axis would otherwise force the primary axis to carry extra structure, model them independently and project them together at render time.

- **When the entity set is user-controlled and volatile.** The normalization-as-read pattern is worth its complexity precisely when the set of valid ids changes at runtime (BYOK providers, user-defined Site Engines). For a fixed entity set, a migration that writes the full default is simpler and fine.

## Examples

### Before/after: flat switcher vs. mixed-layout projection

Before, the switcher consumed a flat `SearchSource[]` and rendered each as a pill in array order. The whole concept of "pin some, collapse others" did not exist; layout and projection were the same array.

After, the switcher consumes the same `sources` (still projected for order/visibility by `lib/sources.ts`) plus a `groupConfig`, and projects a mixed sequence:

```ts
const layout = useMemo(
  () => projectLayout(sources, groupConfig ?? defaultGroupConfig(sources.map((s) => s.id)), activeId),
  [sources, groupConfig, activeId],
);
```

`layout.items` is a list of `PinnedItem | GroupItem`. The same component renders both; a `GroupItem` carries `containsActive` for the badge and its `items` become the hover flyout. The projection layer was not modified to produce this — `projectLayout` runs on top of its output.

### The `normalizeGroupConfig` builtin-ordering fix

The naive backfill is wrong. If a persisted config only contains the `engines` builtin (the other two were somehow dropped), prepending the missing `ai-search` and `sites` yields `[ai-search, sites, engines, ...]` — which reorders the builtins away from `DEFAULT_GROUPS` order. The actual fix rebuilds the prefix from `DEFAULT_GROUPS` as a skeleton, taking the existing entry when present or the default when not, then appends any custom groups:

```ts
// 不能只 unshift 缺失项：若持久化里已有部分内置组（如只有 engines），
// 仅补缺失的 ai-search/sites 会让结果变成 [ai-search, sites, engines, ...]，
// 打破 DEFAULT_GROUPS 顺序。改为以 DEFAULT_GROUPS 为骨架重排。
const orderedIds = new Set<SourceGroupId>();
const ordered: SourceGroup[] = [];
for (const def of DEFAULT_GROUPS) {
  const existing = groups.find((g) => g.id === def.id);
  ordered.push(existing ?? def);
  orderedIds.add(def.id);
}
for (const g of groups) {
  if (!orderedIds.has(g.id)) { ordered.push(g); orderedIds.add(g.id); }
}
```

This is the kind of detail that only matters once data has been persisted and partially mutated — exactly the state normalization exists to repair.

### The v4→v5 no-migration decision

The migration registry shows the contrast clearly. The earlier bumps (v1→v2, v2→v3, v3→v4) each write real data — merging default-hidden engine ids, or materializing an explicit empty `siteEngines` array for old installs. The v4→v5 entry writes nothing:

```ts
// v3→v4: persisted Site Engines are opt-in; old installs get an explicit empty collection.
{ version: 3, migrate: (config) => ({ ...config, siteEngines: Array.isArray(config.siteEngines) ? config.siteEngines : [] }) },
// v4→v5: ...缺失键由 getter 回退默认配置，故迁移无需填充数据——仅 bump 版本戳以纳入 CONFIG_KEYS 白名单。
{ version: 4, migrate: (config) => config },
```

The bump still has a job: it advances the version stamp so `ensureSchema` treats the install as current, and it brings `groupConfig` under the `CONFIG_KEYS` whitelist so the migration machinery reads it consistently. But because `getGroupConfig` and `getProviderConfigSnapshot` both synthesize the default when the key is absent, no install needs data written to get the grouped experience. The decision is "migrate only when the getter cannot produce the right shape on its own."

## Related

- [persistent-source-order-and-visible-projection.md](./persistent-source-order-and-visible-projection.md) — the source projection layer (`sourceOrder`/`sourceHidden`) this layout layer sits on top of and deliberately does not mutate.
- [config-preference-pipeline.md](./config-preference-pipeline.md) — the end-to-end source-bar preference pipeline; `groupConfig` is the third pref carried through it (worker message, export/import round-trip, normalization, i18n parity, multi-host consumption).
- [dual-domain-storage-schema-versioning.md](./dual-domain-storage-schema-versioning.md) — the config-domain schema; the v4→v5 no-op migration here is a concrete application of its "getter-fallback keys don't need a migration" rule.
- [serp-switch-bar-and-unified-source-model.md](./serp-switch-bar-and-unified-source-model.md) — the unified switcher contract; `projectLayout`'s `PinnedItem | GroupItem` is the new seam the switcher consumes instead of a flat `SearchSource[]`.
- [separate-active-search-source-from-active-byok-provider.md](./separate-active-search-source-from-active-byok-provider.md) — the `SourceId = ProviderId | EngineId | SiteEngineId` union that `defaultGroupForSourceId` dispatches over.
