---
title: "Bilingual brand naming: 聚搜 → 双面搜 (Chinese) while keeping Juso (English)"
date: 2026-07-23
last_updated: 2026-07-23
category: best-practices
module: "branding / i18n / README / wordmark"
problem_type: naming_decision
component: branding
severity: low
applies_when:
  - "Choosing or revisiting the product's Chinese or English brand name"
  - "Deciding whether a code identifier should carry the Chinese or the English name"
  - "Weighing brand-name uniqueness against memorability"
tags: [naming, branding, i18n, wordmark, uniqueness, seo, decision-record]
---

# Bilingual brand naming: 聚搜 → 双面搜 (Chinese) while keeping Juso (English)

## Context

The product shipped v1.0.0 as **聚搜 / Juso**. Its README already positioned it as a “双面搜索 / two-sided search” product: one side serves human users (select and switch conventional search engines and configured AI search services), the other serves local AI agents (call AI search APIs or retrieve conventional engines through the same browser). The Chinese name 聚搜 (“gather search”) did not reflect this two-sided positioning, so a rename was considered: adopt 双面搜 (“two-sided search”) as the Chinese name, and decide whether the English name should change too.

This record captures the decision and, more importantly, the tradeoff reasoning — so the question is not re-litigated and future contributors understand why the bilingual brand is intentionally non-phonetic.

## Decision

- **Chinese name**: 聚搜 → **双面搜** (effective 2026-07-23, after v1.0.0).
- **English name**: **Juso**, unchanged.
- **Brand**: **双面搜 / Juso**.
- **Code identifiers keep Juso**: package name `juso-search`, `JUSO_*` environment variables, `--juso-*` CSS variables, and the `juso-search` agent skill all retain Juso. Only the Chinese *display* layer carries 双面搜.

## Rationale

### Why 双面搜 for Chinese

- **Aligns with positioning.** 双面搜 literally names the product's defining trait — one side for people, one side for agents — which the README already used as its tagline. The name now matches the description.
- **Chinese-name uniqueness.** A uniqueness sweep found no app, extension, website, or trademark named 双面搜 in the search/software category. The nearest name, 双搜 (`shuangsou.cn`), is a registered-but-suspended search domain; 双面搜 itself is clean, and `shuangmiansou.com` is likely registrable.
- **Low connotation risk.** The morally loaded “two-faced” idioms (两面派, 两面三刀) use 两 (liǎng), not 双 (shuāng). 双 is the neutral/physical character (双面胶 double-sided tape, 双面打印 duplex printing). The 搜 suffix anchors the name firmly in the tool/search domain, so the leap to “two-faced” is unnatural.

### Why keep Juso for English

- **Memorability is a daily compounding asset.** Juso is 4 letters, 2 syllables, trivial to say, spell, and remember. A dedicated coined-name round (24 candidates) found **no name that beats Juso on both memorability and uniqueness**: the 4-letter CV-CV coined space is saturated by active SaaS/AI products; the clean survivors (e.g. Qozu) are clean only because they are awkward to spell, while the memorable ones (e.g. Zuve) carry in-category software-company collisions worse than Juso's.
- **Juso's weakness is out-of-category SEO noise, not brand confusion.** Searching bare “Juso” surfaces the Korean government address API (juso.go.kr; 주소 = address). That is a different category entirely — no search engine or browser extension is named Juso — so it is a discoverability inconvenience, not a brand-identity conflict.
- **The brand owns its qualified queries.** “Juso extension” returns this product at the top (verified on Bing); generic descriptive terms like “two-side search extension” are a crowded red ocean. An ownable brand word that wins its brand+category query is more valuable than a descriptive name lost in a saturated category. The mitigation for the bare-name case is simply to market with brand+category (“Juso · 双面搜”, “Juso extension”).
- **Zero migration cost on a released product.** The GitHub repo, the published release, the agent skill, the environment variables, and users' installed extensions all already use Juso. Changing the English name would be a breaking change for marginal uniqueness gain.

### The tradeoff, stated plainly

Uniqueness and memorability pull in opposite directions for short brand names. 双面搜 maximizes Chinese-name uniqueness and semantic fit; Juso maximizes memorability and owns its brand queries while carrying only an out-of-category SEO collision. Splitting the two — Chinese 双面搜, English Juso — takes the best of each axis at the cost of a deliberately non-phonetic bilingual brand.

## What changed, what did not

- **Changed (Chinese display layer only):** `zh_CN` locale strings (`ext_name`, `search_page_title`, options titles), the search/options HTML `<title>`s, the README H1, and brand comments. The `Wordmark` *comment* was updated but its split-color logic was not — `charAt(0)`/`slice(1)` now renders 「双」in brand vermillion + 「面搜」in neutral fg, consistent with the prior first-char-brand rule.
- **Not changed:** the `en` locale (Juso), the `juso-search` package/skill name, `JUSO_*` env vars, `--juso-*` CSS vars, and the GitHub repository.

**Rule for future code:** the Chinese display layer carries 双面搜; all code identifiers carry Juso. Do not introduce 双面搜 into identifiers, nor Juso into Chinese display strings.

## Why This Matters

- Prevents re-litigating the naming question; the uniqueness-vs-memorability tradeoff and its evidence are recorded once.
- Explains the intentionally non-phonetic bilingual brand (双面搜 ↔ Juso share no sound), which otherwise looks like an oversight.
- Fixes the identifier rule so future work stays consistent.

## When to Revisit

- If the product gains meaningful international/developer-facing traction and the bare-“Juso” Korean-API collision becomes a *measurable* discoverability problem (try brand+category positioning first).
- If a CNIPA trademark search (class 9 / 42) reveals a conflict for 双面搜, or `shuangmiansou.com` is taken by a competing product.

## Related

- [README.md 命名历史](../../../README.md#命名历史) / [README.en.md Naming History](../../../README.en.md#naming-history) — user-facing rename history.
- [Project plan](../../plans/2026-07-01-001-juso-search-plan.md) — original plan, still titled 聚搜 / Juso (point-in-time artifact).
- [Project concepts](../../../CONCEPTS.md) — Search Source and the two-sided product vocabulary.
