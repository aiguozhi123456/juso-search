---
title: "Options-page select theming: paint the chevron on a wrapper pseudo-element, never on the control's own background"
date: 2026-09-09
category: ui-bugs
module: "entrypoints/options (native form control styling)"
problem_type: ui_bug
component: frontend_stimulus
severity: medium
symptoms:
  - "Newly added select (site-instance time-range filter) rendered browser-default oversized because no CSS existed for its row/classes"
  - "Recoloring a select with a `background: var(--bg)` shorthand made the custom chevron tile across the whole control instead of showing one arrow"
  - "The corruption was dark-theme-only; in light theme the same override silently removed the chevron entirely, which looked 'clean' and was easy to miss"
root_cause: wrong_api
resolution_type: code_fix
related_components:
  - "entrypoints/options/styles.css"
  - "entrypoints/options/App.tsx"
  - "components/ProviderInstanceManager.tsx"
  - "components/SourceGroupEditor.tsx"
  - "components/SiteInstanceManager.tsx"
tags: [css, select, appearance-none, background-shorthand, css-specificity, dark-theme, mask, options-page]
---

# Options-page `<select>` theming: paint the chevron on a wrapper pseudo-element, never on the control's own background

## Problem

All native `<select>` controls on the options page (`entrypoints/options/styles.css`, the 原生控件定制 block) are restyled with `appearance: none` plus a custom SVG chevron. The old design painted that chevron as a `background-image` on the `<select>` element itself, with three hardcoded-color copies (light `#666`; dark `#9aa0a6` under both `:root[data-theme="dark"] .options select` and the `@media (prefers-color-scheme: dark) :root:not([data-theme])` fallback). This design failed twice within the site-instances change: the new zhannei filter row's `<select>` shipped with zero dedicated CSS and rendered as an oversized default-looking control, and the first styling attempt used a `background: var(--bg)` shorthand that — combined with the higher-specificity dark-theme rules — tiled the chevron into a row of arrows across the control in dark mode.

## Symptoms

- The new site-instance filter `<select>` (zhannei construction-mode filter row in `components/SiteInstanceManager.tsx`) rendered as an oversized control that clashed with the compact inline row of small labels and checkboxes.
- After the first styling attempt, in dark theme the affected `<select>` showed the chevron SVG repeated across its entire surface (a grid of small arrows) instead of a single right-aligned arrow.
- The corruption was dark-theme-only. In light theme the same control looked merely "clean" — the local shorthand had silently removed the chevron there too, which is easy to miss and is itself a defect.

## What Didn't Work

- **Guarding the element-painted chevron by convention.** The codebase already carried scar tissue: `.provider-instance-form select` needed a comment ("use `background-color`, not the `background` shorthand, to preserve the global chevron image") and `.exa-field select` had previously broken when an undefined token (`--bg-card`) was used inside a `background` shorthand — the whole shorthand went invalid at computed-value time and the background collapsed to transparent. Comments do not compile-time-check anything; the next contributor (or the next themed rule) resets the trap.
- **The fatal first fix** for the oversized filter select (development-time attempt, later replaced):

  ```css
  /* BROKEN — do not do this */
  .site-instance-filter-select select {
    background: var(--bg); /* shorthand: also resets image / position / repeat */
    font-size: var(--text-sm);
    padding: var(--space-1) var(--space-3);
  }
  ```

  Mechanics of the failure:
  - The `background` shorthand sets `background-color` **and resets** `background-image: none`, `background-position: 0% 0%`, `background-repeat: repeat`.
  - Light theme looked fine: the light rule `.options select` has specificity (0,1,1), ties with this local rule, and loses on source order — so the chevron image was simply gone.
  - Dark theme broke: the theme-variant rules (`:root[data-theme="dark"] .options select` and the media-scoped `:root:not([data-theme])` twin) have specificity (0,3,1) — three class-level simple selectors (`:root`, the attribute, `.options`) plus the element — which outranks the local rule's (0,1,1) no matter where the local rule sits in the file. Those rules re-supply **only** `background-image`; `background-repeat` and `background-position` stay at the shorthand-reset initial values (`repeat`, top-left). Result: a 16px chevron tiled edge-to-edge over the control.
- **Trusting specificity intuition across theme variants.** "My rule is later / more specific, so it wins" holds only within one theme variant. Theme-variant selectors are structurally higher-specificity than any single-class `something select` local rule, so an element-painted background image can always be resurrected — corrupted — by a variant the author is not looking at.

## Solution

Move the arrow off the element entirely. The `<select>` keeps `appearance: none` but now sets **only** `background-color: var(--bg)` — safe for any local rule to override — and the chevron is painted by a wrapper's `::after` using a CSS `mask` colored by a theme variable (`entrypoints/options/styles.css`):

```css
.options select {
  appearance: none;
  -webkit-appearance: none;
  padding: var(--space-2) var(--space-8) var(--space-2) var(--space-3);
  font-size: var(--text-md); font-family: inherit;
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  background-color: var(--bg);   /* background-color only — shorthand-safe */
  color: var(--fg);
  cursor: pointer;
  transition: border-color var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out);
}
.options select:hover { border-color: var(--muted); }
.options select:focus { border-color: var(--brand); }

.options .select-wrap {
  position: relative;
  display: inline-flex; max-width: 100%;
}
.options .select-wrap::after {
  content: '';
  position: absolute;
  top: 50%; right: var(--space-3);
  width: 16px; height: 16px;
  transform: translateY(-50%);
  background-color: var(--muted);
  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E") center / contain no-repeat;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E") center / contain no-repeat;
  pointer-events: none;
}
```

In markup, every select is wrapped in a `span.select-wrap`:

```tsx
// components/ProviderInstanceManager.tsx — Exa options form; same pattern at all 10 call sites
<label className="exa-field">
  <span className="exa-field-label">{t(MSG.opts_exa_search_type)}</span>
  <span className="select-wrap">
    <select value={draft.searchType} onChange={(e) => onChange({ searchType: e.target.value as ExaSearchType })}>
      {EXA_SEARCH_TYPES.map((st) => (
        <option key={st} value={st}>{t(MSG[`opts_exa_type_${st.replace(/-/g, '_')}` as keyof typeof MSG])}</option>
      ))}
    </select>
  </span>
</label>
```

All 10 selects were wrapped: `entrypoints/options/App.tsx` (x2), `components/ProviderInstanceManager.tsx` (x6), `components/SourceGroupEditor.tsx` (x1), `components/SiteInstanceManager.tsx` (x1). With the arrow owned by the wrapper, the three hardcoded `background-image` rules (light + both dark variants) and the legacy `.options select::-ms-expand` rule were deleted, and the compact filter override shrinks to properties that cannot interact with the chevron at all:

```css
/* site-instance zhannei filter row: compact inline layout.
   Arrow is drawn by .select-wrap; the select only slims font size and vertical padding
   (horizontal padding keeps the global values, reserving the arrow slot on the right). */
.site-instance-filter-select select {
  padding-top: var(--space-1); padding-bottom: var(--space-1);
  font-size: var(--text-sm);
}
```

Verified green after the refactor: typecheck, lint, and the full 1382-test suite.

## Why This Works

**Root cause: any custom-control appearance painted on the control element's own background is un-guardable.** Two independent mechanisms team up against it:

1. **Any element-level `background` shorthand anywhere in the codebase destroys it.** The shorthand unconditionally resets `background-image`/`-position`/`-repeat` to their initial values, so a completely unrelated local rule ("make this filter select compact") silently erases the chevron.
2. **Higher-specificity theme-variant rules resurrect it corrupted.** The dark-theme rules match with (0,3,1) and only re-declare `background-image`, so after a local shorthand has knocked `repeat` and `position` down to `repeat` / top-left, the resurrected 16px image tiles across the whole control. Specificity reasoning that works within a single rule set fails across theme variants, because variant selectors are structurally heavier than local ones.

The fix removes the collision domain instead of policing it. The arrow now lives on `.select-wrap::after` — a different element — so *no* rule targeting the `<select>`'s background, at any specificity, in any theme variant, can touch it. Local overrides become safe **by construction** rather than by discipline, which is why the compact filter rule can now be three lines of pure layout.

The `mask` choice also collapses the theme duplication. A mask consumes only the SVG's alpha channel, so one chevron asset serves light and dark alike; the visible color is the pseudo-element's `background-color: var(--muted)`, which follows the theme tokens automatically. That is what allowed deleting the three hardcoded-color rules (light `#666`, dark `#9aa0a6` twice) and the `::-ms-expand` legacy rule instead of adding a fourth variant.

## Prevention

- **Never paint a custom control's appearance (arrows, indicators, icons) on the control element's own background.** Put them on a wrapper pseudo-element (`position: relative` wrapper + absolutely positioned `::after`) using `mask` + a theme variable for color. This makes element-level `background` overrides safe by construction — the guard that comment-based convention could never provide.
- **When adding a form row or control, add its CSS in the same change.** The missing-styles half of this bug (a select shipped with zero stylesheet entry and rendered at default size) is prevented by the same review reflex as the theming half: a new control is not "done" until its styling lands with it.
- **Prefer `background-color` over the `background` shorthand when theming controls.** The shorthand's hidden resets (`background-image`, `-position`, `-repeat` back to initial) are exactly what let the dark-theme rules re-add the chevron in tiled form. Existing safe call sites (`.provider-instance-form select`, `.exa-field select`, `.layout-fold select`) already follow this.
- **When reviewing a control-theming change, check both themes and both theme mechanisms** (explicit `data-theme="dark"` and the `prefers-color-scheme` fallback for unset themes) — the tiled-chevron corruption existed only in dark mode, and the light mode "passed" by silently losing the arrow.

## Related

- [custom-stepper-replacing-native-number-spinner](../design-patterns/custom-stepper-replacing-native-number-spinner.md) — closest sibling pattern: the number-input re-skin lives by the same invariant family ("container owns the chrome; the input draws none"); this doc states the background-specific form and the cascade failure that motivates it.
- [orthogonal-style-axis-and-semantic-color-ownership](../design-patterns/orthogonal-style-axis-and-semantic-color-ownership.md) — style-system substrate: the mask + `var(--muted)` technique is theme-orthogonality applied — one alpha-only asset serves light and dark.
- [wxt-shadow-root-inline-style-clobber](wxt-shadow-root-inline-style-clobber.md) — same failure family: a declaration silently defeated by a stronger stylesheet rule; identical fix shape (relocate the vulnerable declaration where the interferer cannot reach).
- [options-tabbed-sidebar-and-shared-page-atmosphere](../design-patterns/options-tabbed-sidebar-and-shared-page-atmosphere.md) — owns the options stylesheet structure and cross-entrypoint style parity these rules live in.
