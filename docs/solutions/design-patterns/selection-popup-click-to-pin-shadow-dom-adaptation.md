---
title: "SelectionSearchPopup click-to-pin：把 SourceSwitcher 固定模式适配到 shadow DOM 嵌套浮层"
date: 2026-08-15
category: docs/solutions/design-patterns/
module: SelectionSearchPopup
problem_type: design_pattern
component: frontend_stimulus
severity: low
description: 把快切栏 SourceSwitcher 的 click-to-pin 交互模式适配到划词搜索弹窗时，shadow DOM 边界与嵌套浮层结构引入了六个分歧点——composedPath 外部点击判定、子浮层纵向翻转、blur-close 键盘可达性、嵌套固定域 cascade、selectionchange 误杀压制、ARIA 菜单组合。本文档收拢这些适配决策，作为既有三篇 bug 文档的索引与导向。
applies_when:
  - 把 hover-intent / click-to-pin 交互模式适配进 shadow DOM 弹窗或嵌套浮层结构
  - 在 shadow DOM 内做外部点击关闭、键盘焦点管理、或依赖页面选区的浮层
tags:
  - selection-search
  - click-to-pin
  - shadow-dom
  - nested-flyout
  - composed-path
  - adaptation
  - hover-intent
---

# SelectionSearchPopup click-to-pin：把 SourceSwitcher 固定模式适配到 shadow DOM 嵌套浮层

## Context

快切栏 `components/SourceSwitcher.tsx` 建立了 click-to-pin 交互模式：`openGroupId`/`pinnedGroupId` 双状态、三分支 toggle、`pinnedRef` 守卫的 hover-intent 延迟关闭、外部 pointerdown 关闭。它运行在常驻栏（light DOM，无外层瞬态容器），pin 分组即足够。

划词搜索弹窗 `components/SelectionSearchPopup.tsx` 需要同一交互，但运行环境不同：content script 注入的 shadow DOM、弹窗由页面选区触发、分组子浮层嵌套在主浮层内（主浮层自身有瞬态/固定两种生命周期）。适配过程中暴露了六个分歧点，每个都对应一个 bug 类——其中三个已各自有独立 bug 文档记录。本文档是这些适配决策的索引与导向，不重复状态机细节（见 [source-switcher-click-to-pin](../ui-bugs/source-switcher-click-to-pin.md)）。

## Guidance

### 1. 跨 shadow 边界的外部点击判定：composedPath，不是 contains

SourceSwitcher 在 light DOM 用 `groupRef.contains(e.target)` 判定点击是否在浮层内。SelectionSearchPopup 的 document 级监听器在 shadow DOM 外部，`e.target` 会被 retarget 成 shadow host——`contains(e.target)` 对内部点击恒为 false，误判为外部点击。

适配：所有 document 级监听用 `event.composedPath().includes(host)`（composedPath 穿透 shadow 边界，返回真实事件路径）。组件内 React 合成事件不受影响（委托挂在 shadow root 内部 wrapper 上，`e.target` 是真实节点）。

```ts
// content script document 级监听（shadow 外部）
function handleMouseDown(event: MouseEvent) {
  if (guard.noteMouseDown(event.composedPath(), mountedHost)) return;
  dismissPopup();
}
// 组件内 React 合成事件（shadow 内部）——contains 仍正确
if (rootRef.current && path.includes(rootRef.current)) return;
```

### 2. 子浮层纵向翻转：content script 算位 + host dataset + CSS 选择器

SourceSwitcher 的分组 flyout 固定向下展开。SelectionSearchPopup 靠近视口底部时子浮层会溢出。适配：content script 的 `showPopup` 计算位置时算 `subFlyoutUp`，写入 `shadowHost.dataset.subFlyoutUp`，CSS 用 `:host([data-sub-flyout-up="true"])` 翻转。host 的 `:host { all: initial }` 会覆盖 inline 样式，所以用 dataset + `:host()` 选择器而非 inline style（见 [wxt-shadow-root-inline-style-clobber](../ui-bugs/wxt-shadow-root-inline-style-clobber.md)）。

### 3. blur-close 键盘可达性：relatedTarget 包含判定

SourceSwitcher 的 GroupPill 用 blur 关闭固定分组。SelectionSearchPopup 的分组根 `onBlur` 检查 `relatedTarget` 是否仍在分组内（`rootRef.contains(related)`），是则不关。注意：子浮层是分组根的 DOM 子孙，`rootRef.contains` 已覆盖子浮层内的焦点移动，无需额外判 `sourcesRef`（冗余分支已在清理轮移除）。

### 4. 嵌套固定域 cascade：pin 子浮层时连带 pin 父浮层

SourceSwitcher 的分组 pill 在常驻栏中，pin 分组即足够。SelectionSearchPopup 的分组子浮层嵌套在主浮层内——主浮层 `open` 变 false 时 reset effect 清空 `openGroupId`/`pinnedGroupId`。若主浮层仅 hover 瞬态展开（`pinned=false`），移出后 150ms 收起会连带清除分组固定。

适配：`handleGroupToggle` 的两个固定分支同时 `cancelClose(); setPinned(true)` 把主浮层提升为固定。关闭分支不动主浮层固定态（点击=固定语义一致）。详见 [selection-popup-nested-pin-domain](../ui-bugs/selection-popup-nested-pin-domain.md)。

### 5. selectionchange 误杀压制：弹窗内 mousedown 不折叠选区

SourceSwitcher 不依赖页面选区。SelectionSearchPopup 由划词触发，选区留在页面上——点击弹窗内普通 div 的 mousedown 默认动作会折叠选区 → `selectionchange` → content script 无条件 `dismissPopup()` → React 树在 click 到达前卸载。`<button>` 的 mousedown 不折叠选区（Chromium 表单控件行为），所以 source 按钮从不触发。

适配双层防护：(1) 弹窗根 `onMouseDown={(e) => e.preventDefault()}` 从源头阻止选区塌陷（附带保持高亮可见）；(2) content script 的 `createInsidePointerGuard()` 记录 mousedown 是否在弹窗内，`handleSelectionChange` 压制弹窗内按压引起的选区塌陷。详见 [selection-popup-inside-click-selectionchange-dismissal](../ui-bugs/selection-popup-inside-click-selectionchange-dismissal.md)。

### 6. ARIA 菜单组合

SourceSwitcher 的分组行是 `role="button"`。SelectionSearchPopup 的主 flyout 是 `role="menu"`，分组行适配为 `role="menuitem"` + `aria-haspopup="menu"`，子浮层加 `role="menu"`，主展开按钮补 `aria-expanded`/`aria-haspopup="menu"`。分组根保留 `role="group"`（menu 的合法分组容器）。

## Why This Matters

每个适配点对应一个 shadow DOM 或嵌套结构特有的 bug 类。跳过任一项都会在真实浏览器复现一个已修过的 bug，而 jsdom 测试可能全绿（jsdom 无真实选区模型、无 shadow retargeting、无 selectionchange 时序）。把模式适配到新环境时，逐条审计这六个分歧点比"复制状态机然后跑测试"可靠——测试镜像的往往是 workaround 路径而非真实操作路径。

## When to Apply

- 把 hover-intent / click-to-pin 交互模式适配进 shadow DOM 弹窗
- 在 shadow DOM 内做外部点击关闭、键盘焦点管理、或依赖页面选区状态的浮层
- 嵌套浮层结构（子浮层的生命周期挂在父浮层上）

## Examples

composedPath 外部点击守卫（content script）与 cascade pin（组件）是两个最高频踩坑点，代码见上方 Guidance 第 1、4 条。完整实现见 `components/SelectionSearchPopup.tsx`（`handleGroupToggle`、`SelectionGroupItem`）与 `entrypoints/selection-search.content.ts`（`handleMouseDown`/`handleSelectionChange` + `createInsidePointerGuard`）。

## Related

- [source-switcher-click-to-pin](../ui-bugs/source-switcher-click-to-pin.md) — pin 状态机参考实现（pinnedGroupId、三分支 toggle、pinnedRef 守卫的 scheduleClose）。本文档是其适配到 shadow DOM 嵌套浮层的导向。
- [selection-popup-inside-click-selectionchange-dismissal](../ui-bugs/selection-popup-inside-click-selectionchange-dismissal.md) — 适配点 5 的完整 bug 记录。
- [selection-popup-nested-pin-domain](../ui-bugs/selection-popup-nested-pin-domain.md) — 适配点 4 的完整 bug 记录。
- [wxt-shadow-root-inline-style-clobber](../ui-bugs/wxt-shadow-root-inline-style-clobber.md) — 适配点 2 的 `:host { all: initial }` 背景与 dataset 方案。
- [testable-content-script-helpers-via-lib-extraction](../architecture-patterns/testable-content-script-helpers-via-lib-extraction.md) — `createInsidePointerGuard` 抽到 lib 的先例（entrypoint 在 vitest 下无法 import）。
- CONCEPTS.md `Pinned Group Flyout`、`Selection Search` — 领域词汇。
