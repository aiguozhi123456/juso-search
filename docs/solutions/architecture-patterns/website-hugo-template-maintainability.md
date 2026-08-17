---
title: "Website Hugo template maintainability: partial extraction patterns and i18n unification"
date: 2026-08-08
last_updated: 2026-08-17
category: architecture-patterns
module: website
problem_type: architecture_pattern
component: documentation
severity: medium
applies_when:
  - "Maintaining or extending the bilingual Hugo website templates (index.html, agents/single.html)"
  - "Adding a third page variant that shares the hero / CTA / section-head skeleton"
  - "When template duplication between the human-face and agent-face pages risks drift"
  - "When inline styles or hardcoded bilingual strings bypass the design-token or i18n systems"
tags: [hugo, template, partials, i18n, maintainability, inline-styles, css-tokens, sub-partial]
---

# Website Hugo template maintainability: partial extraction patterns and i18n unification

## Context

The Juso marketing site has six surfaces sharing one skeleton — a neutral overview (`layouts/index.html`), the two face pages (`layouts/human/single.html`, `layouts/agents/single.html`), and the docs guides (`layouts/docs/list.html`, `layouts/human-docs/single.html`, `layouts/agents-docs/single.html`) — that share ~80% of their structure: identical hero skeletons, identical CTA bands, and a repeated ~5-line section-head block appearing across all three templates. A maintainability audit found that this duplication, plus scattered inline styles and hardcoded bilingual strings, made every template edit a "remember to change both files" exercise. The hero was the worst offender: ~45 lines of near-identical markup in each template, differing only in one visual region (a carousel vs. a CLI demo block).

This document captures the five structural patterns applied in the refactor (commit `377fd27`) so the next maintainer evolves the templates safely instead of re-deriving the approach.

**Companion doc:** [`website-hugo-subpath-deployment.md`](./website-hugo-subpath-deployment.md) covers the site's overall architecture, deployment model, and design-system inheritance. This doc zooms in on how to keep the template layer maintainable as it evolves.

## Guidance

### 1. Visual sub-partial slot — partial-of-partials

When two page variants share a layout skeleton but differ in one content region, extract the skeleton into a partial and pass the variant region's **partial name** as a string parameter. Hugo resolves `{{ partial .visual . }}` dynamically.

**`layouts/partials/hero.html`** — the shared skeleton:
```go
{{- $p := .Page -}}
{{- $isEn := eq $p.Site.Language.Lang "en" -}}
<section class="hero">
  <div class="wrap hero__inner">
    <div class="hero__copy">
      <div class="eyebrow hero__eyebrow reveal-load d1"><span class="dot"></span>{{ i18n "hero_eyebrow" }}</div>
      <h1 class="wordmark reveal-load d2">双面搜<span class="wordmark__latin">Juso</span></h1>
      <!-- ...tagline, positioning, CTA — parameterized via dict fields... -->
    </div>
    <div class="hero__visual reveal-load d6 crop-frame">
      <span class="crop-bl"></span><span class="crop-br"></span>
      {{ partial .visual . }}   {{/* ← sub-partial slot: "hero-visual-home" | "hero-visual-agent"（视觉可选，中性总览页不传 visual） */}}
    </div>
  </div>
</section>
```

**Call site** (human/single.html — the human face; the neutral overview `index.html` is a third call site that passes **no visual** — copy-only hero with a `scroll_target` param instead):
```go
{{ partial "hero.html" (dict "Page" . "tagline_zh" (i18n "tagline_zh") "tagline_en" (i18n "tagline_en")
  "positioning_key" "hero_positioning_human" "cta_primary_key" "cta_cws"
  "cta_primary_href" .Site.Params.cwsURL "cta_ghost_key" "cta_release"
  "cta_ghost_href" .Site.Params.releaseURL "visual" "hero-visual-home") }}
```

The variant content lives in `partials/hero-visual-home.html` (carousel) and `partials/hero-visual-agent.html` (CLI block). A visual is optional: the neutral overview (`index.html`) passes no `visual` at all and instead passes `scroll_target` — the shared skeleton renders a copy-only hero with a scroll key, zero edits to the skeleton. Each face adds at most one visual partial and one call site — zero edits to the shared skeleton.

**Critical:** preserve every CSS class, every `reveal-load dN` delay number, every ARIA attribute when extracting. The partial must produce byte-identical output (modulo whitespace). Hugo's `--minify` collapses whitespace, so indentation differences are harmless; structural/class differences are not.

### 2. Value-returning partial — DRY bilingual field selection

Every data-driven partial repeated this 2-line pattern for each bilingual field:

```go
{{ $title := .title_zh }}{{ if eq $lang "en" }}{{ $title = .title_en }}{{ end }}
```

14 occurrences across 7 partials. Extract into a value-returning partial:

**`layouts/partials/i18n-field.html`:**
```go
{{- $obj := .obj -}}{{- $field := .field -}}{{- $lang := .lang -}}
{{- $val := index $obj (printf "%s_zh" $field) -}}
{{- if eq $lang "en" -}}{{- $val = index $obj (printf "%s_en" $field) -}}{{- end -}}
{{- return $val -}}
```

**Call site:**
```go
{{ $title := partial "i18n-field.html" (dict "obj" . "field" "title" "lang" $lang) }}
```

Hugo's `{{ return }}` makes a partial usable as a function in any template expression. The `printf "%s_zh"` indirection lets one partial serve all field names (title, desc, body, name).

### 3. Pre-resolved-string partials — flexible section heads

The section-head block appeared ~10 times. Most used a single i18n key per field, but one used a composite expression (`{{ i18n "face_human" }} · {{ i18n "face_agent" }}`). Passing i18n *keys* to the partial would not handle the composite case.

**Solution:** the partial takes pre-resolved *string values*, not keys. Each call site resolves its own i18n:

```go
{{/* Simple case */}}
{{ partial "section-head.html" (dict
  "eyebrow" (i18n "sec_sources")
  "title"   (i18n "sec_sources")
  "sub"     (i18n "sec_sources_sub")) }}

{{/* Composite case — works uniformly */}}
{{ partial "section-head.html" (dict
  "eyebrow" (printf "%s · %s" (i18n "face_human") (i18n "face_agent"))
  "title"   (printf "%s — %s" (i18n "nav_human") (i18n "nav_agent"))
  "sub"     (i18n "hero_positioning_human")) }}
```

### 4. Inline styles → CSS classes (always)

Inline `style=` attributes cannot be overridden by media queries, cannot be themed, and do not respond to dark-mode token changes. Every inline style was extracted to a class:

| Inline style | Replacement class | Where defined |
|---|---|---|
| `style="border-radius:0;border:none;box-shadow:none;"` (CLI block inside hero card) | `.hero__card .cli__block` (scoped rule) | `style.css` near `.cli__block` |
| `style="grid-template-columns:1fr;"` (agent trust section) | `.trust--single` (BEM modifier) | `style.css` near `.trust` |
| `style="color:var(--faint);font-size:.78rem;"` (showcase note) | `.shot__note` | `style.css` near `.shot__cap` |
| 5 inline styles on the 404 page | `.not-found` | `style.css`, new section |

**Convention:** layout overrides use BEM modifiers (`.trust--single`). Component-scoped overrides use descendant selectors (`.hero__card .cli__block`). Standalone styles get their own class (`.not-found`).

### 5. One i18n key per concept

Hardcoded bilingual strings (`{{ if $isEn }}Dual-face architecture{{ else }}双面架构{{ end }}`) are invisible to translation audits and create ambiguity. The worst case: the same concept had two different English strings in two places ("Dual-face architecture" vs "Two-sided architecture").

**Rule:** every user-facing string goes through an i18n key. One key per concept. Add paired keys to both `i18n/zh.yaml` and `i18n/en.yaml` — the two files must have identical key sets (currently 205 keys each).

```go
{{/* Before — inconsistent, unsearchable */}}
alt="{{ if $isEn }}Dual-face architecture{{ else }}双面架构{{ end }}"
<b>{{ if $isEn }}Two-sided architecture{{ else }}双面架构{{ end }}</b>

{{/* After — one key, consistent everywhere */}}
alt="{{ i18n "cap_architecture" }}"
<b>{{ i18n "cap_architecture" }}</b>
```

#### Boundary rules — atomic strings vs. structured records vs. brand constants

- **Atomic UI string** → i18n key, added to **both** `i18n/zh.yaml` and `i18n/en.yaml`; the two files must keep identical key sets (Hugo silently renders an empty string for a missing key).
- **Structured record with fields** → data file with `*_zh` / `*_en` pairs, resolved via `partials/i18n-field.html`.
- **Brand wordmark** (`双面搜`+`Juso` in `hero.html`) and **decorative glyphs** (`人`/`智` matrix numerals in `capability-matrix.html`; `juso-search`/`bash` terminal labels in `hero-visual-agent.html`) → accepted constants, documented here, **not** i18n keys.
- **Note:** `data/sources.yaml` was normalized from `name`/`name_en` to `name_zh`/`name_en` to match the convention and route through `i18n-field.html`.

## Why This Matters

**Drift is the #1 maintainability risk** in a multi-face template system. When a bug fix in the hero markup (say, adding an ARIA attribute) must be applied to two 45-line copy-pasted sections, one will be forgotten. Partial extraction makes the shared skeleton a single source of truth — the variant region is the only thing that differs.

The carousel's `visibilitychange` listener illustrates a subtler drift: it was added inside a `roots.forEach` loop, leaking one `document` listener per carousel instance. With one carousel it was harmless; a second carousel would have caused confusing timer conflicts. Hoisting it outside the loop prevents the class of bug entirely.

**i18n key parity** (both YAML files must have identical key sets) is the other load-bearing invariant. Hugo silently renders an empty string for a missing key — no build error, no warning. A key present in `en.yaml` but absent from `zh.yaml` produces a blank on the Chinese page that nobody notices until a user reports it.

## When to Apply

- **Adding a third page variant** (e.g., a developer docs face): create one new visual sub-partial and call the existing `hero.html` / `cta-band.html` / `section-head.html` partials. Do not copy-paste the skeleton.
- **Adding a new bilingual data field** to a YAML data file: use the `i18n-field.html` partial instead of inline `_zh`/`_en` ternaries.
- **Adding any inline `style=`**: stop. Extract a CSS class. Inline styles break theming and responsiveness.
- **Adding any user-facing string**: add it as an i18n key in both YAML files. Verify key-set parity with a diff of key names.
- **Adding a second carousel** (or any `[data-carousel]` instance): the single hoisted `visibilitychange` listener already handles all instances. Do not add per-instance document listeners.

## Examples

### Hero partial extraction — before and after

**Before** (`index.html`, 47 lines of hero):
```go
<section class="hero">
  <div class="wrap hero__inner">
    <div class="hero__copy">
      <!-- ...45 lines of eyebrow, h1, tagline, positioning, CTA... -->
    </div>
    <div class="hero__visual reveal-load d6 crop-frame">
      <span class="crop-bl"></span><span class="crop-br"></span>
      <!-- ...carousel markup, ~20 lines... -->
    </div>
  </div>
</section>
```

The same structure existed in `agents/single.html` with only the visual block different (CLI demo instead of carousel).

**After** — `index.html` becomes a 10-line partial call, `agents/single.html` becomes a parallel call with different args. The 45-line skeleton lives once in `partials/hero.html`. The visual variants live in `partials/hero-visual-home.html` and `partials/hero-visual-agent.html`.

### File inventory after refactor

New partials created:
- `partials/hero.html` — shared hero skeleton with visual sub-partial slot
- `partials/hero-visual-home.html` — carousel visual variant
- `partials/hero-visual-agent.html` — CLI demo visual variant
- `partials/cta-band.html` — shared CTA band
- `partials/section-head.html` — shared section heading block
- `partials/i18n-field.html` — value-returning bilingual field resolver

Result: `index.html` went from 211 lines to 56; `agents/single.html` from 111 to 62. The reduction is all duplicated skeleton, not content. In the symmetric-IA restructure the human-face body moved from `layouts/index.html` into `layouts/human/single.html` (a copy of the old body), and `layouts/index.html` became the neutral overview.

## Related

- [`website-hugo-subpath-deployment.md`](./website-hugo-subpath-deployment.md) — overall website architecture, deployment model, design-system inheritance. This doc extends it with template-level maintainability patterns.
- [`hugo-subpath-hardcoded-paths.md`](../integration-issues/hugo-subpath-hardcoded-paths.md) — why all template paths must go through Hugo's `relURL` / `relLangURL` (the baseURL consolidation in this refactor moved the production URL from a CI `--baseURL` flag into `hugo.toml`, so local dev and production resolve paths consistently).
