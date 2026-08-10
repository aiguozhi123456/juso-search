---
title: "Website architecture and deployment: Hugo on GitHub Pages project subpath"
date: 2026-08-08
last_updated: 2026-08-10
category: architecture-patterns
module: website
problem_type: architecture_pattern
component: documentation
severity: medium
applies_when:
  - "Maintaining or extending the Juso showcase website"
  - "Adding pages, languages, or navigation to the site"
  - "Changing deployment target, base URL, or hosting configuration"
  - "Updating the shared design system that both the extension and the site consume"
tags: [hugo, github-pages, static-site, deployment, design-system, i18n, subpath]
---

# Website architecture and deployment: Hugo on GitHub Pages project subpath

## Context

Juso needed a showcase website for the Chrome extension. The site is a Hugo static site deployed to a **GitHub Pages project subpath** (`https://<user>.github.io/juso-search/`) and inherits its design system from the extension's own `tokens.css`. Both the architecture and the deployment model have non-obvious constraints that cost real debugging time when rediscovered independently. This document captures the structural knowledge so future maintainers don't re-derive it.

## Guidance

### Tooling and structure

- **Hugo v0.164 extended**, no theme — all layouts are custom under `layouts/`. The extended build is required for SCSS piping and image processing.
- **Bilingual via Hugo i18n**: Chinese at the root (`defaultContentLanguage = "zh"`), English under `/en/`. Content files use the `_index.md` / `_index.en.md` / `index.md` / `index.en.md` suffix convention; UI strings live in `i18n/zh.yaml` and `i18n/en.yaml` (keep the two key sets identical).
- **Data-driven content**: structured content (capability matrices, source icon grids, CLI examples, security fact lists) lives in `data/*.yaml` and is consumed by partials. This keeps prose in markdown and structured lists in data files.
- **Partials for reuse**: `partials/header.html`, `partials/footer.html`, and section partials (`capability-matrix.html`, `cli.html`, `icon-wall.html`, etc.) are the reuse layer. Three surfaces share one skeleton via `layouts/_default/baseof.html` + `layouts/index.html` (neutral overview) / `layouts/human/single.html` (human face) / `layouts/agents/single.html` (agent face).

### Design-system inheritance

The website does not define its own visual language from scratch — it inherits the extension's:

- **Signature color**: cinnabar red `#c8372d` (light) / `#ff6b5b` (dark), defined in `entrypoints/shared/tokens.css`.
- **Typography**: Fraunces (display/headings), Hanken Grotesk (body/UI), JetBrains Mono (code). Self-hosted as woff2 under `static/fonts/` (no Google Fonts CDN, to match the extension's privacy stance).
- **Light/dark**: follows `prefers-color-scheme`; CLI blocks stay dark in both modes.
- **Spatial language**: the same "Takram × Experimental Jetset" anchors (rounded function, strong type, geometric blocks) that the extension uses.

When the extension's `tokens.css` changes, a CI drift-lock (`scripts/check-website-tokens.py`) now catches whether the site's CSS variables need the same change — it asserts a must-match token set (brand colors, neutrals, durations) is value-identical across both files and fails the build on drift. Intentional divergences (fonts, shadows, site-only tokens) are documented and allowed. See [`website-drift-lock-enforcement.md`](./website-drift-lock-enforcement.md).

### Deployment

- **Target**: GitHub Pages **project** site (not user/org site), served under `/juso-search/`.
- **Mechanism**: GitHub Actions (`.github/workflows/website-pages.yml`) — `peaceiris/actions-hugo` builds, `actions/deploy-pages` deploys. Triggered on pushes to `main` that touch `website/**` (plus `workflow_dispatch`).
- **baseURL handling**: baseURL is set in `website/hugo.toml` (not a CI `--baseURL` flag). This only rewrites URLs generated through Hugo's URL functions — `relURL`, `absURL`, `relLangURL`, `.Permalink`, `.RelPermalink`. **Hardcoded strings in templates are NOT rewritten.** Use the functions exclusively:
  - Static resources (images, fonts, CSS, icons) → `relURL`
  - Open Graph / social images → `absURL` (OG requires absolute URLs)
  - Internal navigation → `relLangURL` (baseURL-aware and language-aware)
- **Action versions pinned to commit SHA** (supply-chain hygiene), with version comments.

### Verification

A subpath deploy can build green while serving a broken site. Verify at the **resource level**, not just the document level:

1. Build with the real baseURL: `hugo --source website --baseURL https://<user>.github.io/juso-search/ --minify`.
2. Grep the output HTML for `src="/` or `href="/` — any match is a hardcoded path that will break on the subpath.
3. Fetch the deployed HTML, extract the actual `src=`/`href=` values, and fetch *those* URLs. A page returning 200 tells you nothing about whether its images, CSS, fonts, and internal links resolve correctly.
4. `hugo server --baseURL /juso-search/ --port 1313` lets you smoke-test the subpath locally before deploying.

## Why This Matters

Without this knowledge, the two failure modes that recur are:

1. **Subpath breakage** — hardcoded paths that pass local `hugo server` (baseURL `/`) but 404 or jump domains on the real subpath. Caught only by resource-level verification. See the concrete incident: [hugo-subpath-hardcoded-paths](integration-issues/hugo-subpath-hardcoded-paths.md).
2. **Design drift** — the site and extension slowly diverge visually because the inheritance is manual, not automated. **Now caught by CI:** `check-website-tokens.py` asserts the must-match token set stays value-identical; see [`website-drift-lock-enforcement.md`](./website-drift-lock-enforcement.md).

Both are invisible to the build and only show up on the live site.

## When to Apply

- Adding a new page or section → reuse the existing skeleton (baseof + single/home layout) and the data/partial pattern.
- Adding a language → add `i18n/<lang>.yaml` with the same key set, add `languages.<lang>` to `hugo.toml`, add `content/**.<lang>.md` files.
- Changing the deployment target or base URL → re-run the resource-level verification; hardcoded paths will silently break.
- Updating the extension's `tokens.css` → the CI drift-lock (`check-website-tokens.py`) catches whether the site's CSS variables need the same change; reconcile the must-match set and the build goes green.

## Examples

- The site's three surfaces (`/`, `/human/`, `/agents/`) share one skeleton but swap content via `layouts/index.html` (neutral overview) vs `layouts/human/single.html` (human face) vs `layouts/agents/single.html` (agent face), all backed by `layouts/_default/baseof.html`.
- The source icon grid (`partials/icon-wall.html`) reads `data/sources.yaml` and computes counts via `len .items` rather than a hand-written `count` field — add an icon by adding a row to the yaml, no template change.
- The subpath bug (images 404, nav jumping to the blog root) was fixed by replacing every hardcoded `/path` with the appropriate Hugo URL function — see [hugo-subpath-hardcoded-paths](integration-issues/hugo-subpath-hardcoded-paths.md).

## Related

- [`website-drift-lock-enforcement.md`](./website-drift-lock-enforcement.md) — the CI drift-locks that now enforce the design-system inheritance (closes the manual-sync gap noted above).
- [hugo-subpath-hardcoded-paths](integration-issues/hugo-subpath-hardcoded-paths.md) — the concrete subpath incident that this architecture knowledge would have prevented.
- `entrypoints/shared/tokens.css` — the design-system source the site inherits.
- `.github/workflows/website-pages.yml` — the deployment mechanism.
