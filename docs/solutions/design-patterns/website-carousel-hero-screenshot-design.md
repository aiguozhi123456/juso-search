---
title: "Website hero carousel, screenshot framing, and page-scoped hero sizing"
date: 2026-08-08
last_updated: 2026-08-17
category: design-patterns
module: website
problem_type: design_pattern
component: documentation
severity: medium
applies_when:
  - "Building or maintaining the hero carousel on the Juso showcase website"
  - "Adding screenshot frames or adjusting screenshot dimensions"
  - "Scoping page-type-specific CSS (hero enlargement, layout overrides) via body class"
  - "Implementing keyboard-navigable, reduced-motion-respecting auto-rotating UI"
tags: [carousel, hero, screenshot, windowbar, accessibility, reduced-motion, aria, hugo]
---

# Website hero carousel, screenshot framing, and page-scoped hero sizing

## Context

The Juso showcase website's hero section evolved through several iterations — from a single static screenshot, to a 4-slide auto-rotating carousel, to a page-scoped enlarged variant that lives on the human-face route `/human/` (since the symmetric-IA restructure the root overview is a copy-only hero) — each step adding interaction or visual sophistication. The carousel needs to feel premium (auto-rotate, smooth transitions) while respecting accessibility constraints (keyboard navigation, screen-reader roles, reduced-motion preference). The screenshot framing needed visual consistency across six different frames across the site's page variants. And the hero enlargement needed to apply only to the human-face page without leaking into the overview or agent page's layout.

This document captures the durable design decisions so the next maintainer can evolve these components without re-deriving the accessibility model or the scoping strategy.

**Companion docs:**
- [`website-hugo-subpath-deployment.md`](../architecture-patterns/website-hugo-subpath-deployment.md) — overall site architecture and deployment
- [`website-hugo-template-maintainability.md`](../architecture-patterns/website-hugo-template-maintainability.md) — partial extraction patterns from the maintainability refactor

## Guidance

### 1. Hero carousel — vanilla IIFE with full a11y

The carousel is a framework-free IIFE in `layouts/_default/baseof.html`, discovered via `[data-carousel]` attribute and iterating `roots.forEach`. This supports multiple carousels without duplication.

**Core behavior model:**

| Feature | Implementation |
|---|---|
| Auto-rotate | `setTimeout` recursive tick at 6s interval; first slide `loading="eager"` + `fetchpriority="high"` for LCP |
| Pause: hover/focus | `hovered` flag set on `mouseenter`/`focusin`, cleared on `mouseleave`/`focusout` (focusout checks `relatedTarget` to avoid premature resume during internal focus moves) |
| Pause: tab hidden | Single shared `visibilitychange` listener on `document` — iterates all carousel roots, calls their stored `_jusoCarouselStart`/`_jusoCarouselStop` methods |
| Reduced motion | `matchMedia('(prefers-reduced-motion: reduce)')` — no auto-start, dots still work, listener reacts if preference changes mid-session |
| Keyboard nav | ArrowLeft/ArrowRight on the dots `tablist` (WAI-ARIA tabs pattern); `e.preventDefault()` prevents page scroll; moves focus to the new dot |

**Why the visibilitychange listener is hoisted outside the loop:** N carousels with per-instance `document.addEventListener('visibilitychange', ...)` leaks N listeners. The hoisted version stores `start`/`stop` on each root element and has ONE listener iterate all roots. This was a maintainability fix applied after the initial implementation.

**ARIA structure** (in `partials/hero-visual-home.html`):
```html
<div class="hero__card carousel" data-carousel
     role="region" aria-roledescription="carousel"
     aria-label="{{ i18n "carousel_label" }}">
  <div class="carousel__viewport">
    <div class="carousel__slide is-active" data-slide id="slide-0"
         role="group" aria-roledescription="slide"
         aria-label="{{ i18n $s.cap }}"
         aria-hidden="false">
      <img src="..." alt="{{ i18n $s.cap }}" ...>
    </div>
    <!-- ...more slides, aria-hidden toggles via JS... -->
  </div>
  <div class="carousel__caption">
    <span data-carousel-caption aria-live="polite">{{ i18n "cap_search" }}</span>
    <div class="carousel__dots" role="tablist" aria-label="...">
      <button class="carousel__dot is-active" role="tab"
              aria-selected="true" aria-controls="slide-0"
              aria-label="Slide 1 of 4"></button>
    </div>
  </div>
</div>
```

The `data-carousel-caption` element updates via JS on each slide change, and `aria-live="polite"` announces the new caption to screen readers without interrupting.

### 2. Page-scoped hero enlargement — face body class

The human-face page hero is deliberately larger than the agent-face page hero: wider max-width (1240px vs 1160px), a `0.75fr 1fr` grid (visual-dominant), and stretched visual column. This sizing is scoped via a **body class named after the face**, not the visual treatment:

```html
<!-- baseof.html -->
<body class="face-{{ $face }}">
```
(`$face` resolves from `.RelPermalink` — `face-overview` on `/`, `face-human` on `/human/`, `face-agents` on `/agents/`. See [`juso-marketing-site-symmetric-dual-face-ia.md`](../architecture-patterns/juso-marketing-site-symmetric-dual-face-ia.md).)

```css
/* style.css — scoped under face class */
.face-human .hero__inner { max-width: 1240px; grid-template-columns: 0.75fr 1fr; }
.face-human .hero__visual { max-width: none; justify-self: stretch; }
```

**Why face-named classes not treatment-named:** the class name should describe *which page* gets the treatment, not *what the treatment is*. A future developer adding a new face reads `face-human` and knows it's a face flag; `hero-enlarged` describes a CSS consequence that requires reading the stylesheet to understand. (Renamed `hero-enlarged` → `is-home` in the maintainability refactor, then `is-home` → `face-human` in the symmetric-IA restructure when the human face moved off the root.)

The agent-face page (`agents/single.html`) carries `face-agents` and inherits the default hero proportions — its CLI demo block is compact and doesn't need the enlarged visual column.

### 3. Screenshot frame unification — `.windowbar` component

All screenshot frames on the site use a single `.windowbar` component: three recessed dots on a cinnabar-hairline bar, no fake address bar. This replaced an earlier inconsistent `.browser-chrome__bar` that varied between frames.

```html
<div class="shot">
  <div class="windowbar" aria-hidden="true">
    <span class="windowbar__dot"></span>
    <span class="windowbar__dot"></span>
    <span class="windowbar__dot"></span>
  </div>
  <img src="..." alt="..." width="1200" height="641">
  <div class="shot__cap"><b>{{ i18n "cap_search" }}</b></div>
</div>
```

**Screenshot dimensions** (consistent across all product screenshots):
- Carousel screenshots: **1200×641** (search, instances, cache, sources — the live slides; SERP and agent-bridge screenshots remain as assets but are no longer referenced by any layout). Showcase frames: **1600×900** (`static/img/showcase/*.png`, the bilingual zh-light/en-dark pairing added 2026-08-16)
- Architecture diagram: **1040×1030** (square-ish, different aspect by design)
- Demo GIF: **960×519**

Correct `width`/`height` attributes on every `<img>` prevent CLS (cumulative layout shift). A mismatch caused visible jank before the unification pass.

### 4. Screenshot asset workflow — dual-location with documented mapping

Screenshots are captured once and copied to two locations with different naming conventions:

| Website (`static/img/`) | Docs (`docs/assets/screens/`) |
|---|---|
| `screenshot-<topic>.png` | `<area>-<topic>-clean.png` |

The mapping is documented in `static/img/README.md`. When a screenshot needs updating, both locations must be updated — and a CI drift-lock (`scripts/check-website-assets.py`) now SHA256-verifies every pair against the README's mapping table, so a forgotten re-sync fails the build instead of drifting silently. The `showcase/` subdirectory (7 images from `docs/assets/showcase/`, documented in the same README) is a newer dual-location set not yet drift-locked.

A screenshot generation script was created, then removed: the script's parameter drift risk (capture coordinates, timing, viewport assumptions) exceeded the value of automation for a small, infrequently-updated set of screenshots. Manual capture + CI byte-equality drift-lock is the current workflow — the capture is manual, but the sync is enforced.

## Why This Matters

**The carousel is the page's LCP element.** The first slide loads eagerly with `fetchpriority="high"`; subsequent slides are lazy. If the carousel markup or the IIFE breaks, the hero section either shows nothing or shows a broken layout — there is no static fallback. The IIFE's defensive checks (`if (!roots.length) return`, `if (n < 2) return`) ensure it fails gracefully rather than throwing.

**Reduced-motion is non-negotiable for auto-rotating UI.** A user with vestibular sensitivity who lands on an auto-rotating carousel with no way to stop it will leave the site. The `matchMedia` check prevents auto-start; the `change` listener stops rotation if the preference is enabled mid-session; hover/focus pause gives everyone a way to freeze a slide.

**Page-type body classes scale better than per-page stylesheets.** The overview, human-face, and agent-face pages all share `baseof.html`. A face body class is the cheapest way to diverge on a single layout dimension (hero sizing) without forking the base template or adding conditional stylesheet loading.

## When to Apply

- **Adding a slide to the carousel:** add a `dict` to the `$heroShots` slice in `partials/hero-visual-home.html` with `img`, `cap` (i18n key), and optional `eager: true` (only for the first slide). The IIFE auto-discovers new slides.
- **Adding a second carousel:** the `[data-carousel]` discovery and the shared `visibilitychange` listener already handle multiple instances. Add the markup with `data-carousel` attribute — no JS changes needed.
- **Scoping a new face's visual treatment:** add a face body class (`face-human`, `face-agents`, `face-overview`) and scope CSS under it. Do not use presentation-descriptive names (`hero-enlarged`, `wide-layout`).
- **Adding a screenshot frame:** use the `.shot` → `.windowbar` + `<img>` + `.shot__cap` pattern. Match the dimension convention: 1200×641 for carousel screenshots, 1600×900 for showcase frames.

## Examples

### Carousel pause-resume lifecycle

```
User hovers → hovered=true → stop() → slides freeze
User moves mouse away → hovered=false → start() → auto-rotate resumes
User tabs into carousel → focusin → hovered=true → stop()
User tabs out → focusout → relatedTarget check → hovered=false → start()
User switches tab → visibilitychange → stop() on all carousels
User returns → visibilitychange → start() on all carousels
User has reduced-motion → start() returns early → no rotation ever
```

### Hero grid comparison

| Page | Body class | Hero grid | Visual column |
|---|---|---|---|
| Overview (`/`) | `face-overview` | single column, centered copy | none — copy-only hero with scroll key to the door cards |
| Human (`/human/`) | `face-human` | `0.75fr 1fr`, max-width 1240px | stretched (carousel) |
| Agent (`/agents`) | `face-agents` | default (`1fr`), max-width 1160px | `max-width: 520px` |

## Related

- [`website-drift-lock-enforcement.md`](../architecture-patterns/website-drift-lock-enforcement.md) — the CI byte-equality drift-lock that now enforces the screenshot dual-location sync.
- [`website-hugo-subpath-deployment.md`](../architecture-patterns/website-hugo-subpath-deployment.md) — site architecture, deployment, design-system inheritance
- [`website-hugo-template-maintainability.md`](../architecture-patterns/website-hugo-template-maintainability.md) — partial extraction patterns (the carousel IIFE's `visibilitychange` hoist was part of this refactor)
- [`bilingual-brand-naming-shuangmiansou-juso.md`](../best-practices/bilingual-brand-naming-shuangmiansou-juso.md) — brand naming conventions (the hero wordmark "双面搜 / Juso")
