---
title: "Draft-to-settings conversion must round-trip every enum value, not just the complex branch"
date: 2026-08-07
category: logic-errors
module: components/ProviderInstanceManager
problem_type: logic_error
component: tooling
symptoms:
  - "Selecting an enum time range (OneDay/OneWeek/OneMonth/OneYear) for a doubao instance and saving stores timeRange as empty string"
  - "The custom date-range branch worked; every preset enum value was silently discarded"
  - "Editing an instance with a saved enum timeRange and saving (even just renaming) would wipe the timeRange"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [provider-instances, options-form, draft-conversion, round-trip, enum, silent-data-loss, react-form]
---

# Draft-to-settings conversion must round-trip every enum value, not just the complex branch

## Problem

The doubao instance options form lets the user pick a publication time range from a dropdown: unlimited, one of four preset enums (`OneDay`/`OneWeek`/`OneMonth`/`OneYear`), or a custom `YYYY-MM-DD..YYYY-MM-DD` date range assembled from two date inputs. The draft-to-settings converter (`doubaoSettingsFromDraft`) handled the custom branch but fell through to `''` for every enum value:

```ts
// BEFORE — only the custom branch produces a value; enums fall to ''
timeRange: draft.timeRange === 'custom' && draft.timeStart && draft.timeEnd
  ? `${draft.timeStart}..${draft.timeEnd}`
  : '',
```

So selecting "1 week" and saving stored `timeRange: ''` (unlimited) — the user's choice was silently discarded. The reverse direction (`doubaoDraftFromInstance`) correctly mapped a stored `'OneWeek'` back into the draft, so editing an existing enum instance showed the right dropdown — but any save (even a rename-only save) would run the forward converter and wipe it.

## Symptoms

- Selecting an enum time range (OneDay/OneWeek/OneMonth/OneYear) for a doubao instance and saving stores timeRange as empty string
- The custom date-range branch worked; every preset enum value was silently discarded
- Editing an instance with a saved enum timeRange and saving (even just renaming) would wipe the timeRange

## What Didn't Work

- **Testing only the custom branch.** Both new component tests exercised the custom date-range path (one created with a custom range, one round-tripped a custom range). No test selected an enum value and saved — so the bug hid behind the most complex branch's coverage. The custom branch was the interesting case; the enum branches looked trivial and were skipped.
- **The reverse converter passing tests.** `doubaoDraftFromInstance` correctly split a stored enum into the draft, so an edit-mode round-trip test that loaded an enum instance, didn't change it, and saved would *appear* to work — except the save runs the broken forward converter and wipes the value. A round-trip test must assert the *stored* value after save, not just the *displayed* value before save.

## Solution

The forward converter must pass enum values through, not collapse them to the default:

```ts
// AFTER — custom assembles the range; enums pass through; '' stays ''
timeRange: draft.timeRange === 'custom'
  ? (draft.timeStart && draft.timeEnd ? `${draft.timeStart}..${draft.timeEnd}` : '')
  : draft.timeRange,
```

The custom branch also gained an ordering guard (`timeStart <= timeEnd`, ISO-lexicographic) so an inverted range falls to `''` rather than producing a malformed `2026-02-01..2026-01-31` — the date input's `min` attribute only guides, it does not enforce.

## Why This Works

The draft type holds `timeRange` as a string that is either `''`, an enum literal, or the sentinel `'custom'` (which signals "assemble from timeStart/timeEnd"). The forward converter's job is to turn that draft string into the wire-format string the API expects. The bug treated `'custom'` as the only value-producing case and everything else as `''` — but the enum literals *are* the wire-format values; they need no transformation, only pass-through. The fix recognizes three cases: custom (assemble), enum (pass-through), unlimited (empty). The default branch is pass-through, not collapse-to-empty, so no future enum addition can be silently dropped.

## Prevention

- **A draft↔settings converter must be tested for every enum value, not just the complex branch.** The custom date-range branch was the interesting code, so it got the tests. The enum branches looked trivial, so they didn't — and the trivial-looking fallthrough `: ''` was the bug. When a converter has a "special" branch and a "default" branch, test that the default branch preserves each enum value, because the default is where silent data loss hides.
- **Round-trip tests must assert the stored value, not the displayed value.** A round-trip that loads `'OneWeek'`, doesn't touch the field, and saves will show `'OneWeek'` in the form both before and after — but if the forward converter is broken, the *stored* value after save is `''`. Assert on the message payload (`createProviderInstance` / `updateProviderInstance` options), not on the form state. The form state only proves the reverse converter works.
- **Prefer pass-through over collapse for the default branch.** When the draft already holds the wire-format value (enum literals are valid API values), the default branch should pass the value through, not replace it with a default. Collapse-to-default is only correct when the draft value is a sentinel that must be transformed — and `'custom'` is the only sentinel here.
- **A rename-only save is a round-trip test case.** If a user opens an instance, changes only the name, and saves, every options field should survive unchanged. This is the minimal round-trip and it catches forward-converter bugs that the reverse converter masks. Add it as a baseline test for any options form.

## Related

- `docs/solutions/ui-bugs/edit-mode-base-provider-switch-silently-wipes-options.md` — companion bug in the same editor, same review round
- `docs/solutions/architecture-patterns/provider-instance-multi-config-model.md` — instance model; adapter normalizer fills defaults from the options bag
