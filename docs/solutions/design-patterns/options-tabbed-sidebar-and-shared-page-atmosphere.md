---
title: Options tabbed sidebar IA and shared page atmosphere substrate
date: 2026-07-26
category: design-patterns
module: options UI / shared page atmosphere
problem_type: design_pattern
component: frontend_stimulus
severity: medium
applies_when:
  - Restructuring a long single-column settings page into navigable groups
  - Sharing viewport atmosphere across multiple extension entrypoints
  - Porting Wordmark or BrandMark styles from one entrypoint CSS to another
related_components:
  - entrypoints/options/App.tsx
  - entrypoints/options/styles.css
  - entrypoints/shared/page-bg.css
  - entrypoints/search/styles.css
  - components/Wordmark.tsx
  - components/icons.tsx
  - tests/options-page.test.tsx
tags:
  - options-ui
  - settings-ia
  - sidebar
  - tabbed-pages
  - page-atmosphere
  - wordmark
  - brand-mark
  - style-parity
  - classic-colorful
---

# Options Tabbed Sidebar IA and Shared Page Atmosphere Substrate

## Context

The options page began as a single centered column of seven stacked sections. As Site Engines, quickbar management, API keys, locale, Agent Bridge, and config I/O accumulated, the page became a long scroll with no durable wayfinding. A left sidebar was added first as scroll-spy navigation, then product direction changed: categories should **split the page**, not merely jump within one scroll surface.

Separately, the search start page already owned a Takram-style atmosphere (classic brand glows, colorful categorical gradient). The options page used a flat `--bg-soft` canvas, so the two entrypoints felt like different products under the same brand. Wordmark and BrandMark styles also lived primarily in search-page CSS; options only had colorful overrides, so classic mode painted “双面搜 · 设置” without brand color, funnel fill, or the same lockup spacing.

## Guidance

### 1. Group settings by function, then page by group

Do not mirror every `<section>` as a top-level nav item. Collapse into a small set of durable groups:

| Group | Sections |
|-------|----------|
| 搜索 | active engine, site engines, quickbar |
| 密钥 | API keys |
| 通用 | locale, agent bridge, config I/O |
| 关于 | about-brand, about-links, about-tech, about-ack |

Use local UI state (`activeGroup`) and **conditional render** of that group’s sections. Prefer paged groups over scroll-spy when section count is still small and each group is a coherent task. Scroll-spy is for long single-document forms; paged groups are for distinct settings jobs.

Keep section markup, worker messaging, and preference logic intact. Only the shell changes. When tests assumed every section was mounted at once, switch to the target group before asserting (and switch back when later assertions need another group).

### 2. Own classic base styles where the component mounts

`Wordmark` and `BrandMark` are shared React components, but their lockup colors and spacing are CSS. If only `entrypoints/search/styles.css` defines:

```css
.wordmark-head { color: var(--brand); }
.wordmark-mark rect:nth-child(3) { fill: var(--brand); }
```

…then the options entrypoint inherits nothing. Each host that mounts the lockup must either import a shared wordmark stylesheet or declare the **classic base** plus any colorful overrides. Colorful selectors alone are not a base.

Classic BrandMark intent for this product: neutral upper bars (`currentColor` / `--fg`), **only the bottom (narrowest) bar** uses brand vermillion. Colorful BrandMark remains the three-tier red / orange / blue categorical mark — do not “fix” colorful when adjusting classic.

### 3. Extract viewport atmosphere to a shared substrate

Atmosphere belongs to the **document**, not to a max-width app column or a start-only state class. Put classic glows and colorful gradients on `body::before` / `body::after` in a shared file:

```text
entrypoints/shared/page-bg.css
```

Import it from both entrypoints after tokens:

```ts
import '../shared/tokens.css';
import '../shared/page-bg.css';
import '../shared/components.css';
import './styles.css';
```

Keep page-specific layout (`.app--start` vertical centering, `.options` grid) in the entrypoint CSS. Remove duplicate pseudo-element atmosphere from search when the shared file owns it. Align options `background` with the shared body canvas (`--bg`) so cards and soft surfaces remain the layered accents, not a second full-page fill.

## Why This Matters

- **IA:** Functional groups match how users think about the product (search setup, credentials, general prefs) better than a flat list of implementation sections.
- **Paging:** Conditional sections reduce cognitive load and avoid false “everything is one long form” mental models; tests must follow the same activation path as users.
- **Style parity:** Shared components without shared classic CSS produce classic-mode bugs that only appear when colorful is off — easy to miss in review.
- **Atmosphere:** One substrate keeps search and options on the same brand canvas and prevents the next entrypoint from re-copying fixed-position glows into another constrained root.

## When to Apply

- Options or settings surfaces grow past ~5 independent sections.
- Two or more extension HTML entrypoints should feel like one product shell.
- A shared presentational component (wordmark, mark, toggle row) gains CSS that only one entrypoint imported.

Do not page groups when a single short form is still scannable end-to-end. Do not put atmosphere inside a `max-width` content root if it must fill the viewport.

## Examples

**Paged group shell (shape):**

```tsx
const [activeGroup, setActiveGroup] = useState('search');
const navGroups = [
  { id: 'search', label: '搜索' },
  { id: 'keys', label: '密钥' },
  { id: 'general', label: '通用' },
  { id: 'about', label: '关于' },
];

// render only the active group's sections
{activeGroup === 'keys' && (
  <section data-section="api-keys">…</section>
)}
```

**Classic wordmark base on options (parity with search intent):**

```css
.wordmark {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}
.wordmark-mark { color: var(--fg); }
.wordmark-mark rect:nth-child(3) { fill: var(--brand); }
.wordmark-head { color: var(--brand); }
.wordmark-tail { color: var(--fg); }
```

**Shared atmosphere host:**

```css
/* entrypoints/shared/page-bg.css */
body::before { /* classic fixed brand glow */ }
body::after  { /* secondary glow */ }
[data-style="colorful"] body::before { /* full-viewport categorical gradient */ }
[data-style="colorful"] body::after { content: none; }
```

**Test activation when sections are paged:**

```ts
await userEvent.click(screen.getByRole('button', { name: '密钥' }));
// then assert API key rows
```

## Related

- [Orthogonal UI style axes and semantic color ownership](./orthogonal-style-axis-and-semantic-color-ownership.md) — `data-theme` × `data-style`, categorical color ownership; atmosphere geometry updated to the shared `page-bg` substrate.
- [Configuration preference pipeline](../architecture-patterns/config-preference-pipeline.md) — end-to-end preference wiring for sections that live under options groups.
- [Locale preference subscription state](../ui-bugs/locale-preference-subscription-state.md) — language control as options content, not chrome-only chrome.
- [Hidden source still active across hosts](../ui-bugs/hidden-source-still-active-across-hosts.md) — options active-source select and visibility projection rules.
