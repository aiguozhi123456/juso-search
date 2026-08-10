---
title: Redefining a preference value's semantics requires a value-rewrite schema migration
module: lib/schema, lib/storage
date: 2026-08-04
category: docs/solutions/architecture-patterns
problem_type: architecture_pattern
component: tooling
severity: medium
applies_when:
  - Repurposing the meaning of an existing preference value rather than adding a new one
  - A preference value's runtime behavior changes but the value name is kept or recycled
  - Default-by-getter preferences that previously skipped schema bumps now need a one-time value rewrite
related_components:
  - service_object
  - background_job
tags:
  - schema-versioning
  - migration
  - preference
  - value-rewrite
  - config-io
  - seamless-migration
  - lib/schema
  - lib/storage
  - lib/config-io
---

# Redefining a preference value's semantics requires a value-rewrite schema migration

## Context

The extension's config domain uses a versioned schema (`lib/schema.ts`, `CURRENT_SCHEMA_VERSION`) with an append-only migration chain. Most preference keys are "default-by-getter": the getter returns a fallback when the stored value is missing or invalid, so introducing a new pref value (e.g. adding `'colorful'` to `stylePref`, or adding `'bottom'` to `serpBarPosition`) needs no schema bump — the getter simply accepts the new value and old installs see the default until they opt in.

This pattern breaks down the moment you **redefine what an existing value means** rather than add a new one. Redefining a value silently changes behavior for every user who already selected it, with no signal to the migration chain that a rewrite is needed.

The trigger case: `serpBarPosition` had values `'auto' | 'top' | 'bottom'`, where `'top'` meant *inline per-engine anchor insertion*. We wanted `'top'` to instead mean *fixed-overlay-at-top* (symmetric to `'bottom'`), and the old inline behavior to move to a new value `'inline'`. Users who had explicitly chosen `'top'` (for inline) had to land on `'inline'` (still inline) — not on the new `'top'` (overlay) — or their bar would silently change behavior.

## Guidance

**When you redefine a preference value's semantics, treat it as a value-rewrite migration: bump the schema version and add a migration that rewrites the stored value to preserve each user's original behavior.** This is a different operation from the usual "add a new value" (no bump) or "add a new key" (bump to enter the whitelist).

The migration must be:

1. **A pure function of the stored config** — `(config) => config.serpBarPosition === 'top' ? { ...config, serpBarPosition: 'inline' } : config`. No IO, no side effects.
2. **Idempotent** — re-running on already-migrated data is a no-op. The rewritten value (`'inline'`) must not match the rewrite condition (`=== 'top'`), so `ensureSchema`'s repeat calls are safe.
3. **Committed by the version stamp** — `ensureSchema` writes the migrated values and the new `schemaVersion` together; a failure leaves the old version so the next call retries.

```typescript
// lib/schema.ts
export const CURRENT_SCHEMA_VERSION = 8;

export const migrations: Migration[] = [
  // …earlier migrations…
  // v7→v8: serpBarPosition 'top' 重定义为固定覆盖顶栏；原内联引擎锚点插入重命名为 'inline'。
  // 旧 'top' 用户迁移到 'inline'，保持内联体验不变（无感）。'top' 现为固定覆盖顶栏。
  { version: 7, migrate: (config) => config.serpBarPosition === 'top' ? { ...config, serpBarPosition: 'inline' } : config },
];
```

### Default-by-getter users need no migration

Users who never set the preference (stored value is `undefined`) are **not** touched by the migration (`undefined === 'top'` is false) and continue to fall through to the getter default. If the default's *resolved* behavior is also unchanged, those users see no change at all.

In the trigger case, `auto` previously resolved to `'top'` (inline) on desktop; after the change `auto` resolves to `'inline'` on desktop. Same behavior, different resolved string. The `data-position` host attribute changed from `"top"` to `"inline"`, but the CSS for inline mode lives in the default `:host` block (no `data-position` qualifier), so the visual is identical. This is the "无感" (seamless) property — verify it by tracing the CSS cascade, not by assuming it.

### Import payloads need a parallel remap

`config-io`'s `parseImportPayload` validates against `BAR_POSITION_VALUES` (which now includes the new value). But a backup file from an older schema version carries the *old* semantics for the recycled value. A surgical remap in the parser — keyed on the payload's `schemaVersion`, not the current one — preserves the backup's original intent:

```typescript
// lib/config-io.ts — inside parseImportPayload, after schemaVersion validation
// 旧备份(v<8)的 'top' 语义为内联引擎锚点插入；v8 起 'top' 重定义为固定覆盖顶栏。
// 导入旧备份时 remap 'top'→'inline'，保持旧备份语义不变（与新 'top' 覆盖语义区分）。
if (schemaVersion < 8 && obj.serpBarPosition === 'top') obj.serpBarPosition = 'inline';
```

This is deliberately surgical (a single field), not a full `migrateConfig` run — the import path has its own merge semantics for source graphs that a generic migration would disrupt. The remap runs *before* the value-set validation so the now-valid `'inline'` passes.

### Update every validator in lockstep

A new pref value must be accepted by every layer that validates the preference, or the value will be silently dropped to the default at some boundary:

| Layer | What to update |
|---|---|
| `lib/storage.ts` | `BarPositionPref` type union; getter's value acceptance (`stored === 'inline'`) |
| `lib/ui-pref-sync.ts` | `isBarPositionPref` + the `uiPrefChanged` message variant validator |
| `lib/config-io.ts` | `BAR_POSITION_VALUES` set; legacy remap (above) |
| `lib/schema.ts` | `CONFIG_KEYS` whitelist (if the key isn't already in it); the migration entry |

Missing any one of these causes a different failure mode: a value that persists but won't broadcast, or broadcasts but won't import, or imports but won't survive a schema check.

## Why This Matters

Without a value-rewrite migration, the redefinition is a silent behavior change for every existing user of that value. The getter-default pattern that normally makes pref additions free **cannot** help here: the stored value is valid (it's in the enum), so the getter returns it as-is — now with the new meaning. The user opted into behavior A, upgraded, and got behavior B without any action on their part.

The cost of getting this wrong is high because it's invisible: tests pass (the new value is valid), typecheck passes (the union is correct), and the migration chain runs cleanly (it just doesn't rewrite anything). The only signal is a user reporting "my bar moved" weeks later, with no reproduction path.

The cost of doing it right is one migration entry + one surgical import remap — both pure functions, both idempotent, both committed atomically by the version stamp.

## When to Apply

Apply this pattern when **any** of these is true:

- You are keeping a preference value's name but changing what it does at runtime.
- You are recycling a value name (old meaning → new meaning) and introducing a new value for the old meaning.
- You are renaming a value (old name → new name) and want existing users to follow.
- A default-by-getter preference that previously "didn't need a bump" now needs its stored values rewritten.

Do **not** apply it when:

- You are only *adding* a new value (no existing user is affected; the getter handles it).
- You are *removing* a value (the getter's fallback handles orphaned values; no rewrite needed).
- You are changing a value's *implementation* without changing its *semantics* (e.g. refactoring how `'bottom'` renders, when it still means "fixed overlay at bottom").

The distinguishing question: *after this change, would a user who selected value X before the change still want value X after the change?* If no, you need a rewrite. If yes (X still means what they intended), you don't.

## Examples

### Redefining `'top'` (inline → overlay) with a rename to `'inline'`

Before — `'top'` = inline engine-anchor insertion, no `data-position="top"` CSS block:

```typescript
// lib/schema.ts — CURRENT_SCHEMA_VERSION = 7
// serpBarPosition 'top' added without a bump (getter-defaulted, no migration needed)

// lib/serp-bar-mount.ts
export function resolveBarPosition(pref: BarPositionPref, viewportWidth: number): 'top' | 'bottom' {
  if (pref === 'top') return 'top';      // inline behavior
  if (pref === 'bottom') return 'bottom';
  return viewportWidth <= 480 ? 'bottom' : 'top';  // auto → inline-on-desktop
}
```

After — `'top'` = fixed overlay, `'inline'` = old inline, v7→v8 rewrites stored `'top'`→`'inline'`:

```typescript
// lib/schema.ts — CURRENT_SCHEMA_VERSION = 8
{ version: 7, migrate: (config) => config.serpBarPosition === 'top' ? { ...config, serpBarPosition: 'inline' } : config },

// lib/serp-bar-mount.ts
export function resolveBarPosition(pref: BarPositionPref, viewportWidth: number): 'top' | 'bottom' | 'inline' {
  if (pref === 'top') return 'top';      // NEW: overlay behavior
  if (pref === 'inline') return 'inline'; // OLD 'top' behavior, now under 'inline'
  if (pref === 'bottom') return 'bottom';
  return viewportWidth <= 480 ? 'bottom' : 'inline';  // auto → inline-on-desktop (unchanged behavior)
}
```

Result: a user who had `'top'` (inline) now has `'inline'` (inline) — same bar, same CSS (default `:host` block). A user who had `'auto'` now resolves to `'inline'` instead of `'top'` — same behavior, because both meant inline. A user who picks the new `'top'` gets the new overlay. Three populations, three correct outcomes, one migration entry.

### The import-remap companion

A v7 backup file with `serpBarPosition: 'top'` means inline. Importing it into a v8 install without a remap would store `'top'` (now overlay) — silently changing the user's backup intent. The surgical remap keys on the *payload's* schema version, not the current one:

```typescript
if (schemaVersion < 8 && obj.serpBarPosition === 'top') obj.serpBarPosition = 'inline';
```

A v8 backup with `serpBarPosition: 'top'` means overlay and is left untouched (`8 < 8` is false). `buildExportPayload` always exports the current `CURRENT_SCHEMA_VERSION`, so freshly-exported backups carry the new semantics.

## Prevention

- **Treat a value redefinition as a schema event, not a getter change.** The default-by-getter pattern's "no bump needed" convenience applies only to *additions*. The moment an existing value's meaning changes, bump the version and write the rewrite.
- **Add a migration test that asserts the rewrite for each affected value, plus idempotency.** `tests/schema.test.ts` should cover: old-value → new-value, unaffected-values unchanged, re-run is a no-op.
- **Add an import-remap test keyed on the payload's schema version.** `tests/config-io.test.ts` should cover: old-schema backup with the recycled value → remapped; current-schema backup with the recycled value → untouched.
- **Trace the CSS cascade to verify the "seamless" claim for default users.** If the resolved-position string changes (e.g. `'top'` → `'inline'`), confirm the old users' visual was governed by a position-agnostic rule (like the default `:host` block), not by a `data-position="X"` selector that no longer matches. A visual change for default users means the migration isn't actually seamless.
- **Update the CONFIG_KEYS comment if it claims the key never needs a bump.** `lib/schema.ts`'s line-22 comment originally listed `serpBarPosition` among keys that "默认值由 getter 兜底，不 bump 版本（无需迁移）". After the v8 bump, that claim was corrected to note the exception. A stale "no bump" comment will mislead the next contributor into skipping a needed migration.

## Related

- [dual-domain-storage-schema-versioning](./dual-domain-storage-schema-versioning.md) — the schema versioning architecture this migration runs under. §"CONFIG_KEYS without a schema bump" was updated to reflect that `serpBarPosition` later *did* require a v7→v8 value-rewrite bump.
- [serp-bar-bottom-position-and-scroll-hide](./serp-bar-bottom-position-and-scroll-hide.md) — the bar positioning architecture. §5 documents the v7→v8 migration in the context of the three placement models (inline / top overlay / bottom overlay); §4g documents the `document.body` body-mount strategy shared by both overlay variants, on which the `inline ↔ overlay` flip remount rule depends.
