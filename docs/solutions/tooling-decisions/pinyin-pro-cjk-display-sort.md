---
title: "Sorting mixed CJK and Latin source labels by pinyin: pinyin-pro vs Intl.Collator"
date: 2026-08-04
category: tooling-decisions
module: options-page
problem_type: tooling_decision
component: tooling
severity: low
applies_when:
  - A UI list mixes Chinese and Latin-script labels and must sort by pinyin spelling so the two scripts interleave
  - Intl.Collator('zh-CN') groups all CJK before all Latin instead of interleaving by spelling
  - A display-only sort must stay separate from a persisted user order preference
resolution_type: tooling_addition
tags: [pinyin, sorting, intl-collator, cjk, display-sort, options-page, quick-switch-bar, pinyin-pro]
related_components:
  - lib/pinyin-sort.ts
  - entrypoints/options/App.tsx
---

# Sorting mixed CJK and Latin source labels by pinyin: pinyin-pro vs Intl.Collator

## Context

The options page's quick-switch bar management section lists every Search Source (configured AI providers, conventional engines, AI engines, site/custom engines, provider instances) with a show/hide toggle. Source labels are a mix of Chinese (`豆包`, `抖音`, `小红书`, `哔哩哔哩`) and Latin (`Baidu`, `Bing`, `DuckDuckGo`, `Exa`). The list was rendered in persisted `sourceOrder` (registry order + user drag order), which put unrelated types adjacent and made a specific source hard to scan for.

The request was to display this list sorted by pinyin, so `豆包` (doubao) sits next to `DuckDuckGo`, and `哔哩哔哩` (bilibili) sits next to `Bing` — Chinese and Latin interleaved by spelling, the way a Chinese reader expects an alphabetical index.

The first, dependency-free instinct — `Intl.Collator('zh-CN')` — does not produce this. It sorts CJK correctly *within* the CJK block and Latin correctly *within* the Latin block, but it places the entire CJK block before the entire Latin block. So `豆包` lands before `Baidu`, not next to `DuckDuckGo`. The `-u-co-pinyin` collator extension behaves identically on V8/Node. True pinyin interleaving requires converting CJK characters to their latinized spelling and sorting on that.

## Guidance

Use `pinyin-pro` to derive a toneless-pinyin sort key, then sort on the key. Keep this **display-only**: never write the sorted order back to `sourceOrder` — the persisted order is owned by the Source Group Layout editor (drag-and-drop), and the quick-switch bar itself renders in `sourceOrder`. The sort is a pure projection applied at render time on a copy of the source array.

`lib/pinyin-sort.ts`:

```ts
import { pinyin } from 'pinyin-pro';

/** CJK → toneless pinyin, non-CJK kept as-is, lowercased. */
export function pinyinSortKey(s: string): string {
  return pinyin(s, { toneType: 'none', type: 'array', nonZh: 'consecutive' })
    .join('')
    .toLowerCase();
}

/** Compare by pinyin key; fall back to the raw string for stability when keys tie. */
export function compareByPinyin(a: string, b: string): number {
  const ka = pinyinSortKey(a);
  const kb = pinyinSortKey(b);
  return ka === kb ? a.localeCompare(b) : ka.localeCompare(kb);
}
```

Applied at the render site on a copy (the original `configuredSources` is not mutated):

```tsx
{[...configuredSources]
  .sort((a, b) => compareByPinyin(sourceLabel(a, t), sourceLabel(b, t)))
  .map((source) => /* show/hide row */)}
```

`nonZh: 'consecutive'` keeps Latin runs intact within a mixed label (`Stepfun 按量` → `stepfun anliang`, not `s t e p f u n a n l i a n g`), so mixed labels sort sensibly against both pure-CJK and pure-Latin labels.

## Why This Matters

- **`Intl.Collator('zh-CN')` groups by script, not by spelling.** This is the trap: it looks like it sorts Chinese correctly, so a quick test with all-CJK or all-Latin inputs passes, while the mixed list silently splits into two blocks. The `-u-co-pinyin` extension does not change this on V8/Node — it still partitions by script before ordering within. Only explicit romanization (pinyin-pro) interleaves.
- **Display sort and persisted order must stay orthogonal.** `sourceOrder` is one of the four orthogonal preference axes (Source Order, Source Visibility, Active Source, Source Group Layout). Folding a display sort into it would fight the layout editor's drag-and-drop and survive across imports/exports as a corrupted order. Sorting a render-time copy keeps the projection cheap and reversible — the persisted order is untouched, and the layout editor continues to own real ordering.
- **Bundle isolation matters in MV3.** `pinyin-pro` ships a pronunciation dictionary; importing it from a shared module would pull the dictionary into every chunk that transitively imports it. Keeping the import inside `lib/pinyin-sort.ts`, which is imported only by `entrypoints/options/App.tsx`, confines the dictionary to the options chunk. A post-build scan confirmed `pinyin-pro` appears only in `chunks/options-*.js` — not in the background worker, the search page, or any content script.

## When to Apply

- A list mixes CJK and Latin labels and the user expectation is a single pinyin-ordered index (not two script-partitioned blocks).
- The sort is for **display/scanning** only — the underlying persisted order is owned elsewhere and must not be mutated.
- You are tempted to reach for `Intl.Collator('zh-CN')` for "Chinese sorting" — verify the mixed-script behavior first; if it partitions by script, use pinyin-pro instead.

Do **not** apply this to the quick-switch bar's actual pill order, the active-source dropdown, or any surface whose order is a persisted user preference — those render in `sourceOrder` by design.

## Examples

Same label set, two strategies:

```
Intl.Collator('zh-CN')  →  script-partitioned (NOT pinyin-interleaved):
  哔哩哔哩, 抖音, 豆包, 豆包搜索 Custom, 豆包搜索 Global, 小红书,
  Baidu, Bing, Brave Search, ChatGPT, DeepSeek, DuckDuckGo, Exa, ...

pinyin-pro sort key     →  pinyin-interleaved:
  Baidu, 哔哩哔哩(bilibili), Bing, 豆包(doubao), 抖音(douyin),
  DuckDuckGo, Exa, Gemini, Google, Grok, 小红书(xiaohongshu), Yandex
```

Mixed labels sort by their latinized whole: `Stepfun 按量` → `stepfun anliang`, `豆包搜索 Custom` → `doubaosousuo custom`. Prefix ordering falls out naturally — `豆包` (doubao) sorts before `豆包搜索 Custom` (doubaosousuo custom).

Multi-tone characters use pinyin-pro's default reading; if a specific source name needs a fixed reading, a small override table can be layered on `pinyinSortKey` later.

## Related

- `CONCEPTS.md` → Source Order, Source Visibility, Source Group Layout (the orthogonality axes this display sort deliberately does not touch)
- `lib/sources.ts` → `allSources` projection and `sourceLabel` (the source set being sorted)
- `entrypoints/options/App.tsx` → the quick-switch bar management list (the render site)
