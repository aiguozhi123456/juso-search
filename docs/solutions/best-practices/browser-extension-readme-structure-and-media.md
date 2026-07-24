---
title: "Structuring a browser-extension README for conversion and dual audience"
date: 2026-07-24
category: best-practices
module: "README / docs/assets"
problem_type: best_practice
component: documentation
severity: low
applies_when:
  - "Writing or revising the README of a browser extension or developer tool"
  - "A README serves both human end users and an agent/automation audience"
  - "Screenshots and a demo are planned but not yet captured"
tags: ["readme", "badges", "shields-io", "screenshots", "browser-extension", "documentation", "structure"]
---

# Structuring a browser-extension README for conversion and dual audience

## Context

A browser-extension README usually has two readers: people who want to install and use it, and developers who want to wire it into automation or an agent workflow. This repo's README is also a "two-sided search" product, with the human side and the agent side weighted equally. The first draft was complete on information but weak on conversion: no badges under the title, no screenshots, an intro that split the product into "people / agents" halves (making a pure-human user suspect "this is for agents"), and the architecture diagram buried only in the dev section. A round of structural improvements followed; the placement practice is captured below.

## Guidance

Organize the top for "decide in three seconds whether to install," and the bottom for "the person who wants depth can get depth":

1. **A row of badges directly under the title** (shields.io). Four or five is enough — do not pile them on: License, Release (tracking the latest tag dynamically), platform/manifest version (e.g. Manifest V3), tech stack (e.g. Built with WXT), and `PRs Welcome`. Badges answer "is this active, what license, what platform" — a trust signal at a glance.
2. **A zero-config human-side statement in the intro**: even when the product has an agent face, say plainly that "the human side alone is a complete, ready-to-use tool, and which sources need no configuration." Treat "two-sided" as the brand story, not as an entry barrier.
3. **Human-first section order**: the capability table lists the human rows first, and Screenshots & Demo follows right after, so a pure-human user sees "what can I do with it, what does it look like" before the agent interface, which goes later. Reordering is not favoritism — it lowers the primary reader's cognitive cost.
4. **Placeholder the screenshots & demo section first**: pre-place the image markdown references inside an HTML comment with semantic filenames, plus a one-line "coming soon" note. Once the captures exist, uncomment and they render — zero structural change. Fix the placeholder filenames (e.g. `screenshot-search.png` / `screenshot-serp.png` / `demo.gif`) up front so whoever captures saves under those exact names.
5. **Each image gets a bold sub-caption plus semantic alt**: the caption states "what this image proves" (e.g. "SERP Switch Bar: switch engines from any result page"); the alt serves screen readers and the broken-image fallback.
6. **Embed the architecture diagram in the Development & Architecture section**, and reference the variant matching the README's language (see the bilingual-assets convention).

For capture selection, a browser extension wants at minimum: the main search page (showing the source bar plus the core result, e.g. an AI answer with citations), one embedded interaction (e.g. the switch bar on a result page — proof of the "works on someone else's turf" differentiator), and one 10–15 second GIF that strings the loop together. Use the same query throughout, and one that returns results on every engine, so the viewer can follow "the same question jumping across sources."

## Why This Matters

The README is the extension's landing page; most people look only at it before installing. A README without badges and screenshots pushes the entire "should I install this" cost onto the reader to clone and try. An intro that frames the product as "for agents" directly turns away pure-human users — yet the human side is often a differentiated, complete product in its own right. The placeholder-comment trick decouples "the screenshots are not shot yet" from "the README structure": get the structure right once, backfill the media later, and do not stall the README improvement while waiting on captures.

## When to Apply

- Writing or revising the README of a browser extension, CLI, or developer tool.
- When the README addresses both end users and an automation/agent audience.
- When screenshots and a demo are planned but not yet captured, and you want the structure right first.

## Examples

The current top-down structure of this repo's `README.md` / `README.en.md`: title → badge row → language-switch link → tagline → intro (with the human-side zero-config statement) → capability table (human rows first) → Screenshots & Demo (three images, each with a bold sub-caption) → Current Capabilities → For People → Quick Start (People / Agents subsections) → Installation → Security boundaries → Agent interface → Development & Architecture (architecture diagram embedded) → Future / Naming / Acknowledgements / License. The placeholder form of the Screenshots & Demo section (before media lands):

```markdown
## Screenshots and Demo

<!-- Uncomment after adding screenshots; place images in docs/assets/
![Search Page](docs/assets/screenshot-search.png)
![SERP Switch Bar](docs/assets/screenshot-serp.png)
![Core Flow Demo](docs/assets/demo.gif)
-->

*Screenshots and demo video coming soon.*
```

## Related

- ../tooling-decisions/ffmpeg-two-pass-gif-compression-for-readme.md — how the demo GIF was compressed.
- ../conventions/bilingual-visual-assets-per-readme-language.md — ship one localized variant per language for text-bearing assets.
