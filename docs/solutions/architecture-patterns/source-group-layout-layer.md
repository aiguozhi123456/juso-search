---
title: "Source Groups: A Layout Layer Over the Source Projection"
category: architecture-patterns
module: source switch bar (source-groups + source projection)
date: 2026-07-30
last_updated: 2026-08-01
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
  - drag-and-drop
  - touch-fallback
  - group-orders
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
  /** groupId → 该组显式成员顺序（仅收录「入组」且已知的 source；可缺省 = 回退 sources 顺序）。 */
  groupOrders: Record<string, SourceId[]>;
}

export type SwitcherItem =
  | { kind: 'source'; sourceId: SourceId }
  | { kind: 'group'; groupId: SourceGroupId };
```

Four deliberately independent fields:
- **`groups`** — the group definitions (id + label), ordered as they appear in the editor. The five builtins — `engines`, `sites`, `ai-engines`, `ai-search`, `custom` — always exist.
- **`layout`** — a single mixed sequence of top-row items. Each item is either a pinned source (rendered as a bare pill) or a group (rendered as a collapsible pill whose flyout opens on hover/focus as a *transient* state and pins open on click — click-to-pin, see [source-switcher-click-to-pin](../ui-bugs/source-switcher-click-to-pin.md)). Pinned sources and groups are peers and share one ordering, so the user can interleave them freely.
- **`assignments`** — `sourceId → groupId`, recorded **only** for sources that live inside a group. A pinned source does not appear in `assignments` at all; pinning is expressed by its presence in `layout`.
- **`groupOrders`** — `groupId → explicit member order` for that group. Optional per group: when absent, the group falls back to the projected `sources` order (see section 7).

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

Any value read from storage passes through `normalizeGroupConfig(raw, allSourceIds)` before it is used. It is the contract that guarantees a `GroupConfig` is always self-consistent regardless of what is on disk — which matters acutely in a BYOK extension where the source set is volatile. Its guarantees:

- **`groups`** — drops labels that fail `isSourceLabel`, dedupes by id (first wins), and **backfills the five builtin groups in `DEFAULT_GROUPS` order**.
- **`layout`** — drops items referencing unknown sources or unknown groups (`isSwitcherItem` checks against the live source-set and the known-group-set), dedupes by key keeping first occurrence, and falls back to `[{engines}, {sites}, {ai-engines}, {ai-search}, {custom}]` when layout is empty/missing.
- **`assignments`** — drops entries pointing at unknown sources, at deleted groups, and at sources that are currently pinned (a pinned source must not carry a stale assignment).

```ts
for (const [sid, gid] of Object.entries(rawAssignments)) {
  if (!knownSourceIds.has(sid as SourceId)) continue;          // 未知 source
  if (pinned.has(sid as SourceId)) continue;                    // 置顶 source 不应残留赋值
  if (typeof gid !== 'string' || !knownGroupIds.has(gid)) continue; // 指向已删除/未知分组
  assignments[sid] = gid;
}
```

Because the reader (`getGroupConfig`) normalizes in memory only and never writes back to storage (storage.ts:372-379), every consumer sees a consistent config even when the persisted form is stale. The writer (`setGroupConfig`) also normalizes before storing, so neither path can land a malformed config.

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

Adding a persisted config key normally means writing a migration. Here it did not. `lib/schema.ts` now sets `CURRENT_SCHEMA_VERSION = 6`; the v4→v5 entry below is the no-op for `groupConfig`, and a later v5→v6 migration hides the newly registered yandex/duckduckgo engines by default (merged into `sourceHidden`):

```ts
// v4→v5: 引入来源分组布局（groupConfig）。开箱即分组：缺失键由 getter 回退默认配置，
// 故迁移无需填充数据——仅 bump 版本戳以纳入 CONFIG_KEYS 白名单（ensureSchema 会读它）。
{ version: 4, migrate: (config) => config },
```

The comment in `CONFIG_KEYS` spells out why this is safe: `agentBridgeEnabled / engineSearchEnabled / providerMaxResults / groupConfig / serpBarPosition 默认值由 getter 兜底，不 bump 版本（无需迁移）`. The version bump is purely so `ensureSchema` includes `groupConfig` in its whitelist read (and for cache invalidation), not to transform stored data. Every reader falls back to `defaultGroupConfig(...)` when the key is absent or invalid, so existing installs get the grouped out-of-box experience without any data being written for them.

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

### 7. `groupOrders` — within-group order, decoupled from the global `sourceOrder`

Initially, group-internal order was just the projection order filtered (members sorted by `sources`, i.e. by `sourceOrder`). That leaked: reordering the quick-switch list changed the order inside every group, which users experienced as "editing one list changed another". `groupOrders` decouples the two axes:

- **`groupOrders[groupId]`** holds the explicit member order for that group, *only* for sources that are grouped (pinned sources are removed from every entry). Absent per group means "fall back to the projected `sources` order" — so old persisted configs without `groupOrders` render exactly as before (the field is fully optional and lazy).
- **Normalization** (`normalizeGroupConfig`, after `layout`/`assignments` cleaning) validates each entry against the live source set: ids must be known, not pinned, and resolve to that group (`resolveGroupId(id, assignments) === gid`); it dedupes and drops entries that end up empty. Residue from assignment changes (an id whose group moved on) is discarded, so stale positions never linger.
- **Projection** (`projectLayout`) is the defensive second layer: explicit ids that are not visible or not in the group are skipped, and remaining members are appended in `sources` order after the explicit prefix.
- **Relationship to `sourceOrder`**: `sourceOrder` remains the canonical *global* management order (quick-switch list display, active-source dropdown). Within-group order is an independent layout concern — editing one never mutates the other. The editor writes `groupOrders` on member drag and on pin/fold transitions (`pinSource` strips the source from all entries; `foldIntoGroup` appends to the target group's order; `deleteGroup` drops the group's entry).

**Single pure function `groupOrderOf` — the editor must not re-implement group-order parsing.** A second hand-rolled "resolve group order" inside the editor would drift from `projectLayout`. The shared rule lives in `lib/source-groups.ts` and serves both consumers:

```ts
/**
 * 解析某组的「管理视图」成员顺序（编辑器使用）：显式 groupOrders 优先
 * （防御过滤：未知/置顶/归属变更 id 剔除、去重保留首现），剩余成员按
 * `sourceIds` 顺序补尾；无显式顺序时全部按 `sourceIds` 顺序。
 */
export function groupOrderOf(
  sourceIds: readonly SourceId[],
  config: GroupConfig,
  groupId: SourceGroupId,
): SourceId[] {
  const pinned = pinnedSourceIds(config.layout);
  const idSet = new Set(sourceIds);
  const members = sourceIds.filter(
    (id) => !pinned.has(id) && resolveGroupId(id, config.assignments) === groupId,
  );
  const explicit = [...new Set(config.groupOrders?.[groupId] ?? [])].filter(
    (id) => idSet.has(id) && !pinned.has(id) && resolveGroupId(id, config.assignments) === groupId,
  );
  return [...explicit, ...members.filter((id) => !explicit.includes(id))];
}
```

`groupOrderOf` returns the **full member order** (management view, including hidden sources), while `projectLayout` operates on the visible subset. Both must agree on the same visible sequence — locked by a parity test (see Examples). All editor mutations build on it: `moveGroupMember` reorders the `groupOrderOf` result and writes it back wholesale; `pinSource` removes the id from every group entry; `foldIntoGroup` materializes the target group's **full** order (explicit prefix + remaining members by management order) before appending — never reuses the old group's order as base, which would cross-pollute (see pitfalls below).

### 8. Sorting UX: drag-and-drop with touch fallback and misclick guards

The quick-switch list (options page) originally offered per-item ↑↓ arrows, and the layout editor offered row moves — two surfaces could sort, and users could not tell which one "won". Sorting was centralized into the layout editor only: the quick-bar rows keep just name + visibility toggle; `moveSource`, `savingSourceOrder`, and `sourceOrderError` were removed from `entrypoints/options/App.tsx`. The mental model becomes "want to sort → go to the layout editor".

**Native HTML5 DnD rules:**

1. **Firefox requires `setData` to start a drag** — always call `setData('text/plain', ...)` and set `effectAllowed = 'move'` in dragstart. The index/source id is stored in a ref; drop reads the ref, not the DataTransfer payload.
2. **Never start a drag from an interactive control** — a slight pointer move while clicking a button would otherwise swallow the click. Guard in dragstart:

   ```ts
   /** 从行内交互控件（按钮/select/输入框）上按下不启动拖拽，防止轻微位移吞掉点击。 */
   function isInteractiveTarget(e: React.DragEvent): boolean {
     return !!(e.target as HTMLElement | null)?.closest('button, select, input, a');
   }

   function handleLayoutDragStart(e: React.DragEvent, index: number) {
     if (saving) return;
     if (isInteractiveTarget(e)) {
       // Chrome 中 dragstart 已开始拖拽，preventDefault 取消；Firefox 未 setData 本就不启动。
       e.preventDefault();
       return;
     }
     dragFromLayoutRef.current = index;
     setDraggingLayoutIndex(index);
     e.dataTransfer.setData('text/plain', String(index));
     e.dataTransfer.effectAllowed = 'move';
   }
   ```

3. **Member chips live inside group rows** — their dragstart/dragover/drop must `stopPropagation`, or the group row's top-level drag triggers instead. Cross-group member drags are a no-op: moving between groups is done by pin/fold controls, drag reorders within one group only.

**Touch fallback.** Native DnD is unavailable on touch devices, so member chips keep a pair of small ↑↓ arrows calling the **same** `moveGroupMember(groupId, index, index ± 1)` the drag uses — both interaction paths share one implementation and can never diverge. First/last members disable the out-of-bounds arrow.

**i18n and styling.** Two new keys (`opts_group_drag_handle` drag-handle hint, `opts_group_member_drag` member-drag hint with `{0}` source-name placeholder) plus rewritten `opts_quickbar_hint` / `opts_source_groups_hint`; zh/en `messages.json` stay in sync (i18n-parity test guards). Drag visuals reuse existing CSS variables (`--brand`/`--muted`/`--brand-soft`/`--duration-fast`) — no new palette.

**Pitfalls encountered while building this:**
- **`foldIntoGroup` cross-group pollution** — the first version used `orders[oldGroupId]` as the base, mixing the old group's order into the new group. The base must be the **target** group's explicit order, merged with `groupOrderOf(groupId)`.
- **Folding into a partially-ordered group by inserting a single id** — the member rendered last but the stored order placed it inside the explicit prefix. Fix: materialize the full member order, then append.
- **Duplicate group-order parsing drifted** — before `groupOrderOf`, the editor's private resolution diverged from `projectLayout` (missing tail-backfill). Removed the private copy; parity tests keep them aligned.
- **Drag swallowed button clicks** — fixed by `isInteractiveTarget` + `preventDefault` (Chrome) and no-`setData` (Firefox).

## Why This Matters

**Layering keeps three axes composable.** Source visibility, source order, and top-row layout are orthogonal. A user hiding a provider, reordering engines, and pinning a Site Engine to the top row are doing three independent things, and the design lets each happen without touching the others. `lib/sources.ts` keeps owning the projection (what exists, what is visible, the canonical order); `lib/source-groups.ts` only layers "which visible sources are pinned flat vs. collapsed into a group" on top. `projectLayout` consumes the already-projected source list — it never re-hides, never re-orders the underlying list; group-internal order is either explicit (`groupOrders`) or the projection order filtered. Had grouping been folded into projection, every existing code path (the SERP inject bar, import merge, active-source resolution, the mutation queues) would have had to learn about groups, and the diff surface for a layout feature would have ballooned into the visibility model.

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

`layout.items` is a list of `PinnedItem | GroupItem`. The same component renders both; a `GroupItem` carries `containsActive` for the badge and its `items` become the flyout — opened transiently on hover/focus and pinned open on click (click-to-pin). The projection layer was not modified to produce this — `projectLayout` runs on top of its output.

### The `normalizeGroupConfig` builtin-ordering fix

The naive backfill is wrong. If a persisted config only contains some builtins, prepending the missing ones naively yields a sequence that reorders the builtins away from `DEFAULT_GROUPS` order. The actual fix rebuilds the prefix from `DEFAULT_GROUPS` as a skeleton, taking the existing entry when present or the default when not, then appends any custom groups:

```ts
// 不能只 unshift 缺失项：若持久化里已有部分内置组，仅补缺失项而不以
// DEFAULT_GROUPS 为骨架重排，会让内置组顺序偏离 DEFAULT_GROUPS。改为以骨架重排。
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

The migration registry shows the contrast clearly. The earlier bumps (v1→v2, v2→v3, v3→v4) each write real data — merging default-hidden engine ids, or materializing an explicit empty `siteEngines` array for old installs. The v4→v5 entry writes nothing (the schema has since moved to v6 — the v5→v6 migration again writes real data, hiding yandex/duckduckgo by default — but the no-op lesson here still holds):

```ts
// v3→v4: persisted Site Engines are opt-in; old installs get an explicit empty collection.
{ version: 3, migrate: (config) => ({ ...config, siteEngines: Array.isArray(config.siteEngines) ? config.siteEngines : [] }) },
// v4→v5: ...缺失键由 getter 回退默认配置，故迁移无需填充数据——仅 bump 版本戳以纳入 CONFIG_KEYS 白名单。
{ version: 4, migrate: (config) => config },
```

The bump still has a job: it advances the version stamp so `ensureSchema` treats the install as current, and it brings `groupConfig` under the `CONFIG_KEYS` whitelist so the migration machinery reads it consistently. But because `getGroupConfig` and `getProviderConfigSnapshot` both synthesize the default when the key is absent, no install needs data written to get the grouped experience. The decision is "migrate only when the getter cannot produce the right shape on its own."

### The `groupOrderOf` parity test — editor and projection cannot drift

Under the same config, the editor-side management order filtered to the visible subset must match the projection layer's in-group order exactly. Three visibility subsets pin the equivalence:

```ts
it.each([
  ['全部可见', SOURCES],
  ['baidu 与 site:docs 隐藏', SOURCES.slice(0, 5)],
  ['仅置顶 + 单引擎可见', [SOURCES[0], SOURCES[3], SOURCES[6]]],
])('%s：groupOrderOf 过滤可见后 === projectLayout 组内序', (_label, visible) => {
  const visibleIds = new Set(visible.map((s) => s.id));
  const layout = projectLayout(visible, cfg, null);
  for (const item of layout.items) {
    if (item.kind !== 'group') continue;
    const expected = groupOrderOf(ALL_IDS, cfg, item.group.id).filter((id) => visibleIds.has(id));
    expect(item.items.map((s) => s.id)).toEqual(expected);
  }
});
```

### Misclick-guard regression tests

Dragstart on a member's pin button must not produce any reorder; the quick-bar must render no sort buttons at all (`queryByRole('button', { name: /上移|下移/ })` is null). These two tests are what keep `isInteractiveTarget` and the "centralized sorting" decision from regressing silently.

## Related

- [persistent-source-order-and-visible-projection.md](./persistent-source-order-and-visible-projection.md) — the source projection layer (`sourceOrder`/`sourceHidden`) this layout layer sits on top of and deliberately does not mutate.
- [config-preference-pipeline.md](./config-preference-pipeline.md) — the end-to-end source-bar preference pipeline; `groupConfig` is the third pref carried through it (worker message, export/import round-trip, normalization, i18n parity, multi-host consumption).
- [dual-domain-storage-schema-versioning.md](./dual-domain-storage-schema-versioning.md) — the config-domain schema; the v4→v5 no-op migration here is a concrete application of its "getter-fallback keys don't need a migration" rule.
- [serp-switch-bar-and-unified-source-model.md](./serp-switch-bar-and-unified-source-model.md) — the unified switcher contract; `projectLayout`'s `PinnedItem | GroupItem` is the new seam the switcher consumes instead of a flat `SearchSource[]`.
- [separate-active-search-source-from-active-byok-provider.md](./separate-active-search-source-from-active-byok-provider.md) — the `SourceId = ProviderId | EngineId | SiteEngineId` union that `defaultGroupForSourceId` dispatches over.
- [hidden-source-still-active-across-hosts.md](../ui-bugs/hidden-source-still-active-across-hosts.md) — the editor's in-group view keeps hidden sources (`groupOrderOf` retains them; `projectLayout` skips them), the layout-layer extension of cross-host hidden-source projection consistency.
