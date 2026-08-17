---
title: "Symmetric dual-face site structure: neutral overview root, symmetric face routes, and path-based face detection in Hugo"
date: 2026-08-10
last_updated: 2026-08-17
category: architecture-patterns
module: website
problem_type: architecture_pattern
component: documentation
severity: medium
applies_when:
  - Restructuring a multi-audience site into symmetric dual-face routes
  - When both audience faces need the root URL as a neutral overview landing
  - Switching layouts per Hugo section when .Type does not match the section name
  - Adding bilingual i18n keys to a Hugo site
  - Validating IA changes with build checks and drift locks
tags:
  - hugo
  - website
  - information-architecture
  - dual-face
  - faceswitch
  - relpermalink
  - type-lookup
  - i18n
---

# Symmetric dual-face site structure: neutral overview root, symmetric face routes, and path-based face detection in Hugo

## Context

The Juso marketing site (Hugo static site at `website/`, bilingual zh@root + `/en/`, deployed to the GitHub Pages subpath `/juso-search/`) had grown into an **asymmetric dual-face IA**: `/` carried the entire human face — carousel hero, capability matrix, sources, showcase, trust band, CTA — while the agent face lived under a single sub-page `/agents/`. The human audience owned the root URL and the agent audience got a corner of the site. During a review the user put it plainly: "我觉得这个网站的结构很怪，我想做成对称的" — the structure felt weird; they wanted symmetry.

The decision: **stop giving either audience the root**. `/` became a neutral overview landing — a copy-only hero (the dual-face thesis; no visual — a scroll key leads down to the door cards), a "two doorways" section with two cards linking to `/human/` and `/agents/` (each with a face label and positioning text), a dual-face capability matrix, a bilingual showcase section, and a neutral CTA band (a same-day follow-up deduped the faces — matrix stayed on the root, the sources icon wall moved to `/human/`). Each face then owns one symmetric section route:

- `/human/` — new section (`content/human/index.md` + `index.en.md`), layout `layouts/human/single.html` = a copy of the old `layouts/index.html` body.
- `/agents/` — unchanged section.

`/agents/` kept its plural path (rather than renaming to `/agent/`) because renaming would have changed a public URL for purely cosmetic symmetry — the plural name was already established in copy and the extension's quick-switcher language; symmetry is about *structure* (both faces are first-class section routes), not literal spelling. Renaming a route for cosmetic symmetry is churn with no information-architecture value.

The header faceswitch changed from an asymmetric pair (one active face + root) to **two pills → `/human/` + `/agents/` with a 3-state active logic**: root shows no pill active; human/agent pages highlight their own pill. `baseof.html` gained a `face-overview` / `face-human` / `face-agents` body class hook, and CSS moved the enlarged carousel-hero sizing from `.is-home` to `.face-human`, adding `.face-overview` centered-copy styling plus `.doors` / `.door` / `.hero__scroll` styles (a later pass removed the dual-face visual partial and its `.hero__card--dual` / `.dual` CSS — the overview hero is text with a scroll key). Five new i18n keys (`hero_positioning_overview`, `sec_faces`, `sec_faces_sub`, `cta_overview_h2`, `cta_overview_p`) were added to **both** `zh.yaml` and `en.yaml` to preserve the key-parity invariant (83 keys each).

**The bug this run caught:** initial face detection used Hugo's `.Type` (`{{ if eq .Type "human" }}` / `{{ if eq .Type "agents" }}`) in `baseof.html` and `header.html`. On every page it fell through to `face-overview` — every page rendered `<body class="face-overview">`, and the header never highlighted a pill. Root cause: for an `index.md` **leaf bundle**, `.Type` does **not** match the section name; it resolves to the home page type. The fix switched to **path-based detection** via `.RelPermalink` (`strings.Contains .RelPermalink "/human"` / `"/agents"`) — the exact pattern the pre-existing `header.html` had used all along. Notably, Hugo still selected `layouts/agents/single.html` (and the new `layouts/human/single.html`) via section-based template lookup even though `.Type` was wrong, so the bug was invisible until the body-class logic consumed `.Type`. Lesson: **build and verify template assumptions** — the fixer assumed `.Type` semantics without running a build.

## Guidance

### 1. Neutral overview root, symmetric face routes

Give neither audience the root URL. Make `/` a *neutral overview* that sells the product as a whole and presents two equivalent doorways, then give each face its own section route with equal status. Both faces become section routes (`content/<face>/index.md`), each with its own layout under `layouts/<face>/single.html`. A future third face slots in as one more section + one more faceswitch pill + one more face class — the pattern scales without renegotiating the root.

### 2. Three-state faceswitch with `aria-current`

The switch is a nav of **links** (not buttons), mirroring the extension's quick-switcher pills. Track the current face, not the page: root highlights nothing, a face page highlights its pill.

```go
{{/* layouts/partials/header.html */}}
{{ $face := "overview" }}
{{ if strings.Contains .RelPermalink "/human" }}{{ $face = "human" }}{{ end }}
{{ if strings.Contains .RelPermalink "/agents" }}{{ $face = "agents" }}{{ end }}
<nav class="faceswitch" aria-label="{{ i18n "face_switch_label" }}">
  <a href="{{ "human/" | relLangURL }}" {{ if eq $face "human" }}aria-current="page"{{ end }}>
    <span class="sw-dot"></span>{{ i18n "nav_human" }}
  </a>
  <a href="{{ "agents/" | relLangURL }}" {{ if eq $face "agents" }}aria-current="page"{{ end }}>
    <span class="sw-dot"></span>{{ i18n "nav_agent" }}
  </a>
</nav>
```

### 3. Detect the face by path, not by `.Type`

**Never use `.Type` to detect which face/page you are on in a Hugo template.** For `index.md` leaf-bundle pages, `.Type` does not reflect the section name, and the value you get is not what section-based template lookup chose. Use the `.RelPermalink` substring pattern — it is literal, predictable, and language-proof (each language's pages keep the `/human` / `/agents` segment).

```go
{{/* layouts/_default/baseof.html — body class face hook */}}
{{ $face := "overview" }}
{{ if strings.Contains .RelPermalink "/human" }}{{ $face = "human" }}{{ end }}
{{ if strings.Contains .RelPermalink "/agents" }}{{ $face = "agents" }}{{ end }}
<body class="face-{{ $face }}">
```

Order matters when a face name is a prefix of another path segment; check the more specific / longer segment first if that ever becomes true. Keep the two detection blocks (baseof + header) identical so the body class and the faceswitch can never disagree.

### 4. Drive CSS sizing from the face class, not a page-specific class

The enlarged carousel-hero layout used to key off `.is-home` (root = human face). After the split, that class would have styled the wrong page. Rename the semantic: `.is-home` → `.face-human` (the enlarged hero now belongs to `/human/`), and add `.face-overview` for the overview's own copy-only sizing plus `.doors` / `.door` / `.hero__scroll` for the two-doorway section and its scroll affordance. The face class is the single hook; page-specific selectors are eliminated.

### 5. i18n parity for every new key

All five new keys (`hero_positioning_overview`, `sec_faces`, `sec_faces_sub`, `cta_overview_h2`, `cta_overview_p`) went into **both** `zh.yaml` and `en.yaml`. Hugo silently renders an empty string for a missing key — a key in one file only is a blank on the other language that survives the build. Parity is a load-bearing invariant; verify it after every i18n edit (the two files must hold identical key sets — currently 205 keys each).

### 6. Section-head correctness (matrix vs sources headings)

When reusing the shared `section-head.html` partial across new and old sections, pass the *right* i18n key per site. The overview page's capability matrix and sources wall both re-use the shared heading skeleton, but their eyebrow / title / sub keys must match their own section semantics — copying a key from the old page (e.g. reusing a human-face section heading on the overview matrix) produces wrong copy that reads as careless. One key per concept, per location.

## Why This Matters

**The root URL is the site's most valuable real estate.** Letting one audience own it biases the site's first impression and silently downgrades the other audience to a corner of the product. A neutral overview root says "this is one product with two audiences" instead of "this product is for humans, agents are an afterthought." The asymmetry was the *feeling* the user flagged ("这个网站的结构很怪"); the fix is structural, and the structure is now self-describing — `/` = overview, `/human/` = human face, `/agents/` = agent face.

**Symmetry vs extra click is a deliberate tradeoff.** Every audience now lands on `/` and takes one click to reach their face. That is acceptable and arguably better: the extra click is a *choice point*, and a neutral overview that shows both doorways teaches visitors that both audiences exist. The cost is only worth paying if the overview itself is strong enough to justify the click — hence the copy-only hero with its scroll affordance and the two-doorway section.

**Template assumptions must be verified against a build.** The `.Type` trap was entirely avoidable. The fixer wrote face detection from an assumption about Hugo's template data model, and because section-based *template lookup* still worked (Hugo found `layouts/human/single.html`), nothing looked broken until the body class silently degraded to `face-overview` on every page. `git grep` for the pre-existing pattern (`strings.Contains .RelPermalink`) would have revealed the correct approach immediately. Any time a new template consumes a Hugo data property for the first time, build the site and check the rendered output — do not infer from docs.

## When to Apply

- **Adding a third face** (e.g. a developer-docs face): create `content/<face>/index.md` + `layouts/<face>/single.html`, add one pill to the faceswitch, extend the baseof/header face blocks, add a `face-<name>` CSS branch. Never hand the new face the root.
- **Any Hugo route / face detection**: use `.RelPermalink` substring matching, never `.Type`, for `index.md` pages.
- **Any future website edit** touching `baseof.html`, `header.html`, `hero.html`, `section-head.html`, or `style.css` face rules: keep the two face-detection blocks in sync, keep the i18n key sets in parity, and rebuild to verify body classes on all routes.
- **Any site restructure that renames routes**: avoid renaming purely for symmetry — keep the public URL unless there is a real reason to change it.
- **Before reasoning about Hugo section semantics**: build and inspect rendered HTML rather than trusting `.Type` / template-lookup assumptions.

## Examples

### Face detection — before and after

**Before** (`baseof.html` — assumed `.Type`; never matches for `index.md` leaf bundles):
```go
{{ $face := "overview" }}
{{ if eq .Type "human" }}{{ $face = "human" }}{{ end }}
{{ if eq .Type "agents" }}{{ $face = "agents" }}{{ end }}
<body class="face-{{ $face }}">
```

Every page rendered `<body class="face-overview">` (root, human, and agents alike). The header pill highlight suffered the same silent failure. The bug was invisible to `hugo build` because layout selection worked: Hugo still resolved `layouts/human/single.html` / `layouts/agents/single.html` through section-based template lookup, so the correct *page* was served with the wrong *face metadata*.

**After** (`baseof.html` — path-based detection, matching the pattern the pre-existing `header.html` already used):
```go
{{ $face := "overview" }}
{{ if strings.Contains .RelPermalink "/human" }}{{ $face = "human" }}{{ end }}
{{ if strings.Contains .RelPermalink "/agents" }}{{ $face = "agents" }}{{ end }}
<body class="face-{{ $face }}">
```

Rebuilt, every page (zh + en) carries the correct class: root → `face-overview`, `/human/` → `face-human`, `/agents/` → `face-agents`.

### Neutral root — overview section flow

`content/_index.md`(+ en) renders the overview: copy-only hero (the dual-face thesis; the initial `hero-visual-overview.html` dual visual was removed in a later pass — the hero is text with a scroll key to the door cards), the two-doorway section (two `.door` cards → `/human/` + `/agents/`, each with face label + positioning text), dual-face capability matrix, bilingual showcase section, and a neutral CTA band; the sources icon wall now lives on `/human/`. `content/human/index.md`(+ en) is the new human-face route; `layouts/human/single.html` is a copy of the old `layouts/index.html` body so the human face keeps its enlarged carousel hero (now driven by `.face-human` instead of the removed `.is-home`).

### i18n parity

Five keys added to both files (zh + en): `hero_positioning_overview`, `sec_faces`, `sec_faces_sub`, `cta_overview_h2`, `cta_overview_p`. Key-set parity held at 83 keys each then (205 as of 2026-08-16 after the docs-hub guides); a key added to one language only would render as an empty string on the other.

## Related

- [`website-hugo-template-maintainability.md`](../architecture-patterns/website-hugo-template-maintainability.md) — partial extraction patterns and i18n unification that the dual-face templates build on (hero visual sub-partial slot, `section-head.html`, i18n key-parity rule).
- [`website-hugo-subpath-deployment.md`](../architecture-patterns/website-hugo-subpath-deployment.md) — overall website architecture and the GitHub Pages `/juso-search/` subpath deployment model.
- [`hugo-subpath-hardcoded-paths.md`](../integration-issues/hugo-subpath-hardcoded-paths.md) — why all paths go through Hugo's `relURL` / `relLangURL`; the rebuilt site verifies 0 hardcoded paths.
- [`website-drift-lock-enforcement.md`](../architecture-patterns/website-drift-lock-enforcement.md) — the drift-lock scripts (`check-website-tokens.py`, `check-website-assets.py`) used to verify this restructure.
- [`website-carousel-hero-screenshot-design.md`](../design-patterns/website-carousel-hero-screenshot-design.md) — the carousel hero visual used by the human face; since the copy-only-hero pass the overview root carries no carousel.
