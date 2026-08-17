---
title: "Website drift-lock enforcement: CI tests that catch manual-sync drift across the site↔extension boundary"
date: 2026-08-10
last_updated: 2026-08-17
category: architecture-patterns
module: website
problem_type: architecture_pattern
component: documentation
severity: medium
applies_when:
  - "Maintaining the Juso website's design-system inheritance from the extension (tokens.css, icons, screenshots)"
  - "Adding or changing a manually-copied asset or token set that has a counterpart elsewhere in the repo"
  - "Deciding whether to lock a manual copy with a drift test vs. generate it from a single source"
  - "Extending the website's i18n system or adding a new bilingual data file"
tags: [website, hugo, drift-lock, design-system, i18n, ci, single-source, manual-sync, tokens]
---

# Website drift-lock enforcement: CI tests that catch manual-sync drift across the site↔extension boundary

## Context

The Juso marketing website (`website/`) is a Hugo static site that "inherits" its design system from the Chrome extension — but the inheritance is manual. Three channels copy values from the extension (or other repo locations) into the site by hand:

1. **CSS design tokens** — `website/assets/css/style.css` hand-copies a subset of `entrypoints/shared/tokens.css` (brand colors, neutrals, shadows, durations).
2. **Brand icons** — `website/static/icons/*.svg` are byte-identical copies of `public/icons/*.svg` (23 files as of 2026-08-15 — `parallel.svg` and `weixin.svg` joined after the lock was created; both sets tracked in git).
3. **Screenshots** — `website/static/img/screenshot-*.png` are copies of `docs/assets/screens/*.png` (4 files; `static/img/README.md` is the mapping contract).

A fourth channel — the i18n boundary between Hugo's `{{ i18n "key" }}` (UI strings) and data-file `*_zh`/`*_en` field pairs (structured content) — relied on human judgment to decide which mechanism each new string belonged in, with no enforcement.

All four shared the same root cause: **manual sync without enforcement**. A green `hugo --minify` build says nothing about whether the copies still match their sources. The tokens had already drifted (`--muted` `#5f5f5f` vs `#666`; `--border` `#e6e3e0` vs `#e3e3e3`; dark `--bg` `#131313` vs `#1a1a1a`; duration tokens even had different names — `--dur` vs `--duration-normal`). The i18n boundary had leaked six hardcoded literals (`"Juso"`, `"中"`, `"EN"`) into templates alongside a full i18n system. And `hero-visual-agent.html` hardcoded two CLI commands that already lived in `data/cli.yaml`.

## Guidance

The fix pattern is consistent across all four channels: **reconcile the drifted state, then add a drift-lock test that fails CI on the next divergence.** This matches the project's existing `juso_bridge` drift-lock convention (see `agent-skill-distribution-pipeline.md`) — but applied to the website's manual copies, which cannot be runtime-discovered the way the skill pipeline's generated copies can.

### 1. Reconcile first, then lock

Before adding a drift-lock, bring the copies back into sync with their source of truth. A drift-lock that starts red is useless. For the website:

- **Tokens**: reconciled `--muted`, `--border`, dark `--bg`/`--bg-soft`/`--fg`/`--muted`/`--border` in `style.css` to match `tokens.css`. Renamed `--dur-fast`/`--dur`/`--dur-slow` → `--duration-fast`/`--duration-normal`/`--duration-slow` for name parity, and reconciled values (`200ms`→`180ms`, `320ms`→`280ms`).
- **i18n literals**: added three i18n keys (`brand_latin`, `lang_short_zh`, `lang_short_en`) to both YAML files; replaced the six hardcoded literals in `header.html`/`footer.html` with `{{ i18n "..." }}`. Normalized `sources.yaml` from `name`/`name_en` to `name_zh`/`name_en` so it routes through `i18n-field.html` like every other data file.
- **Content**: `hero-visual-agent.html` now `range`s over `first 2` items of `data/cli.yaml` instead of hardcoding the commands.

### 2. Lock with a CI equality test

Two scripts, both Python (matching `scripts/gen_skills.py`'s style), wired into `.github/workflows/website-pages.yml` before the Hugo build:

**`scripts/check-website-tokens.py`** — value-equality lock. Parses `:root` (light) and the first `@media (prefers-color-scheme: dark)` block from both `style.css` and `tokens.css`, and asserts a **must-match** token set is value-identical: brand colors (`--brand`, `--brand-soft`, `--brand-softer`, `--brand-on`), neutrals (`--bg`, `--bg-soft`, `--fg`, `--muted`, `--border`), and durations (`--duration-fast`/`normal`/`slow`). Exits 0 if matched, 1 with a per-token diff if drifted.

**`scripts/check-website-assets.py`** — byte-equality lock. SHA256-compares `website/static/icons/*.svg` ↔ `public/icons/*.svg` (21 pairs) and `website/static/img/screenshot-*.png` ↔ `docs/assets/screens/*.png` (4 pairs, per `static/img/README.md`'s mapping table). Exits 0 if all pairs byte-identical, 1 with the drifted filename if not.

### 3. Split must-match from intentional divergence

Not every difference between `style.css` and `tokens.css` is drift. The token drift-lock explicitly **allows** three intentional divergences to differ without failing:

- **Fonts**: the site self-hosts Fraunces / Hanken Grotesk / JetBrains Mono woff2 (latin subsets) for distinctive marketing typography; the extension uses system CJK stacks. Intentional.
- **Shadows**: the site uses larger/softer shadows (`0 6px 20px`, `0 18px 48px`) for marketing feel vs the extension's tighter values. Intentional.
- **Site-only tokens** (`--brand-ink`, `--faint`, `--bg-sunk`, `--maxw`, `--gut`): legitimate site additions with no extension counterpart.

The must-match set is the system tokens (colors that should be identical across both surfaces, durations that should be consistent). The intentional-divergence set is documented in a comment block at the top of `style.css`'s `:root` and in the drift-lock script's docstring. **A drift-lock without this split will either miss real drift (too lenient) or cry wolf on every intentional difference (too strict).**

### 4. Codify the i18n A/B boundary rule

The two i18n mechanisms are architecturally correct and should not be collapsed: Hugo's `{{ i18n "key" }}` returns a single string and cannot hold structured records with HTML or lists. The rule (codified in `website-hugo-template-maintainability.md` §5):

- **Atomic UI string** → i18n key in both `zh.yaml` and `en.yaml` (keep key sets identical — Hugo silently renders empty for a missing key).
- **Structured record with fields** → data file with `*_zh`/`*_en` pairs, resolved via `partials/i18n-field.html`.
- **Brand wordmark and decorative glyphs** (`双面搜`+`Juso`, `人`/`智` matrix numerals, `juso-search`/`bash` terminal labels) → accepted constants, documented, not i18n keys.

The load-bearing invariant is **key-set parity** between `zh.yaml` and `en.yaml`. A key present in one but not the other produces a blank on the missing side that nobody notices until a user reports it.

## Why This Matters

Without drift-locks, the three manual-copy channels drift silently. The build stays green. The site looks slightly wrong in dark mode, or an icon goes stale, or a screenshot shows an old UI — and nobody notices until a user reports it. The `website-hugo-subpath-deployment.md` doc explicitly admitted this (line 41: "the site is not automatically in sync — update the site's CSS variables to match") and listed "design drift" as failure mode #2, but its prevention was a manual checklist that relied on a human remembering to check. **A manual checklist is not enforcement.** A CI test that turns red is enforcement.

The "lock the copy" pattern is the right choice for the website because the copies (CSS values, marketing assets) cannot be runtime-discovered — they are consumed by Hugo's build pipeline, not by a running process. This contrasts with the `agent-skill-distribution-pipeline.md` pattern, which collapses the copy into a single template + generator so drift is impossible by construction ("generate the copy"). The website chose "lock" because generation would require restructuring Hugo's asset pipeline for a small marketing site — disproportionate. **Lock when the copy can't be generated; generate when it can.**

## When to Apply

- **Adding a new manually-copied asset or token** that has a counterpart elsewhere in the repo → add a byte-equality (binary assets) or value-equality (text values) pair to the relevant drift-lock script.
- **The showcase image channel** — `website/static/img/showcase/*.png` (bilingual zh-light/en-dark frames, added 2026-08-16, sourced from `docs/assets/showcase/` per the same README) is a manual copy not yet covered by `check-website-assets.py`; add a pair list when locking it.
- **Changing `entrypoints/shared/tokens.css`** → the CI now triggers on that path; the drift-lock will catch whether `style.css` needs the same change.
- **Adding a user-facing string to the website** → apply the i18n A/B boundary rule (atomic → i18n key; structured → data file). Verify key-set parity after.
- **Deciding lock vs. generate for a new manual-sync channel** → if the copy is consumed at build time by a static pipeline (Hugo, bundler), lock it. If the copy is consumed at runtime by a process that could read the source directly, generate it (or remove the copy via runtime discovery — see `skill-mcp-vocabulary-decoupling.md`).
- **A drift-lock is crying wolf** → check whether the divergence is intentional. If so, move the token/asset from the must-match set to the documented intentional-divergence set, don't weaken the lock.

## Examples

### Token drift-lock — must-match vs intentional divergence

`scripts/check-website-tokens.py` extracts custom properties from both files and asserts the must-match set:

```python
# Must match across style.css and tokens.css (system tokens)
MUST_MATCH_LIGHT = {
    "--brand", "--brand-soft", "--brand-softer", "--brand-on",
    "--bg", "--bg-soft", "--fg", "--muted", "--border",
    "--duration-fast", "--duration-normal", "--duration-slow",
}
# Intentional divergences — allowed to differ without failing
INTENTIONAL = {
    "--font-display", "--font-sans", "--font-mono",  # site self-hosts, ext uses system
    "--shadow-2", "--shadow-3",                      # site larger/softer for marketing
    "--brand-ink", "--faint", "--bg-sunk", "--maxw", "--gut",  # site-only
}
```

When `--muted` drifted (`#5f5f5f` vs `#666`), the script reported:
```
light --muted: website '#5f5f5f' != extension '#666'
```
After reconciliation, it passes: `must-match tokens in sync (light + dark); intentional divergences allowed.`

### i18n boundary rule — which mechanism gets the string

```go
{{/* Atomic UI string → i18n key (both YAML files, identical key sets) */}}
<a href="{{ "agents/" | relLangURL }}">{{ i18n "nav_agent" }}</a>

{{/* Structured record → data file with *_zh/*_en, resolved via i18n-field.html */}}
{{ $title := partial "i18n-field.html" (dict "obj" . "field" "title" "lang" $lang) }}

{{/* Brand wordmark → documented constant, NOT an i18n key */}}
<h1 class="wordmark">双面搜<span class="wordmark__latin">Juso</span></h1>
```

### Content dedup — read from the single source, don't hardcode

```go
{{/* Before: 2 CLI commands hardcoded in the partial */}}
<pre><span class="prompt">$</span> juso-search list-providers</pre>

{{/* After: range over the first 2 items of data/cli.yaml */}}
{{ range $i, $item := first 2 hugo.Data.cli.items }}
  {{ $title := partial "i18n-field.html" (dict "obj" $item "field" "title" "lang" $.Page.Site.Language.Lang) }}
  <pre># {{ $title }}
{{ $item.html | safeHTML }}</pre>
{{ end }}
```

## Related

- [`website-hugo-template-maintainability.md`](./website-hugo-template-maintainability.md) — canonical home of the i18n A/B boundary rule (§5). This doc is the enforcement arm; that doc is the structural-extraction arm.
- [`website-hugo-subpath-deployment.md`](./website-hugo-subpath-deployment.md) — admitted the manual-sync gap (line 41, failure mode #2). The drift-locks close it.
- [`agent-skill-distribution-pipeline.md`](./agent-skill-distribution-pipeline.md) — the `juso_bridge` drift-lock pattern this learning reuses. That pipeline *generates* the copy (drift impossible by construction); the website *locks* the copy (drift caught by CI).
- [`single-source-product-versioning.md`](../best-practices/single-source-product-versioning.md) — same drift-gate family; the token value-equality lock is the closest sibling to its version-string gate test.
- [`skill-mcp-vocabulary-decoupling.md`](./skill-mcp-vocabulary-decoupling.md) — the alternative "remove the copy via runtime discovery" strategy; the website chose "lock" because CSS values/assets can't be runtime-discovered.
