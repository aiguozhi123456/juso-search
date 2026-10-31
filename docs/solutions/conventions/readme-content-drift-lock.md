---
title: "Lock README content invariants, not just version references"
date: 2026-10-31
category: conventions
module: "docs / README"
problem_type: convention
component: documentation
severity: medium
applies_when:
  - "A README or doc enumerates a capability set that a registry in code owns (providers, engines, actions, tools)"
  - "Docs carry runnable config examples whose required fields the code enforces at startup"
  - "A repo already drift-locks generated copies and version numbers, but nothing asserts prose claims"
  - "Bilingual docs — each language file is its own copy and can drift independently"
tags:
  - readme
  - drift-lock
  - documentation
  - content-drift
  - registry
  - vitest
  - maintenance
---

# Lock README content invariants, not just version references

## Context

This repo's two READMEs (`README.md` in Chinese, `README.en.md` in English) had their **version references** locked down long before their **content** was. The version layer got a tiering convention (the sibling [readme-version-reference-tiering.md](readme-version-reference-tiering.md)) plus a single-source gate (`tests/version-drift.test.ts`), and its grep gate passes cleanly. The content layer had nothing.

The result: the README's last substantive content edit dates to 2026-09-14, and 42 commits followed it on `main` without a single write-back (count verified with `git rev-list --count` at the time of writing). An audit against the code registries found the docs describing a product that no longer existed:

- The AI-search-services bullet listed 8 provider ids while `lib/providers/registry.ts:14-26` registers 11 — `parallel`, `deepseek`, and `anysearch` had shipped invisibly.
- "Configure a key only when using an AI search service" was false for three services: `lib/providers/tavily.ts:31`, `lib/providers/jina.ts:29`, and `lib/providers/anysearch.ts:34` declare `keyOptional` (keyless free tier) — the README understated the product's own zero-config selling point.
- The source taxonomy said five kinds and disclaimed parallel fan-out / merge / dedup / fuse — while `lib/sources.ts:23` defines seven kinds and `lib/gateway.ts:410-441` implements exactly that fan-out for Aggregate Instances, which the same README's agent section was actively promoting. The disclaimer contradicted the feature advertised two sections below it.
- The MCP `mcp.json` quick-start example set only `JUSO_EXTENSION_ID`; `mcp-server/juso_search/config.py:101-110` fails fast with exit code 2 without the required `JUSO_BROWSER_PATH` (its legacy alias `JUSO_CHROME_PATH` is also accepted). Anyone copy-pasting the example got a server that would not start — the one runnable snippet in the doc was broken.

The drift ran in both directions: `AGENTS.md` and `mcp-server/pyproject.toml` had described the MCP surface as 6 / five actions while the bridge exposes ten (`mcp-server/juso_search/server.py`, locked at 10 by `mcp-server/tests/test_tools_list.py`); both were corrected in the same pass.

Nothing in CI could see any of this. Version references had a gate because someone once got burned by a stale release link; content claims had none because nobody had framed "the README enumerates what the registry owns" as a lockable invariant.

## Guidance

**Treat doc claims about a code-owned set as a drift-lock surface, and derive the assertions from the registry.** One test file (`tests/readme-drift.test.ts`) now asserts the invariants that were silently rotting. The design rules that make it hold:

1. **Derive, never duplicate.** `it.each(allProviders().map((p) => p.id))` walks the registry and asserts each provider's brand token appears in the README's services bullet. The test holds no second copy of the provider list — the day a twelfth provider ships without a README mention, this goes red.
2. **Extract the claim, don't grep the whole file.** `servicesBullet(text, /^- AI 搜索服务：/)` pulls the one bullet that carries the claim, so a stray mention elsewhere cannot satisfy the assertion. The regex anchors on the bullet's stable prefix.
3. **Lock structure where form is meaning.** Aggregate Instances must appear as a **peer bullet** (`/^- 聚合实例（Aggregate Instance）/m`), not folded into a disclaimer paragraph — the first fix pass demoted them to prose, and the lock now pins the peer form.
4. **Tripwire anti-patterns instead of maintaining them.** The old text said "eight engines"; the fix deleted the number ("all engines") and the lock forbids its return: `not.toMatch(/[0-9零一二三四五六七八九十]+个引擎/)` plus the English twin. A hardcoded count in prose is future drift with a timer on it.
5. **Keep runnable examples runnable.** The MCP json block must contain `"JUSO_BROWSER_PATH"` — an example that cannot be copy-pasted is a bug, and it now fails the build.
6. **Keep counted claims counted.** The README's "10 actions" claim is asserted against the literal, so growing the bridge forces a conscious doc edit.

**Maintenance contract (the anti-crying-wolf rule).** Every assertion targets a claim *derived from code*, never wording. Legitimate prose rewrites stay green; only capability-change-without-write-back goes red. This is the must-match / intentional-divergence split the existing Drift-lock concept already prescribes, applied to prose instead of copies.

**Prove the lock red before trusting it.** After writing the test, temporarily delete the new provider names from the README, run it, and confirm exactly the corresponding cases fail — then restore from a backup. A lock that has never been seen red is a lock nobody has verified.

## Why This Matters

The version-tiering gate made version references drift-proof; the content layer was the remaining surface, and it rots exactly when the product grows — 42 commits of real features produced zero doc updates because nothing connected the registries to the prose. The failure mode is asymmetric and user-visible: docs that understate the product hide shipped capabilities (three providers invisible; a keyless tier that is the intro's own zero-config story untold), docs that overstate guarantees contradict the feature they disclaim, and one example was outright broken — the MCP quick start could not start. A user reading that README would conclude the product does less than it does, then hit a hard failure on the one thing the docs told them to do.

The cost asymmetry is the point: the lock is roughly 60 lines of test; the audit it replaces was a multi-agent investigation across code, docs, and conventions. Content drift is invisible to link checkers, type checks, and version gates — only a content gate catches it.

## When to Apply

- A README or doc enumerates a capability set that a registry or table in code owns (providers, engines, actions, tools)
- Docs carry runnable config examples whose required fields the code enforces at startup
- The repo already drift-locks generated copies and version numbers, but nothing asserts prose claims
- Bilingual docs — assert both language files; each is its own copy and can drift independently (this run found the same four drifts in both languages, fixed and locked in both)

## Examples

The core assertion, derived from the registry:

```ts
const PROVIDER_BRAND_TOKEN: Record<ProviderId, string> = {
  tavily: 'Tavily',
  exa: 'Exa',
  brave: 'Brave',
  stepfun: 'Stepfun',
  'stepfun-plan': 'Step Plan',
  jina: 'Jina',
  doubao: 'Doubao',
  'doubao-global': 'Doubao',
  parallel: 'Parallel',
  deepseek: 'DeepSeek',
  anysearch: 'AnySearch',
};

it.each(allProviders().map((p) => p.id))('lists provider %s in both READMEs', (id) => {
  const token = PROVIDER_BRAND_TOKEN[id];
  expect(servicesBullet(readmeZh, /^- AI 搜索服务：/)).toContain(token);
  expect(servicesBullet(readmeEn, /^- AI search services:/)).toContain(token);
});
```

Note the token map's two deliberate collisions: `doubao` and `doubao-global` share `'Doubao'` because the README bullet covers both endpoints in one mention, while `stepfun-plan` gets its own `'Step Plan'` token because a bare `'Stepfun'` would let the stepfun-plan row pass on the wrong mention. The map is keyed by registry id, so adding a provider fails the build until it gets a row — the table *is* the checklist.

The anti-pattern tripwires:

```ts
it('does not hardcode the engine count (engines grow; the list stays the visible set)', () => {
  expect(readmeZh).not.toMatch(/[0-9零一二三四五六七八九十]+个引擎/);
  expect(readmeEn).not.toMatch(/\b(eight|nine|ten|\d+) engines\b/i);
});

it('keeps the MCP env example copy-paste runnable (JUSO_BROWSER_PATH is required)', () => {
  expect(readmeZh).toContain('"JUSO_BROWSER_PATH"');
  expect(readmeEn).toContain('"JUSO_BROWSER_PATH"');
});
```

Negative verification for the record: removing `、Parallel、DeepSeek、AnySearch` from the services bullet turned exactly the three corresponding `it.each` cases red and left the other 13 assertions green; the README was restored from a backup immediately after.

## Related

- [readme-version-reference-tiering.md](readme-version-reference-tiering.md) — sibling convention on the same two READMEs: the version-reference layer this doc extends to the content layer.
- [single-source-product-versioning.md](../best-practices/single-source-product-versioning.md) — the single-source + drift-gate precedent for version numbers in build config.
- [browser-extension-readme-structure-and-media.md](../best-practices/browser-extension-readme-structure-and-media.md) — README structure and media rules the content lock sits under.
- [website-drift-lock-enforcement.md](../architecture-patterns/website-drift-lock-enforcement.md) — the repo's existing drift-lock enforcement pattern (reconcile-then-lock, must-match vs intentional-divergence) that this test generalizes from website assets to README prose.
- [derive-provider-id-set-from-registry.md](../architecture-patterns/derive-provider-id-set-from-registry.md) — the registry-derivation principle the brand-token assertions implement. (Flagged for refresh: its provider enumeration predates the deepseek/anysearch additions.)
- [skill-mcp-vocabulary-decoupling.md](../architecture-patterns/skill-mcp-vocabulary-decoupling.md) — "documentation that enumerates a set that evolves is just another hardcoded copy"; the boundary this lock enforces.
- [engine-capability-is-per-registry-not-per-id-union.md](../architecture-patterns/engine-capability-is-per-registry-not-per-id-union.md) — an earlier README capability over-claim incident; the no-hardcoded-count tripwire extends it to prose counts.
- [agent-skill-localhost-capability-bridge.md](../architecture-patterns/agent-skill-localhost-capability-bridge.md) — documents `JUSO_BROWSER_PATH` as required MCP env; the authority behind the runnable-example assertion.
- [agent-bridge-source-instance-exposure.md](../architecture-patterns/agent-bridge-source-instance-exposure.md) — the ten-action bridge surface; authority for the action-count parity assertion and the AGENTS.md / pyproject reverse-drift fix.
- [keyless-free-tier-providers.md](../architecture-patterns/keyless-free-tier-providers.md) and [instantiated-aggregate-search-architecture.md](../architecture-patterns/instantiated-aggregate-search-architecture.md) — the two capabilities whose absence from the README the presence assertions now guard.
- [cws-store-docs-must-sync-with-release-features.md](../workflow-issues/cws-store-docs-must-sync-with-release-features.md) — release-driven documentation-sync discipline on a different surface (store listing); same class of problem, still a manual process.
