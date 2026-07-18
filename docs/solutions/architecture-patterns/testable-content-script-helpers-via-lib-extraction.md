---
title: Testable content-script helpers via lib extraction with injectable defaults
date: 2026-07-18
category: architecture-patterns
module: serp-bar / content-script testing
problem_type: architecture_pattern
component: tooling
severity: low
applies_when:
  - Logic inside a WXT defineContentScript IIFE has grown nontrivial and needs unit tests, but the IIFE scope prevents imports from reaching it
  - A content-script helper references DOM globals (document.querySelector, document.head) that must be stubbed or replaced with a jsdom document in tests
  - Named exports cannot be added to the content-script entrypoint because WXT/MV3 forbids exports on the content-script bundle (see prior learning)
tags:
  - wxt
  - content-script
  - unit-testing
  - dependency-injection
  - serp-bar
  - iife
---

# 提取内容脚本运行时辅助函数到带默认参数依赖注入的纯模块

## Context

`entrypoints/serp-bar.content.ts` 是一个 WXT `defineContentScript` IIFE。anchor-cascade 与 pageStyles 工作期间在其中新增了三个运行时辅助函数：`pickAnchor`（按候选 `AnchorStrategy` 顺序回退）、`injectPageStyles`（向 `<head>` 注入带固定 id 的 `<style>`，先清理旧节点以保证幂等）、`removePageStyles`。这些函数逐渐积累了非平凡的分支、生命周期与 DOM 形状逻辑，但因为定义在 IIFE 内部，**无法被单元测试**——ES module 导入触达不到 IIFE 内部的局部定义。现有的 `tests/engines.test.ts` 只能断言静态数据形状（`engine.anchors`），无法覆盖"第一个匹配胜出 / 回退到末位 / 幂等重挂载"这类运行时行为。一次 code review 把它列为 P2 测试缺口。

但**不能简单地把它们 `export` 出来**：先前学习 `docs/solutions/runtime-errors/serp-to-extension-page-blocked-by-client.md` 已记录——WXT 会把带命名 export 的 content script 当作可分析模块，触发 `browser.i18n.getUILanguage()` 等浏览器 API 在 `wxt build` 下的副作用，破坏构建。内容脚本必须保持零命名 export。

## Guidance

把辅助函数抽到新的纯模块 `lib/serp-bar-mount.ts`，并通过**默认参数做依赖注入**，让生产调用点保持原样、测试时替换为 mock：

```ts
import type { AnchorStrategy, SearchEngine } from '@/lib/engines/types';

export const PAGE_STYLES_ID = 'juso-serp-page-styles';

export function pickAnchor(
  candidates: AnchorStrategy[],
  querySelectorFn: (selector: string) => Element | null = (s) => document.querySelector(s),
): AnchorStrategy {
  for (const candidate of candidates) {
    if (querySelectorFn(candidate.selector)) return candidate;
  }
  return candidates[candidates.length - 1];
}

export function injectPageStyles(engine: SearchEngine, doc: Document = document): void {
  if (!engine.pageStyles) return;
  const existing = doc.head.querySelector<HTMLStyleElement>(`style#${PAGE_STYLES_ID}`);
  if (existing) existing.remove();
  const styleEl = doc.createElement('style');
  styleEl.id = PAGE_STYLES_ID;
  styleEl.dataset.engine = engine.id;
  styleEl.textContent = engine.pageStyles;
  doc.head.append(styleEl);
}

export function removePageStyles(doc: Document = document): void {
  doc.head.querySelector(`style#${PAGE_STYLES_ID}`)?.remove();
}
```

内容脚本仅作为调用方 import 回来，自身仍保持 IIFE + 零命名 export：

```ts
import { pickAnchor, injectPageStyles, removePageStyles } from '@/lib/serp-bar-mount';
// ...
const strategy = pickAnchor(anchorsFor(state.engine));  // 调用点不变
// onMount:
injectPageStyles(state.engine);                          // 调用点不变
// onRemove:
removePageStyles();                                      // 调用点不变
```

**默认参数 DI 是关键技巧**：生产代码省略依赖参数（用真实 `document` / `document.querySelector`），测试传入 mock。抽取对调用点是 drop-in 替换——零行为差异、零参数列表变动。

## Why This Matters

- **测试性免 DOM**：`pickAnchor` 接 `(selector) => Element | null` 而非 `Document`，单元测试可只断言回退顺序，不需要 jsdom。`injectPageStyles` / `removePageStyles` 接 `doc` 参数，测试用一个 mock `Document` 即可断言"创建唯一 `<style>` / 正确 id / dataset / textContent / 幂等"。
- **构建安全**：内容脚本保持零命名 export，规避 WXT 对可分析模块的浏览器 API 副作用触发（见相关学习）。命名 export 只出现在 `lib/` 下的纯模块。
- **跨内容脚本复用**：未来若有第二个内容脚本（如 options 注入器、其他宿主页脚本）需要同样的 page-styles 挂载或锚点回退，可直接 import——逻辑不再被锁死在某个 IIFE 内。

## When to Apply

当内容脚本中的辅助函数满足以下任一条件时抽取：

- 出现非平凡分支（cascade、回退、early return）。
- 涉及生命周期或幂等语义（重挂载、先删后建、observer 接线）。
- 操作 DOM 形状（创建/移动/删除节点，设置 dataset/textContent）。
- 阈值启发式：**"我会想给这写一个单元测试吗？"**——若答案是会，就抽。

纯展示/纯一次性拼字符串、且只在一处调用的小函数可保留在 IIFE 内。

## Examples

仓库中已有三处从 `serp-bar.content.ts` 抽出的同类先例，构成 canonical 抽取目标集合：

- **`lib/serp-bar-mount.ts`** — 本学习的对象：anchor 选择 + pageStyles 注入/移除。
- **`lib/serp-bar-layout.ts`** — 抽自 `syncAlignedHost` 的纯几何计算（尺寸/位置）。
- **`lib/serp-handoff.ts`** — 抽自 `onSelect` 的纯导航解析器（受 `serp-to-extension-page-blocked-by-client.md` 约束驱动而抽出）。

`tests/serp-bar-mount.test.ts` 用 10 个单测覆盖：`pickAnchor` 首匹配胜出、回退到末位、单候选命中/不命中、默认 `document.querySelector` 路径；`injectPageStyles` 唯一 `<style>` 与正确 id/data-engine/textContent、Bing（无 `pageStyles`）no-op、双调幂等；`removePageStyles` 移除已注入元素与缺场 no-op。

## Related

- `docs/solutions/runtime-errors/serp-to-extension-page-blocked-by-client.md` — 内容脚本不得有命名 export 的约束来源，直接驱动了本模式。
- `docs/solutions/ui-bugs/serp-bar-engine-specific-anchors.md` — anchor-cascade 与 pageStyles 工作的交付点，本学习中的辅助函数即在该处引入。
- `docs/solutions/architecture-patterns/google-bing-serp-scope-minimization.md` — 同一内容脚本生命周期的另一面（scope / SPA 重挂载）。
