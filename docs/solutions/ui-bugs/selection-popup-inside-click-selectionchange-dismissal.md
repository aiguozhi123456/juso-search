---
title: "划词搜索弹窗：selectionchange 误杀——弹窗内点击普通 div 塌陷选区触发关闭"
date: 2026-08-14
category: docs/solutions/ui-bugs/
module: SelectionSearchPopup
problem_type: ui_bug
component: frontend_stimulus
severity: medium
description: 划词搜索弹窗的分组点击固定功能在真实浏览器中点击分组容器即整个弹窗消失。根因是 content script 的 selectionchange 关闭路径对任何选区塌陷无条件 dismissPopup——点击普通 div 的 mousedown 默认动作折叠划词选区，click 到达前 React 树已被卸载。jsdom 测试全绿但真实浏览器失败。
symptoms:
  - 真实浏览器中点击分组容器（普通 div），整个弹窗立即消失，与点击空白处几乎无区别（仅不会点到弹窗下方的链接）
  - 组件测试（jsdom）全绿：pin 状态机、onClick 范围、容器点击 toggle 用例都通过，但真实浏览器仍复现
  - 点击 source 按钮（button 元素）从不触发该问题，只有点击普通 div 区域（分组容器、行背景、弹窗 padding）触发
root_cause: logic_error
resolution_type: code_fix
related_components:
  - Selection Search Popup
  - selection-search content script
tags:
  - selection-search
  - selectionchange
  - content-script
  - shadow-dom
  - event-timing
  - mousedown-default-action
  - jsdom-blind-spot
---

# 划词搜索弹窗：selectionchange 误杀——弹窗内点击普通 div 塌陷选区触发关闭

## Problem

划词搜索弹窗（components/SelectionSearchPopup.tsx）加入分组点击固定（click-to-pin）后，真实浏览器中点击分组（`.juso-sel-group` 容器）整个弹窗直接消失，表现与点击空白处几乎一样。第一轮修复把 onClick 从分组行移到容器（扩大点击识别范围）完全无效——因为杀死弹窗的不是 click 识别范围，而是 click 之前的 selectionchange 关闭路径。

## Symptoms

- 点击分组容器 → 弹窗立即消失，onClick toggle 永远不生效（或生效后随即被卸载）。
- 对照组永不复现：source 按钮、展开按钮、主 chip 全是 `<button>`；Chromium 对表单控件的 mousedown 不执行"折叠选区到光标"的默认动作（富文本编辑器工具栏全用 `<button>` 保选区就是这个原理）。
- jsdom 全绿：17+ 个组件用例（pin 状态机、容器点击 toggle、守卫）都通过，真实浏览器照样失败。
- 同类未爆雷表面：主浮层背景 padding、bar 空隙、expand-area 的 div 本体——全是普通 div，一样会塌陷选区。

## What Didn't Work

- 把 onClick 从 `.juso-sel-group-row` 移到容器 `.juso-sel-group`（扩大点击识别范围）：无效。事件时序上 selectionchange 排在 click 之前，React 树在 click 到达前已被卸载（见下）。
- 假设"shadow DOM retarget 导致 contains 误判外部点击"：审计后排除。所有 document 级监听都正确使用 `event.composedPath().includes(mountedHost)`；组件内的 `.contains(e.target)` 都发生在 React 合成事件里（委托挂在 shadow root 内部 wrapper 上，e.target 是真实节点），判定正确。
- 组件级 jsdom 测试：三重盲区叠加——(1) 杀弹窗的代码在 entrypoint，webextension-polyfill 在 vitest 下无法 import；(2) jsdom 无真实选区模型，fireEvent 不改变 selection、从不派发 selectionchange；(3) 无 shadow DOM，retargeting/composedPath 从未被演练。被测的状态机是对的（所以绿），杀人的集成层完全没被测（所以红在浏览器）。

## Solution

完整时序（修复前）：

```
pointerdown（组件监听放行）
mousedown（content script composedPath 守卫放行；默认动作：划词选区折叠 → 排队 selectionchange task）
selectionchange task → getSelection().isCollapsed === true → dismissPopup() → root.unmount()
mouseup / click → 节点已分离，React onClick 不触发
```

三层修复：

1. **决策逻辑抽离（lib/selection-search-dismiss.ts）**：`createInsidePointerGuard()` 持 `pointerInsidePopup` 标志——`noteMouseDown(composedPath, host)` 记录并返回 mousedown 是否在弹窗内；`shouldSuppressSelectionDismiss()` 供 selectionchange 查询；`clear()` 防陈旧。抽到 lib 的原因沿用 lib/selection-search-position.ts 先例：entrypoint 无法在 vitest 下 import。
2. **content script 接入（entrypoints/selection-search.content.ts）**：`handleMouseDown` 用 guard 记录内/外（内部 → 记录 true 并放行；外部 → 记录 false 并 dismiss）；`handleSelectionChange` 在 `mountedHost` 守卫后加 `if (guard.shouldSuppressSelectionDismiss()) return;`——弹窗内指针按下引起的选区塌陷不关闭弹窗；`handleMouseUp` 的弹窗内分支 return 前 `guard.clear()`（selectionchange task 在 mousedown 默认动作后、mouseup 前派发，此处清除不早于压制窗口；外部交互必先过外部 mousedown → dismiss，无泄漏）。一次性覆盖分组容器、分组行、主浮层背景、bar 空隙全部同类表面。
3. **源头双保险（components/SelectionSearchPopup.tsx）**：`.juso-sel-popup` 根 div `onMouseDown={(e) => e.preventDefault()}`——直接阻止选区塌陷，附带 UX 收益：点击弹窗时划词高亮保持可见（Chrome 划词菜单的标准模式）。代价：Windows 上被覆盖控件的 click-focus 被抑制（Tab 键盘焦点不受影响）；preventDefault 抑制 click-focus，鼠标用户按 Escape 时焦点不在 shadow 树内、走 document 级路径关整弹窗，分组行 toggle 时主动 focus() 恢复分组级 Escape 分层。

测试：

- tests/selection-search-dismiss.test.ts（新建，5 用例）：内部 mousedown → 压制；外部 → 不压制；host null → 不压制；clear() 恢复；连续 mousedown 以最后一次为准。
- tests/SelectionSearchPopup.test.tsx 新增：对弹窗根与分组根 dispatch 真实 `new MouseEvent('mousedown', { bubbles: true, cancelable: true })`，断言 `ev.defaultPrevented === true`——jsdom 里唯一能抓住"选区塌陷被阻止"的可行断言（触发器本身无法用 fireEvent 复现，只能验证 preventDefault 与决策逻辑）。

## Why This Works

- 症状指纹与机制吻合："与点空白几乎一样、但不点下面的链接"——空白点击走 document mousedown 直接 dismiss；分组点击走 selectionchange 同样 dismiss；唯一差别是弹窗 div 拦截了 hit-testing。
- 守卫按"类"处理而非逐表面打补丁：任何弹窗内 mousedown 引起的选区塌陷都被压制，未来再加普通 div 点击目标自动受保护。
- 主防护是 preventDefault（从源头消除触发器，不依赖事件顺序），guard 从集成层兜底（不依赖组件记得 preventDefault）——guard 兜层的 clear 时机依赖「selectionchange task 先于 mouseup」的引擎时序（规范任务排队下成立），时序异常时仅兜层减弱、主防护不受影响。
- 压制窗口有界：只在"内部 mousedown 之后、下一次 mouseup 之前"生效，外部划词重新触发弹窗、Escape、外部点击关闭等路径不受影响。

## Prevention

- 弹窗/浮层内新增可点击元素：默认用 `<button>`；若必须用 div，给浮层根加 `onMouseDown={(e) => e.preventDefault()}`，否则 mousedown 默认动作会塌陷选区并可能触发任何 selectionchange 监听的关闭逻辑。
- 跨 shadow DOM 判断"事件是否来自组件内部"：document 级监听一律 `event.composedPath().includes(host)`，不要 `contains(e.target)`（会被 retarget 成 host）。
- content script 的事件决策逻辑抽到 lib/（先例：selection-search-position.ts、selection-search-dismiss.ts），才能被 vitest 覆盖；entrypoint 本体在测试体系外，jsdom 也无法模拟真实选区时序。
- jsdom 组件测试全绿 ≠ 真实浏览器可用：涉及选区、焦点、shadow retargeting、事件默认动作的交互，用真实事件对象 dispatch + `defaultPrevented` / composedPath 断言，并保留浏览器手测清单（划词 → 展开 → 点分组固定 → 移出 → 再点关闭 → Escape → source 搜索）。
- 给"依赖选区存在"的 UI（划词弹窗）加关闭路径时，逐条枚举触发源并问：这条路径会把"弹窗内部交互引起的选区变化"误判为"用户放弃了选区"吗？

## Related Issues

- [testable-content-script-helpers-via-lib-extraction](../architecture-patterns/testable-content-script-helpers-via-lib-extraction.md) — 本条目第二次沿用该先例（第三次抽离：selection-search-dismiss）。
- [source-switcher-click-to-pin](../ui-bugs/source-switcher-click-to-pin.md) — pin 功能给分组行加上 onClick 语义，使这个潜伏 bug（原始分组行只有 CSS hover）首次暴露；其"事件回调读最新状态走 ref"模式与本修复无关但同属浮层交互族。
- [wxt-shadow-root-inline-style-clobber](../ui-bugs/wxt-shadow-root-inline-style-clobber.md) — 同一划词搜索弹窗的 shadow DOM 记录。
- 已知未做（产品决策）：pin 状态未外漏给 content script（组件 → content 仅有 onSearch 单向回调），主浮层 pinned 时外部 selectionchange 仍会关闭；如需"固定后选区塌陷不杀弹窗"，可加 `onPinChange?.(pinned: boolean)` prop 让 handleSelectionChange（仅此路径）跳过关闭。
- 仓库架构说明：docs/plans/2026-07-01-001-juso-search-plan.md、CONCEPTS.md
