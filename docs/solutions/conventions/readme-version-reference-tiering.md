---
title: "Tier README version references by drift risk"
date: 2026-08-10
category: conventions
module: "docs / README"
problem_type: convention
component: documentation
severity: low
applies_when:
  - "A README links to a versioned release artifact (GitHub Release tag, version-stamped asset filename)"
  - "The same version number is hardcoded in download links across more than one README language"
  - "A release bump leaves stale version-specific links pointing at the old tag"
tags: ["versioning", "readme", "release-links", "drift", "maintenance", "github-release"]
---

# Tier README version references by drift risk

## Context

This repo ships two READMEs (`README.md` in Chinese, `README.en.md` in English), and both carry install instructions that reference the current release. The install section hardcoded the version in three places per file: the section heading (`从 GitHub Release 安装（v1.4.0）`), the download link (`releases/tag/v1.4.0`), and the asset filename (`juso-search-1.4.0-chrome-dev.zip`). Every release bump meant editing six strings across two files, and a forgotten edit left users clicking into an old tag — or, once the tag is eventually deleted, a 404. The drift is invisible to CI: link checkers pass while the tag still resolves, and nothing asserts the README version matches `package.json`.

The neighboring `website/` tree had already solved the same problem a different way: `hugo.toml` defines `releaseURL = ".../releases/latest"` once and every page reads the variable, so no page text carries a version number at all. The READMEs had no equivalent indirection.

## Guidance

**Tier version references by drift risk.** Not every version mention drifts at the same rate or carries the same signal, so they should not all be treated the same way. Sort references into four tiers and handle each tier differently:

| Tier | Example | Treatment | Why |
|------|---------|-----------|-----|
| Download / Release **links** | `releases/tag/v1.4.0` | Abstract to `releases/latest` | Highest drift risk; a stale link sends users to the wrong version or 404s. `releases/latest` auto-redirects to the newest tag, zero maintenance. |
| Version-stamped **filenames** | `juso-search-1.4.0-chrome-dev.zip` | Wildcard the version (`juso-search-*-chrome-dev.zip`) | The version in the filename is redundant — the `latest` page already shows it. A wildcard tells the user "match this prefix" and never drifts. |
| Inline **status** line | `Juso v1.4.0 已发布` | Keep specific, one occurrence | Carries real signal ("you are on / looking at this version"). Only one place to update per release; the cost is lower than the lost signal from abstracting it. |
| **Historical** narrative | `自 v1.0.0 发布后改名` | Keep specific, never abstract | This is a factual record of when something happened, not a statement of current state. Abstracting it erases the fact. |

The decision rule: **if a reference would have to change on every release, abstract it (link, filename); if it carries state or records a fact, keep it specific and accept the one-line edit (status line, history).** The goal is not "remove all version numbers" — it is "make the remaining version numbers few enough and stable enough that the next bump cannot miss one that matters."

For the link tier specifically, prefer `releases/latest` over any per-release `releases/tag/vX.Y.Z`. GitHub redirects `releases/latest` to the newest non-prerelease tag, so the link is correct the moment a release is published with no doc edit at all. This is the single highest-leverage change.

When a README is bilingual, the abstracted link and wildcard filename are identical across both languages — only the surrounding prose differs — so the drift surface collapses to the one status line per language.

## Why This Matters

A version-specific download link is a load-bearing assumption that someone will remember to update on every release, in every language, with no CI signal when they forget. `releases/latest` makes the failure mode impossible rather than merely unlikely — the same first-principles move as collapsing hardcoded version sources in build config (see Related), applied to the doc surface.

Keeping the status line specific preserves information the abstracted link cannot provide: a reader scanning the README learns "the project is currently at 1.4.0" without clicking through to GitHub. Abstracting *that* to "the latest version" trades a one-line-per-release edit for a permanent loss of inline signal — a bad trade. The tiering is what prevents the over-correction where a blanket "remove all version numbers" rule deletes the useful ones along with the drift-prone ones.

The bilingual dimension doubles the drift surface: six hardcoded strings (three per language) become two status lines (one per language) after tiering. The link and filename tiers become language-independent, so a release bump touches only the status lines.

## When to Apply

- A README or install doc links to a versioned release artifact (GitHub Release tag, versioned asset filename, versioned docs URL).
- The same version string is hardcoded in download instructions across more than one file or language.
- A release process has ever left a stale `releases/tag/vX.Y.Z` link in a README.

You may **not** need this when:

- The doc links to a single canonical artifact that never moves (e.g., a `releases/latest` variable already indirections the link, as `website/hugo.toml` does).
- The version genuinely never changes (a one-off doc for a frozen release).

## Examples

### Before: six hardcoded version strings, drift-prone

```markdown
<!-- README.md -->
**从 GitHub Release 安装（v1.4.0）**
1. 从 [GitHub Release v1.4.0](https://github.com/aiguozhi123456/juso-search/releases/tag/v1.4.0) 下载 `juso-search-1.4.0-chrome-dev.zip`。

<!-- README.en.md -->
**From GitHub Release (v1.4.0)**
1. Download `juso-search-1.4.0-chrome-dev.zip` from the [GitHub Release v1.4.0](https://github.com/aiguozhi123456/juso-search/releases/tag/v1.4.0).
```

### After: link and filename abstracted, status line kept

```markdown
<!-- README.md -->
**从 GitHub Release 安装**
1. 从 [GitHub Release 最新版](https://github.com/aiguozhi123456/juso-search/releases/latest) 下载 `juso-search-*-chrome-dev.zip`。

<!-- README.en.md -->
**From GitHub Release**
1. Download `juso-search-*-chrome-dev.zip` from the [latest GitHub Release](https://github.com/aiguozhi123456/juso-search/releases/latest).
```

Kept specific (not abstracted):

```markdown
<!-- README.md:71 — status line, one occurrence per language -->
Juso v2.0.0 已在 GitHub Release 与 Chrome Web Store 发布。

<!-- README.md:166 — historical fact, never abstract -->
自 2026-07-23（v1.0.0 发布后）起，中文名改为「双面搜」…
```

### Verification

After the change, `grep -E 'releases/tag/v|juso-search-[0-9]+\.[0-9]+\.[0-9]+' README*.md` returns nothing — no version-specific release link or version-stamped filename remains in either README. The only surviving version mentions are the status line (line 71) and the historical narrative (line 166), both intentional. The `website/` tree needed no change — `hugo.toml` already used `releases/latest`.

## Related

- ../best-practices/single-source-product-versioning.md — companion doc covering **build-config** version sources (`package.json`, `wxt.config.ts`, lockfiles, `pyproject.toml`) via single-source + drift gate. Same anti-drift principle, different surface: that doc is about config files that must agree; this doc is about doc references that must not go stale. The two are complementary — together they cover both the build and the documentation version surfaces.
- ../best-practices/browser-extension-readme-structure-and-media.md — README structure and media placement conventions for this repo.
- `website/hugo.toml` — `releaseURL = ".../releases/latest"`; the variable-indirection pattern the READMEs now mirror at the link tier.
