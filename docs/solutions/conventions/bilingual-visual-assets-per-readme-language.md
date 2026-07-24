---
title: "Bilingual visual assets: ship one localized variant per README language"
date: 2026-07-24
category: conventions
module: "docs/assets / README / i18n"
problem_type: convention
component: documentation
severity: low
applies_when:
  - "A diagram or screenshot contains translatable text and the repo has multiple README languages"
  - "An English README ends up embedding a Chinese-labeled diagram or vice versa"
tags: ["bilingual", "i18n", "readme", "svg", "architecture-diagram", "localization", "assets"]
---

# Bilingual visual assets: ship one localized variant per README language

## Context

This repo ships two READMEs (`README.md` in Chinese, `README.en.md` in English), each embedding an architecture diagram. The first diagram's node labels were Chinese (搜索页 / 智能体侧 / 共享核心 …). When the references were synced, the English README was pointed at that same Chinese diagram, so English readers saw an architecture diagram full of Chinese labels — the text renders, but they cannot read it. The problem was not translation quality; it was that one text-bearing image was shared across two languages of documentation.

## Guidance

**For any visual asset that contains translatable text (architecture diagrams, annotated screenshots, flowcharts), ship one variant per README language, and have each README reference its own language's variant.** Do not make a single "bilingual-label" image serve both: mixing Chinese and English crowds the nodes, overflows the label boxes, and forces each reader to look at annotations they do not need — the Chinese reader does not need the English note and vice versa. Each side reading its mother-tongue image is the cleanest outcome.

In practice the second image should be a **translation-only variant** of the first: same viewBox, same coordinates, same box sizes, same colors, same arrows, same legend positions, same layering order — only the text strings change. That keeps the two images visually identical in structure, so a layout change is made once and the text is re-synced. The official Chinese name inside a brand lockup (e.g. 双面搜 in the title) stays untranslated, because it *is* the brand spelling and matches the README's brand wording; the body labels are fully translated.

Name the files with a language suffix in one assets directory: `architecture.svg` / `architecture-en.svg` (and each `@2x.png`). Each README references its own language's file:

```markdown
<!-- README.md -->
![双面搜架构](docs/assets/architecture.svg)

<!-- README.en.md -->
![Juso Architecture](docs/assets/architecture-en.svg)
```

**Pure graphics with no translatable text** (icons, decoration, text-free screenshots) are shared as a single file — no duplication. The test is simply "does the image contain words that need translating."

## Why This Matters

Sharing one text-bearing image means half the readers see a half-finished artifact. This is the inconsistency most easily missed in bilingual docs, because the image *displays* — CI and link checks pass, and only a human eye catches it. The cost of shipping a per-language variant is low (a translation variant changes no layout), and the payoff is two self-consistent READMEs. It also blocks the other temptation: cramming both languages into one image, after which both sets of readers find it crowded.

## When to Apply

- The repo has READMEs or docs in more than one language and embeds annotated images.
- The image is produced by a regenerable tool (hand-written/scripted SVG, draw.io, a diagram skill, etc.) so a translation variant is cheap.
- The same logic applies to screenshots that contain UI text: either capture one per language, or use a text-free / brand-neutral frame.

## Examples

Current state of this repo's `docs/assets/`: `architecture.svg` (Chinese labels) for `README.md`, and `architecture-en.svg` (English labels, geometry identical coordinate-for-coordinate) for `README.en.md`. Both use the same viewBox `0 0 1040 1030`, the same palette and arrow routing, and differ only in text; the title keeps the 双面搜 / Juso brand lockup.

Counter-example (do not do this): writing `搜索页 / Search Page` as two lines in every node of one SVG — the boxes must grow taller, the text crowds, and each language's reader is forced to look at the line they do not need.

## Related

- ../tooling-decisions/ffmpeg-two-pass-gif-compression-for-readme.md — same batch: compressing the demo GIF.
- ../best-practices/browser-extension-readme-structure-and-media.md — same batch: README structure and media placement.
- ../best-practices/bilingual-brand-naming-shuangmiansou-juso.md — same bilingual-consistency family: the naming dimension.
