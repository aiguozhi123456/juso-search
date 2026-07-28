---
title: Custom stepper control replacing the native number-input spinner
date: 2026-07-28
category: design-patterns
module: options UI / KeyInput component
problem_type: design_pattern
component: frontend_stimulus
severity: low
applies_when:
  - A numeric setting uses an `<input type="number">` whose browser-default spinner looks visually inconsistent with the design system
  - A number input participates in a blur-to-save flow where adjacent buttons must not steal focus and double-fire the save
  - A small bounded integer range (e.g. 1–20) needs affordance for both direct typing and ±1 stepping
related_components:
  - components/KeyInput.tsx
  - components/icons.tsx
  - entrypoints/options/styles.css
  - lib/i18n.ts
  - public/_locales/zh_CN/messages.json
  - public/_locales/en/messages.json
tags:
  - stepper
  - number-input
  - native-spinner
  - blur-to-save
  - accessibility
  - colorful-style
  - i18n-parity
---

# Custom Stepper Control Replacing the Native Number-Input Spinner

## Context

The per-provider "搜索结果条数" (max results) setting on the options page used a bare `<input type="number" min={1} max={20}>`. The value was saved on blur, with a separate Save button next to it. The browser's native up/down spinner — the small pair of arrows bolted onto the right edge of the input — rendered with no relation to the project's design tokens: wrong proportions, no brand color on hover, inconsistent across light/dark/colorful, and visually noisy inside the otherwise calm key-row layout. It read as "ugly" against the Takram-style control language used everywhere else.

The setting is a small bounded integer (1–20) that already supports direct typing and blur-save. The goal was to make the ±1 affordance match the design system without losing the existing save semantics, the blur+click double-trigger guard, or the three-theme (light/dark/colorful) coverage.

## Guidance

Replace the native spinner with a **custom stepper**: a compact `[− input +]` unit where the container owns the border and two icon buttons drive ±1. Keep the underlying `<input type="number">` for keyboard/IME input and native validation, but hide its native spinner and let the wrapper provide the visual chrome.

### 1. Hide the native spinner, keep the input

WebKit and Firefox expose separate pseudo-elements. Suppress both, and set `appearance: textfield` so Firefox does not render its own spinner either:

```css
.stepper__input {
  -moz-appearance: textfield;
  appearance: textfield;
}
.stepper__input::-webkit-inner-spin-button,
.stepper__input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
```

### 2. Let the container own the border; the input draws none

If the input keeps its own border inside a bordered wrapper, you get a double frame. Instead, the `.stepper` container holds the single border, hover, and focus ring; the input drops its border and uses only thin inner dividers to separate itself from the buttons:

```css
.stepper {
  display: inline-flex;
  align-items: stretch;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
  overflow: hidden;
  transition: border-color var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out);
}
.stepper:hover { border-color: var(--muted); }
.stepper:focus-within {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 18%, transparent);
}
.stepper__input {
  border: none;
  border-left: 1px solid var(--border-soft);
  border-right: 1px solid var(--border-soft);
  border-radius: 0;
  background: transparent;
  text-align: center;
}
/* The input must not re-add its own focus ring — the container already shows it. */
.stepper__input:focus { border-color: var(--border-soft); box-shadow: none; outline: none; }
```

### 3. Preserve blur-to-save with `onMouseDown preventDefault`

The existing flow saves on input blur, and a Save button next to the input already used `onMouseDown={(e) => e.preventDefault()}` to stop the input from losing focus before the click handler runs (plus a `maxSavingRef` guard against the residual double-fire). The stepper buttons must follow the **same** contract, or clicking `+`/`−` will blur the input, fire save on the old value, and race the step:

```tsx
<button
  type="button"
  className="stepper__btn"
  aria-label={t(MSG.opts_max_results_decrease)}
  onMouseDown={(e) => e.preventDefault()}
  onClick={() => stepBy(-1)}
  disabled={maxBusy || atMin}
>
  <MinusIcon size={14} />
</button>
```

### 4. Step from a computed value, not stale state

Because `onMouseDown preventDefault` keeps the input focused, the stepper's `onClick` runs while the input still holds the edited string. Reading `maxVal` directly inside the handler can race a pending `setState`. Compute the next value from the current string, clamp to the valid range, write it back to state, and pass the **resolved string** into the save function so it never reads a stale snapshot:

```tsx
function stepBy(delta: number) {
  const trimmed = maxVal.trim();
  const parsed = trimmed === '' ? NaN : Number.parseInt(trimmed, 10);
  const base = Number.isInteger(parsed) ? parsed : 0;
  const next = Math.min(20, Math.max(1, base + delta));
  const nextStr = next.toString();
  setMaxVal(nextStr);
  saveMaxResults(nextStr); // overrideValue avoids reading stale state
}

async function saveMaxResults(overrideValue?: string) {
  if (maxSavingRef.current) return;
  const trimmed = (overrideValue ?? maxVal).trim();
  // …empty = restore default; otherwise clamp-validate and persist.
}
```

### 5. Disable at boundaries, not just on busy

A stepper that lets the user click past the limit feels broken. Derive `atMin`/`atMax` from the current string and disable the corresponding button. Treat an empty (unset = restore-default) input as at-min for the `−` button, since there is nothing to decrement:

```tsx
const maxNum = maxVal.trim() === '' ? NaN : Number.parseInt(maxVal.trim(), 10);
const hasMaxNum = Number.isInteger(maxNum);
const atMin = !hasMaxNum || maxNum <= 1;
const atMax = hasMaxNum && maxNum >= 20;
```

### 6. Follow the section's semantic color in colorful mode

Under `[data-style="colorful"]`, color is owned by stable region identity, not sprinkled per-control. The max-results stepper lives inside the `api-keys` options section, which owns yellow. Override only the container focus ring and button hover — the rest inherits:

```css
[data-style="colorful"] .key-row__max-results .stepper:focus-within {
  border-color: var(--color-yellow);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-yellow) 18%, transparent);
}
[data-style="colorful"] .key-row__max-results .stepper__btn:hover:not(:disabled) {
  color: var(--color-yellow);
  background: var(--color-yellow-soft);
}
```

### 7. Localize the aria-labels

Stepper buttons are icon-only, so their accessible names come entirely from `aria-label`. Add the two message keys to the `MSG` constant and both locale files; the existing i18n-parity test then catches a missing or empty translation before it ships a raw key name to screen readers:

```ts
// lib/i18n.ts
opts_max_results_increase: 'opts_max_results_increase',
opts_max_results_decrease: 'opts_max_results_decrease',
```

```json
// public/_locales/zh_CN/messages.json
"opts_max_results_increase": { "message": "增加结果条数" },
"opts_max_results_decrease": { "message": "减少结果条数" }
```

## Why This Matters

- **Visual coherence:** The native spinner is the one element in a form that the design system cannot reach — it ignores `--brand`, `--radius`, and the colorful semantic-color ownership. Replacing it lets every control in the row speak the same visual language, including across light, dark, and colorful.
- **Save-correctness is non-obvious:** The hardest part is not the CSS; it is preserving a blur-to-save contract when the new buttons sit inside the same focus neighborhood. Skipping `onMouseDown preventDefault` or reading stale state in the step handler silently saves the wrong value. The `maxSavingRef` guard and the `overrideValue` parameter exist because blur+click races are easy to introduce and hard to notice in manual testing.
- **Accessibility:** Hiding the native spinner removes the only keyboard-free affordance the input had. The custom `−`/`+` buttons restore it, are tab-reachable, and carry localized `aria-label`s — but only if the i18n keys actually exist in both locales. The parity test is what makes icon-only buttons safe to ship.

## When to Apply

- A numeric input's native spinner clashes with the design system and the value lives in a small bounded range.
- The input already saves on blur (or on a sibling button click) and you are adding adjacent click targets inside the same focus neighborhood.
- The control must stay correct across light, dark, and a separate colorful style axis where color is owned by region.

Do not apply this to free-form numeric entry, unbounded ranges, or inputs where the native spinner is already acceptable — the wrapper, boundary logic, and i18n labels are overhead that only pays off when polish and save-correctness both matter.

## Examples

### Before — bare number input with native spinner

```tsx
<div className="key-row__max-results">
  <label>{t(MSG.opts_max_results_label)}</label>
  <input
    type="number"
    min={1}
    max={20}
    step={1}
    value={maxVal}
    onChange={(e) => setMaxVal(e.target.value)}
    onBlur={saveMaxResults}
    disabled={maxBusy}
  />
  <button onClick={saveMaxResults} onMouseDown={(e) => e.preventDefault()} disabled={maxBusy}>
    {t(MSG.btn_save)}
  </button>
</div>
```

### After — custom stepper wrapping the same input

```tsx
<div className="key-row__max-results">
  <label htmlFor={`max-results-${provider.id}`}>{t(MSG.opts_max_results_label)}</label>
  <div className="stepper">
    <button
      type="button"
      className="stepper__btn"
      aria-label={t(MSG.opts_max_results_decrease)}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => stepBy(-1)}
      disabled={maxBusy || atMin}
    >
      <MinusIcon size={14} />
    </button>
    <input
      id={`max-results-${provider.id}`}
      type="number"
      min={1}
      max={20}
      step={1}
      value={maxVal}
      onChange={(e) => setMaxVal(e.target.value)}
      onBlur={() => saveMaxResults()}
      disabled={maxBusy}
      className="stepper__input"
    />
    <button
      type="button"
      className="stepper__btn"
      aria-label={t(MSG.opts_max_results_increase)}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => stepBy(1)}
      disabled={maxBusy || atMax}
    >
      <PlusIcon size={14} />
    </button>
  </div>
  <button onClick={() => saveMaxResults()} onMouseDown={(e) => e.preventDefault()} disabled={maxBusy}>
    {t(MSG.btn_save)}
  </button>
</div>
```

Verification: typecheck, lint, and the full test suite (including `tests/options-page.test.tsx` and `tests/i18n-parity.test.ts`) all pass after the change.

## Related

- [Orthogonal UI style axes and semantic color ownership](./orthogonal-style-axis-and-semantic-color-ownership.md) — the `data-theme` × `data-style` model and the region-owned colorful color system the stepper follows under `[data-style="colorful"]`.
- [Options tabbed sidebar and shared page atmosphere](./options-tabbed-sidebar-and-shared-page-atmosphere.md) — the options IA and section structure the `api-keys` group (and thus the stepper's yellow colorful ownership) lives inside.
- [Theme persistence, i18n, and storage key hygiene](../best-practices/theme-persistence-i18n-key-hygiene.md) — the i18n-parity test that catches a missing `opts_max_results_increase`/`_decrease` translation before it ships a raw key to screen readers.
