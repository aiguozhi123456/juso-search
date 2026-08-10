---
title: "Hugo subpath deployment breaks hardcoded template paths"
date: 2026-08-08
category: integration-issues
module: website
problem_type: integration_issue
component: documentation
symptoms:
  - "All images return 404 on the deployed site (e.g. /img/screenshot-search.png resolves against the domain root, not the project subpath)"
  - "Internal navigation links (logo, face-switcher, language-switcher, footer) jump to the wrong domain root instead of staying inside the project subpath"
  - "Build passes green while the deployed site is completely broken"
root_cause: config_error
resolution_type: code_fix
severity: high
tags: [hugo, github-pages, subpath, baseurl, relurl, static-site, deployment]
---

# Hugo subpath deployment breaks hardcoded template paths

## Problem

The Juso website is a Hugo static site deployed to a GitHub Pages **project subpath** (`https://<user>.github.io/juso-search/`), configured via `hugo --baseURL https://<user>.github.io/juso-search/`.

After a clean deploy, every image returned 404 and every internal navigation link (logo, face-switcher, language-switcher, footer) jumped to the domain root (`https://<user>.github.io/...`) — which hosts a different site (a blog). The build exited green the whole time.

## Symptoms

- `GET /img/screenshot-search.png` → 404 (browser resolved it against the blog root, not `/juso-search/img/...`)
- `GET /agents/` → served the blog's 404 or the blog itself, not the Juso agents page
- `GET /en/` → same problem
- Favicon (`/brand/classic.png`) → 404
- `hugo --minify` reported zero warnings and zero errors

## What Didn't Work

**Checking only HTML status codes.** An initial smoke test fetched the four page URLs (`/`, `/agents/`, `/en/`, `/en/agents/`) and confirmed all returned 200. That looked green. But 200 on the *document* says nothing about the resources the document references or the links inside it. The bug was invisible to that check.

**Assuming `--baseURL` rewrites everything.** The intuitive reading of `--baseURL` is "prepend this to all URLs." It is not. Hugo's `--baseURL` only affects URLs generated **through Hugo's URL functions** (`relURL`, `absURL`, `relLangURL`, `.Permalink`, `.RelPermalink`). Hardcoded strings in templates — `src="/img/x.png"`, `href="/agents/"` — pass through `--baseURL` completely unchanged.

## Solution

Replace every hardcoded root-absolute path in the templates with the appropriate Hugo URL function:

**Static resources** (images, fonts, CSS, icons) → `relURL`:
```diff
- <img src=/img/screenshot-search.png>
+ <img src="{{ "img/screenshot-search.png" | relURL }}">

- <link rel=icon href=/brand/classic.png>
+ <link rel=icon href="{{ "brand/favicon-32.png" | relURL }}">

- <img src=/icons/{{ .icon }}.svg>
+ <img src="{{ printf "icons/%s.svg" .icon | relURL }}">
```

**Open Graph / social images** → `absURL` (OG requires an absolute URL):
```diff
- <meta property="og:image" content=/brand/classic.png>
+ <meta property="og:image" content="{{ "img/promo-1400x560.png" | absURL }}">
```

**Internal navigation** (same-language links) → `relLangURL`:
```diff
- <a class=brandlock href=/>
+ <a class=brandlock href="{{ "" | relLangURL }}">

- <a href=/agents/>
+ <a href="{{ "agents/" | relLangURL }}">
```

`relLangURL` is used (not plain `relURL`) for internal nav so that language-aware links resolve correctly under both the default language (root) and non-default languages (`/en/`).

Files changed: `layouts/_default/baseof.html`, `layouts/index.html`, `layouts/agents/single.html`, `layouts/human/single.html` (added in the symmetric-IA restructure), `layouts/partials/header.html`, `layouts/partials/footer.html`, `layouts/partials/icon-wall.html`.

## Why This Works

Hugo's URL functions are baseURL-aware:
- `relURL` prepends the baseURL and emits a relative-to-root path (`/juso-search/img/x.png`).
- `absURL` prepends the baseURL and emits a full absolute URL (`https://<user>.github.io/juso-search/img/x.png`).
- `relLangURL` additionally accounts for the current language prefix.

Hardcoded strings bypass all of this. Once every path goes through a URL function, the same templates render correctly at any baseURL — root domain, project subpath, or custom domain — without further changes.

## Prevention

- **Verify resources, not just documents.** After a subpath deploy, fetch the deployed HTML, extract the actual `src=`/`href=` values, and fetch *those* URLs. A page returning 200 tells you nothing about whether its images, CSS, fonts, and internal links resolve correctly.
- **Never hardcode root-absolute paths in Hugo templates** when the site may live under a subpath. Use `relURL`/`absURL`/`relLangURL` exclusively.
- **Smoke-test with the real baseURL.** Run `hugo server --baseURL /juso-search/ --port 1313` (or build with `--baseURL ...` and inspect `public/`) to catch path issues before deploy. The default `hugo server` uses baseURL `/`, which hides subpath bugs.
- **Audit command.** A grep for `src="/`, `href="/`, `url(/` across `layouts/` after template work catches regressions early.

## Related Issues

- The same class of bug affects any static-site generator with a base-path option (Jekyll `baseurl`, Vite `base`, Next `basePath`). The fix pattern is identical: use the framework's path helper, never hardcode.
