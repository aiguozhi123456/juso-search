---
title: Orthogonal UI style axes and distributed semantic color ownership
date: 2026-07-19
category: design-patterns
module: UI style system
problem_type: design_pattern
component: frontend_stimulus
severity: medium
applies_when:
  - Adding a switchable visual language that must remain independent of light and dark theme
  - Designing a colorful operational UI where color should communicate stable source and action identity
  - Applying one persisted UI preference across extension pages, tabs, and a shadow-DOM content script
  - Rendering viewport atmosphere from inside a width-constrained application root
related_components:
  - entrypoints/shared/tokens.css
  - entrypoints/search/styles.css
  - components/SourceSwitcher.tsx
  - lib/useStyle.ts
  - lib/storage.ts
  - entrypoints/serp-bar.content.ts
tags:
  - style-system
  - semantic-color
  - data-attributes
  - theme-orthogonality
  - chrome-storage
  - fouc
  - shadow-dom
  - source-identity
---

# Orthogonal UI Style Axes and Distributed Semantic Color Ownership

## Context

The classic vermillion design system remains the product's default visual identity. The new requirement was not another light/dark theme, but a separate style preference that lets the same light, dark, or system-resolved theme render as either `classic` or `colorful`.

An early interpretation treated "colorful" as a rainbow-gradient/Y2K aesthetic. It concentrated several hues inside individual controls and added multicolor decoration. That direction was rejected because it made color ornamental and noisy. The intended meaning was categorical: different functional regions should own different stable colors, while each control or region remains visually coherent.

The resulting model has two orthogonal axes on the root element:

```html
<html data-theme="light" data-style="colorful">
```

`data-theme` controls luminance and system-theme resolution. `data-style` controls visual language. Neither value is derived from the other, so all theme/style combinations remain possible.

There was also a background-layout issue. The homepage `.app` is constrained to `max-width: 720px`; atmospheric pseudo-elements positioned absolutely inside that container were clipped to the content column. Making those pseudo-elements fixed to the viewport, while clipping only horizontal document overflow, preserves the centered application geometry and lets the atmosphere fill the browser width.

## Guidance

Model a switchable visual language as an independent persisted preference when it is not semantically part of light/dark mode. Mirror the existing preference lifecycle end to end instead of implementing only a CSS toggle:

1. Define a narrow preference union and a storage key.
2. Validate persisted values and provide a conservative default.
3. Apply the root data attribute before React mounts to prevent FOUC.
4. Let a React hook own the attribute after mount, including optimistic persistence and rollback.
5. Broadcast storage changes through the background worker so open extension pages synchronize.
6. Expose an accessible toggle in user-controlled extension surfaces.
7. Let embedded surfaces such as the SERP bar follow the preference silently rather than adding another control.

The storage implementation follows the same key-hygiene rule as theme and locale: read only the requested key, never the entire local store.

```ts
export const STYLE_KEY = 'stylePref';
export type StylePref = 'classic' | 'colorful';

export async function getStylePref(): Promise<StylePref> {
  const got = await browser.storage.local.get(STYLE_KEY);
  const stored = got[STYLE_KEY];
  return stored === 'colorful' ? 'colorful' : 'classic';
}

export async function setStylePref(pref: StylePref): Promise<void> {
  await browser.storage.local.set({ [STYLE_KEY]: pref });
}
```

Load both initialization modules in the document head. They write separate attributes and therefore do not overwrite each other's state.

```html
<script type="module" src="../shared/theme-init.ts"></script>
<script type="module" src="../shared/style-init.ts"></script>
```

The style initializer establishes the classic default synchronously, then starts a precise-key read that may apply a validated stored value before React mounts:

```ts
function applyStyle(pref: StylePref) {
  document.documentElement.dataset.style = pref;
}

try {
  applyStyle('classic');
  if (typeof browser !== 'undefined' && browser.storage?.local) {
    void browser.storage.local.get('stylePref')
      .then((got) => {
        const pref = got.stylePref;
        if (isStylePref(pref)) applyStyle(pref);
      })
      .catch(() => undefined);
  }
} catch {
  // Non-extension/dev fallback remains classic.
}
```

At runtime, add the preference to the existing discriminated UI-preference message, validate it in the worker, and update `document.documentElement.dataset.style` from the hook. This keeps search and options tabs synchronized without exposing unrelated storage data. The SERP content script reads `getStylePref()` into its initial state and writes it to the shadow host:

```ts
shadowHost.dataset.engine = state.engine.id;
shadowHost.dataset.theme = state.resolvedTheme;
shadowHost.dataset.style = state.stylePref;
```

Keep classic CSS as the unscoped baseline. Add only colorful deltas under `[data-style="colorful"]`. This makes `classic` both the explicit default and the no-JavaScript/failure fallback.

Define palette tokens once, with light and dark values, then assign them by semantic ownership. The shared tokens make search blue, AI synthesis teal, success green, errors red, and warnings/history gold without turning every component into a bespoke palette implementation.

```css
:root[data-style="colorful"] {
  --color-red: #d94841;
  --color-orange: #e87524;
  --color-yellow: #9a7200;
  --color-green: #238636;
  --color-teal: #0f7f81;
  --color-cyan: #087ea4;
  --color-blue: #2563eb;
  --color-violet: #7040d8;

  --brand: var(--color-blue);
  --answer-bg: var(--color-teal-soft);
  --success: var(--color-green);
  --error: var(--color-red);
  --warning: var(--color-yellow);
}

:root[data-theme="dark"][data-style="colorful"] {
  --color-red: #ff7b72;
  --color-teal: #39c5bb;
  --color-blue: #79a8ff;
  --color-violet: #b794f6;
}
```

Color ownership should follow stable domain identifiers, not child position or translated labels. `SourceSwitcher` exposes both each source ID and the active source ID:

```tsx
<div className="source-switcher" data-active-source={activeId ?? undefined}>
  <button
    data-active={active ? 'true' : 'false'}
    data-source={s.id}
    aria-pressed={active}
  >
    <span className="source-label">{t(s.label)}</span>
  </button>
</div>
```

Define one stable source-ID mapping and keep its implementations in parity across CSS ownership boundaries. Extension pages use `search/styles.css`, while the isolated SERP shadow root repeats the mapping in `serp-bar-styles.ts`. The mapping is Google blue, Bing cyan, Baidu red, Tavily violet, Exa teal, StepFun orange, and StepFun Plan green.

```css
[data-style="colorful"] [data-source="google"] { --source-color: var(--color-blue); --source-soft: var(--color-blue-soft); }
[data-style="colorful"] [data-source="bing"] { --source-color: var(--color-cyan); --source-soft: var(--color-cyan-soft); }
[data-style="colorful"] [data-source="baidu"] { --source-color: var(--color-red); --source-soft: var(--color-red-soft); }
[data-style="colorful"] [data-source="tavily"] { --source-color: var(--color-violet); --source-soft: var(--color-violet-soft); }
[data-style="colorful"] [data-source="exa"] { --source-color: var(--color-teal); --source-soft: var(--color-teal-soft); }
[data-style="colorful"] [data-source="stepfun"] { --source-color: var(--color-orange); --source-soft: var(--color-orange-soft); }
[data-style="colorful"] [data-source="stepfun-plan"] { --source-color: var(--color-green); --source-soft: var(--color-green-soft); }
```

Pass the response provider into every result card so the same data attribute drives the rail color:

```tsx
<ResultList results={response.results} sourceId={response.provider} />

<article className="result-card" data-source={sourceId}>
```

Use multicolor atmosphere only at the page level. The homepage gradient runs from the upper right toward the lower left in the categorical sequence red, orange, yellow, green, cyan, blue, violet. Light mode mixes use 8-10% color; dark mode uses 5-7%. The classic atmosphere and colorful gradient share full-viewport geometry:

```css
body { overflow-x: clip; }

.app { max-width: 720px; margin: 0 auto; position: relative; }

.app--start::before { position: fixed; }

[data-style="colorful"] .app--start::before {
  inset: 0;
  width: auto;
  height: auto;
  border-radius: 0;
  filter: none;
  opacity: 1;
  background: linear-gradient(
    to bottom left,
    color-mix(in srgb, var(--color-red) 10%, transparent) 0%,
    color-mix(in srgb, var(--color-orange) 10%, transparent) 15%,
    color-mix(in srgb, var(--color-yellow) 8%, transparent) 29%,
    color-mix(in srgb, var(--color-green) 9%, transparent) 44%,
    color-mix(in srgb, var(--color-cyan) 9%, transparent) 59%,
    color-mix(in srgb, var(--color-blue) 10%, transparent) 75%,
    color-mix(in srgb, var(--color-violet) 9%, transparent) 91%,
    transparent 100%
  );
}
```

## Why This Matters

Orthogonal preferences prevent a combinatorial tangle in application state. Theme resolution can continue to handle `auto | light | dark`, while style remains an explicit `classic | colorful` choice. CSS composes the two attributes directly, including dark colorful token overrides, without combined values such as `colorful-dark`.

Stable semantic ownership makes color useful information. A blue submit action consistently means search, teal consistently identifies AI synthesis, gold identifies history/cache, violet identifies configuration, green identifies success, and red identifies destructive, interrupted, or failed actions. Locale owns orange. Users can scan regions by function, and adding color does not reduce every control to a miniature rainbow.

Stable source colors provide the same benefit for categorical identity. The active switcher indicator and result-card rail refer to the same provider mapping, so source identity survives layout, translated labels, reordering, and different rendering surfaces.

Pre-React initialization reduces the chance that a stored colorful page first paints in classic, but its asynchronous storage read is not a deterministic paint barrier. The hook must still converge on persisted state after mount. Runtime broadcasting prevents different extension tabs from drifting after a preference change. Defaulting invalid or missing values to classic preserves the committed design and gives storage corruption a predictable failure mode.

Viewport-relative pseudo-elements separate atmospheric geometry from the 720px content constraint. This preserves readable line lengths without visually boxing the page background into the application column.

## When to Apply

- A visual choice changes the product's design language but is independent of luminance, contrast mode, or system theme.
- Multiple extension pages, open tabs, and embedded shadow-root UIs must agree on one persisted preference.
- Regions or entities have stable identities that users repeatedly scan, such as providers, workflows, status families, or settings sections.
- A visual page background is produced inside a constrained content container but must belong to the viewport.

Do not apply the categorical system by putting many colors into each control, assigning hues by DOM position, or using gradients as generic emphasis. Those techniques make color decorative, unstable under reordering, and harder to interpret.

Because shadow DOM owns a separate stylesheet, adding or recoloring a Search Source requires updating both the extension-page and SERP mappings. Keep the source IDs and light/dark token choices in parity; a structural test is preferable to relying on visual review alone.

## Examples

Functional selectors express ownership directly rather than relying on a global rainbow treatment:

```css
/* Search = blue; interrupt/error = red. */
[data-style="colorful"] .search-box button[type="submit"] {
  background: var(--color-blue);
  border-color: var(--color-blue);
}
[data-style="colorful"] .search-box .interrupt-button,
[data-style="colorful"] .state.error button {
  border-color: var(--color-red);
  color: var(--color-red);
}

/* AI answer = teal. */
[data-style="colorful"] .answer-card {
  background: var(--color-teal-soft);
  border-color: color-mix(in srgb, var(--color-teal) 34%, var(--border));
}
[data-style="colorful"] .answer-card::before { background: var(--color-teal); }

/* History/cache = gold; settings = violet. */
[data-style="colorful"] .history-button:hover:not(:disabled) {
  color: var(--color-yellow);
  border-color: var(--color-yellow);
  background: var(--color-yellow-soft);
}
[data-style="colorful"] .settings-button:hover:not(:disabled) {
  color: var(--color-violet);
  border-color: var(--color-violet);
  background: var(--color-violet-soft);
}
```

The options page applies the same idea at section scale. Search-source settings are blue, the quickbar is teal, API-key state is gold, locale is orange, and configuration import/export is violet:

```css
[data-style="colorful"] .options section[data-section="search-source"] { --section-color: var(--color-blue); --section-soft: var(--color-blue-soft); }
[data-style="colorful"] .options section[data-section="quickbar"] { --section-color: var(--color-teal); --section-soft: var(--color-teal-soft); }
[data-style="colorful"] .options section[data-section="api-keys"] { --section-color: var(--color-yellow); --section-soft: var(--color-yellow-soft); }
[data-style="colorful"] .options section[data-section="locale"] { --section-color: var(--color-orange); --section-soft: var(--color-orange-soft); }
[data-style="colorful"] .options section[data-section="config"] { --section-color: var(--color-violet); --section-soft: var(--color-violet-soft); }
```

Verification should cover storage defaults and invalid-value fallback, hook initialization and rollback, runtime-message synchronization, toggle accessibility, stable `data-source` and `data-active-source` attributes, and search/options integration. Add direct initializer/handoff and worker-broadcast tests when first-paint ordering or the page/secret boundary changes. The completed change passed typecheck, lint, all 419 tests, the extension build, and `git diff --check`.

## Related

- [Theme persistence, i18n, and storage key hygiene](../best-practices/theme-persistence-i18n-key-hygiene.md) - packaged pre-React initialization, precise reads, rollback, and first-paint behavior.
- [Local search cache in MV3](../architecture-patterns/local-search-cache-mv3.md) - current worker-owned storage observation and sanitized cross-tab preference broadcasts.
- [Configuration preference pipeline](../architecture-patterns/config-preference-pipeline.md) - end-to-end checklist for durable preferences across storage and UI hosts.
- [SERP switch bar and unified source model](../architecture-patterns/serp-switch-bar-and-unified-source-model.md) - stable source identity and self-contained shadow-root tokens.
- [SERP bar engine-specific anchors](../ui-bugs/serp-bar-engine-specific-anchors.md) - concrete shadow-host `data-*` attribute and CSS contract.
