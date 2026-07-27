---
title: Chrome Web Store Listing and Privacy Docs Must Be Updated for Each Release
date: 2026-07-27
category: workflow-issues
module: release
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - "Publishing a new version that adds Search Engines or Site Engine features"
  - "Updating Chrome Web Store listing copy (docs/assets/store/cws-release.md) for a release"
  - "Revising CWS privacy questionnaire answers (docs/assets/store/privacy.md) for a release"
  - "Updating the public privacy policy (docs/assets/store/privacy-policy.md) for new data handling"
tags:
  - store-listing
  - cws
  - chrome-web-store
  - privacy-policy
  - release-docs
  - bilibili
  - site-engine
---

# Chrome Web Store Listing and Privacy Docs Must Be Updated for Each Release

## Context

When shipping a new version that adds search engines or features not present in the previous release, the Chrome Web Store (CWS) documentation trio — store listing, privacy questionnaire, and privacy policy — must be audited and updated together. The gap typically manifests as: a store listing still references only old engines, a privacy questionnaire omits new host permissions and content scripts, and a privacy policy omits new data handling contexts.

In one real case, v1.1.0 docs covered only the baseline engines and single-purpose description. v1.2.0 added Bilibili as a supported engine and the Site Engine feature (user-saved site-scoped searches using the `site:` operator), plus an updated Agent Bridge description with two-layer gating. None of these appeared in the prior docs.

## Guidance

Treat the three CWS artifacts as a single release bundle that must describe the same feature surface:

1. **`docs/assets/store/cws-release.md` (store listing copy)** — enumerate every supported engine and user-facing feature. List Bilibili alongside existing engines. Describe Site Engine as a first-class capability. Update the Agent Bridge description to reflect the current two-layer gating model.

2. **`docs/assets/store/privacy.md` (questionnaire)** — sync host permissions and content scripts with the engines declared in the store listing. Add Bilibili to both sections. Add Site Engine to the single-purpose description and to any data-collection justifications that depend on query context.

3. **`docs/assets/store/privacy-policy.md` (public policy)** — mirror the same additions: Bilibili in the content scripts section, Site Engine in the data collection section, and consistent version references across all three files.

The audit order should be: new features first, then each artifact against the feature checklist. Do not update one file without checking the other two for the same omissions.

## Why This Matters

CWS reviewers and users cross-reference these documents. A store listing that omits an engine while the extension actually queries it triggers rejection or post-publish takedown. A privacy policy that does not mention Site Engine data flows creates a disclosure gap. Inconsistent version references across the trio confuse both reviewers and users trying to reconcile what changed.

## When to Apply

- Any release that adds a search engine provider, domain target, or network endpoint
- Any release that introduces a new feature class (e.g., saved searches, site-scoped queries, agentic workflows)
- Any release that changes the architecture description of an existing feature (e.g., moving from single-layer to two-layer gating)
- Routine quarterly or per-version audits, even when the diff seems small

## Examples

**Before (v1.1.0 store listing excerpt):**
Supported search engines: Google, Bing, Baidu, Douyin, Xiaohongshu.
Privacy description: Single-purpose search assistant with no persistent site-scoped queries.

**After (v1.2.0 store listing excerpt):**
Supported search engines: Google, Bing, Baidu, Douyin, Xiaohongshu, Bilibili.
Site Engine: Save site-scoped searches in settings; each entry fixes an underlying engine (Google, Bing, or Baidu) and uses the `site:` operator to constrain results to a public site. No API key required.
Agent Bridge: Two-layer gating (total switch + engine-search sub-switch), off by default; each invocation uses a fresh local port and single-use token.

**Before (v1.1.0 privacy.md excerpt):**
Host permissions: `127.0.0.1/*`, `api.tavily.com/*`, `api.exa.ai/*`, `api.stepfun.com/*`
Content scripts: Google, Bing, Baidu, Douyin, Xiaohongshu
Single-purpose: Search assistant.

**After (v1.2.0 privacy.md excerpt):**
Host permissions: `127.0.0.1/*`, `api.tavily.com/*`, `api.exa.ai/*`, `api.stepfun.com/*`
Content scripts: Google, Bing, Baidu, Douyin, Xiaohongshu, Bilibili
Single-purpose: Unified search interface for conventional engines, user-saved Site Engines (site-scoped searches with no API key required), and configured AI search APIs.

**Before (v1.1.0 privacy-policy.md excerpt):**
We inject content scripts into Google, Bing, Baidu, Douyin, and Xiaohongshu result pages.

**After (v1.2.0 privacy-policy.md excerpt):**
We inject content scripts into Google, Bing, Baidu, Douyin, Xiaohongshu, and Bilibili result pages. Site Engine stores site-scoped search configurations locally to enable repeated targeted queries without an API key.

## Related

- [Chrome Extension Dual-Version Release Process](./chrome-extension-release-process.md) — the full release workflow (version bump, dual-ZIP build, tagging, GitHub Release, CWS upload)
- [WXT Self-Contained Development Build with Stable Extension ID](./tooling-decisions/wxt-self-contained-dev-build.md) — technical background for the dev vs production ZIP distinction
- [Default-off capability gating for Agent Bridge and engine-search (CWS compliance)](./architecture-patterns/default-off-capability-gating-for-cws-compliance.md) — the two-layer opt-in gate required to pass CWS review
