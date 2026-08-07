---
title: "Disable the base-provider dropdown in instance edit mode — switching it silently wipes options"
date: 2026-08-07
category: ui-bugs
module: components/ProviderInstanceManager
problem_type: ui_bug
component: tooling
symptoms:
  - "Editing a doubao instance, switching the base-provider dropdown to exa, and saving silently replaces the options bag with exa-shaped defaults"
  - "The instance's configured timeRange, sites, industry, etc. disappear with no error — the form reopens showing all defaults"
  - "The bug was unreachable before a second provider joined PROVIDERS_WITH_INSTANCE_OPTIONS because the dropdown had only one option"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [provider-instances, options-form, edit-mode, immutable-field, silent-data-loss, react-form]
---

# Disable the base-provider dropdown in instance edit mode — switching it silently wipes options

## Problem

The instance editor's base-provider `<select>` was editable in both create and edit modes. A provider instance's base provider is **encoded in its id** (`inst:<providerId>:<uuid>`) and is immutable at the storage layer — `updateProviderInstance` ignores any `baseProviderId` in the patch. But the editor's submit path assembles the options bag using `editor.baseProviderId` to pick the per-provider `settingsFromDraft` converter. So in edit mode, switching the dropdown from `doubao` to `exa` and saving produces an options bag built by `exaSettingsFromDraft` (exa-shaped), while the stored instance's base remains `doubao`. On the next read, `normalizeDoubaoSettings` receives an exa-shaped bag, recognizes none of the fields, and falls back to **all defaults** — silently wiping the user's configured timeRange, sites, blockHosts, industry, and every other setting.

This path was **unreachable** while `PROVIDERS_WITH_INSTANCE_OPTIONS` contained only `exa`: the dropdown rendered a single option, so no switch was possible. Adding `doubao` as the second instance-option provider activated the path and exposed the bug.

## Symptoms

- Editing a doubao instance, switching the base-provider dropdown to exa, and saving silently replaces the options bag with exa-shaped defaults
- The instance's configured timeRange, sites, industry, etc. disappear with no error — the form reopens showing all defaults
- The bug was unreachable before a second provider joined PROVIDERS_WITH_INSTANCE_OPTIONS because the dropdown had only one option

## What Didn't Work

- **Relying on the storage layer to reject the change.** `updateProviderInstance` silently ignores `baseProviderId` in the patch (base is id-encoded and immutable). It does not reject the mismatched options bag — the bag is an opaque `Record<string, unknown>` at the storage layer, validated only by the adapter's normalizer on read. So the bad write succeeds and the damage surfaces later as silent defaults.
- **Letting the form re-render on base change.** Switching the dropdown re-renders the per-provider form (exa form replaces doubao form), which visually signals a change, but the *instance's stored base* has not changed. The UI and the storage contract disagree, and the user sees no error on save.

## Solution

Disable the base-provider `<select>` in edit mode, matching the storage contract that base is immutable:

```tsx
// components/ProviderInstanceManager.tsx
<select
  id="provider-instance-base"
  value={editor.baseProviderId}
  onChange={(e) => patchEditor({ baseProviderId: e.target.value as ProviderId })}
  // base provider is id-encoded and immutable at the storage layer (updateProviderInstance);
  // disabling in edit mode prevents switching base → submit assembling options with the
  // wrong provider's settingsFromDraft → silent wipe on next read.
  disabled={editor.mode === 'edit'}
>
```

Create mode leaves the dropdown enabled — base is chosen once at creation and cannot change afterward.

## Why This Works

The root cause is a contract mismatch between the UI and the storage layer: the UI treats `baseProviderId` as editable, but storage treats it as immutable. The submit path trusts the UI's `baseProviderId` to pick the options converter, so an editable-but-immutable field creates a silent-corruption path — the converter and the stored base disagree.

Disabling the dropdown in edit mode makes the UI honor the immutability contract. The submit path's `editor.baseProviderId` then always matches the stored base in edit mode, so the correct `settingsFromDraft` converter is always used. The field becomes set-once: chosen at create, fixed at edit — which is exactly what the id-encoding model intends.

## Prevention

- **When a field is immutable by contract, the edit UI must make it immutable by interaction.** A field the storage layer silently ignores in a patch is a silent-corruption hazard if the UI lets the user change it — the UI will assemble downstream data (here, the options bag) using the new value while storage keeps the old one. Disable or read-only such fields in edit mode; never rely on the user noticing the mismatch.
- **Adding a second entry to a previously-singleton set is a UI regression trigger.** When `PROVIDERS_WITH_INSTANCE_OPTIONS` had one member, the base-provider dropdown could not be switched, so the edit-mode switch bug was dormant. Adding `doubao` activated it. Whenever a conditional UI path becomes newly reachable (a set gains a second member, a feature flag flips, a type union widens), audit every interaction that was previously impossible-by-virtue-of-singleton.
- **Test the edit path, not just create.** The instance editor tests covered create-mode options assembly and edit-mode round-trip, but no test switched the base provider in edit mode — because with one provider it was untestable. Once a second provider exists, add an edit-mode base-switch test (assert the dropdown is disabled, or assert the switch cannot corrupt options). The test should exist the moment the path becomes reachable, not after a review catches it.
- **The submit converter should key off the stored base, not the editor's draft base, in edit mode.** A deeper fix would make `settingsFromDraft` use `instance.baseProviderId` (the stored value) rather than `editor.baseProviderId` in edit mode, so even a UI bug in the dropdown cannot misroute the converter. The `disabled` attribute is the pragmatic fix; keying off the stored base is the defensive-design fix.

## Related

- `docs/solutions/architecture-patterns/provider-instance-multi-config-model.md` — instance model; base provider is id-encoded and immutable
- `docs/solutions/logic-errors/enum-timerange-silently-dropped-in-draft-conversion.md` — companion bug in the same editor, same review round
