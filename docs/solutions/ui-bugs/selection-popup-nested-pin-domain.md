---
title: "划词搜索弹窗：嵌套固定域——分组固定死于瞬态主浮层塌陷"
date: 2026-08-15
category: docs/solutions/ui-bugs/
module: SelectionSearchPopup
problem_type: ui_bug
component: frontend_stimulus
severity: medium
description: 划词搜索弹窗的分组点击固定（pin）在主浮层仅 hover 瞬态展开时无法存活：分组 pin 依赖主浮层 open 状态，主浮层 150ms hover-intent 关闭会触发 reset effect 清空分组状态。修复为点击固定分组时连带把主浮层提升为固定（cascade pin）。
symptoms:
  - hover 展开菜单后直接点击分组，移开鼠标后分组与主浮层整体消失（分组固定未生效）
  - 先点展开按钮（固定主浮层）再点分组则固定正常——分组 pin 存活依赖主浮层显式固定
  - 此前被 selectionchange 误杀弹窗的 bug 掩盖（点击分组整弹窗直接消失，根本观察不到分组能否固定）
root_cause: logic_error
resolution_type: code_fix
related_components:
  - Selection Search Popup
  - selection-search content script
tags:
  - selection-search
  - nested-pin
  - click-to-pin
  - transient-flyout
  - cascade-pin
  - hover-intent
---

# 划词搜索弹窗：嵌套固定域——分组固定死于瞬态主浮层塌陷

## Problem

划词搜索弹窗（`components/SelectionSearchPopup.tsx`）的分组子浮层支持点击固定（pin）：点击分组行 → 子浮层打开并固定，移出鼠标不收起。但分组 pin 存活在主浮层的 `open` 状态内——主浮层 `open` 变 false 时 reset effect 会清空 `openGroupId`/`pinnedGroupId`。当主浮层仅由 hover 瞬态展开（`pinned=false`）时，鼠标移出后 150ms hover-intent 关闭主浮层，连带清除分组固定，用户体感"点击分组无法固定"。

## Symptoms

- hover 展开菜单（不点展开按钮）→ 点击分组 → 移开鼠标 → 分组与主浮层整体消失。
- 先点展开按钮（主浮层显式固定）→ 再点分组 → 移开鼠标 → 分组保持展开（唯一能固定的路径）。
- 此 bug 自分组固定功能落地起就存在，但被 selectionchange 误杀弹窗的 bug 掩盖——点击分组时整个弹窗直接消失，根本观察不到分组能否固定。selectionchange 修复后才显形。

## What Didn't Work

- **只固定分组不固定主浮层**：`handleGroupToggle` 只设 `pinnedGroupId`，不碰主浮层 `pinned`。分组 pin 挂在一个随时会塌的瞬态屋顶上——主浮层 150ms 后收起，reset effect 清空分组状态。
- **测试未覆盖此路径**：所有分组固定测试都先 `openMainFlyout`（点击展开按钮显式固定主浮层）再操作分组，恰好绕过了"主浮层瞬态"的场景。测试绿但真实浏览器红——测试镜像了用户的 workaround 而非用户的实际操作路径。

## Solution

`handleGroupToggle`（`components/SelectionSearchPopup.tsx`）的两个产生固定分组的分支同时把主浮层提升为固定：

```tsx
const handleGroupToggle = (id: string) => {
  if (openGroupId === id) {
    if (pinnedGroupId === id) {
      // pinned → close
      setOpenGroupId(null);
      setPinnedGroupId(null);
    } else {
      // 瞬态展开 → 固定。分组固定依赖主浮层存活（主浮层关闭会重置分组状态），
      // 点击固定分组时连带把主浮层提升为固定，否则 hover 瞬态主浮层
      // 会在移出后 150ms 收起并连带清除分组固定。
      cancelClose();
      setPinned(true);
      setPinnedGroupId(id);
    }
  } else {
    // 收起 → 打开并固定（同样连带固定主浮层）。
    cancelClose();
    setPinned(true);
    setOpenGroupId(id);
    setPinnedGroupId(id);
  }
};
```

关闭分支（pinned → close）**不动主浮层固定态**——显式固定主浮层后再关分组，主浮层保持固定，与"点击=固定"语义一致：点击固定了的东西，需显式动作（展开按钮/Escape/外部点击）才能收起。

## Why This Works

根因是**嵌套固定域**：分组 pin 存活在主浮层 `open` 状态的生命周期内。主浮层有两种展开生命周期——hover 产生的瞬态展开（`pinned=false`，移出 150ms 收起）与点击产生的固定展开（`pinned=true`，移出不收起）。分组 pin 只在主浮层固定时才能存活，但 `handleGroupToggle` 只固定了分组、没固定主浮层，于是分组 pin 挂在一个随时会塌的瞬态屋顶上。

cascade pin 把"固定分组"这个用户意图向上传播：点击固定分组 ⟹ 主浮层也固定。这与"点击=固定"的交互语义一致——点展开按钮固定菜单、点分组固定分组+菜单。主浮层的 `scheduleClose` 定时器读 `pinnedRef.current`（render 期写入最新 `pinned`），cascade 后 `pinned=true` → 定时器不关闭 → reset effect 不触发 → 分组 pin 存活。

关闭分组时不动主浮层固定态：用户点击固定了主浮层（无论显式还是 cascade），收起分组后主浮层保持固定是自洽的——"点击固定"的东西需要显式关闭。Escape、外部点击、展开按钮都能关闭主浮层。

## Prevention

- **嵌套浮层的 pin 必须向上 cascade**：子浮层的 pin 存活依赖父浮层存活；点击固定子浮层时必须同时固定父浮层，否则父浮层的 hover-intent 关闭会连带清除子浮层状态。审计任何"子状态挂在父状态生命周期内"的设计：父关闭时子状态是否被 reset？如果是，子的 pin 是否向上传播？
- **测试必须覆盖用户的实际操作路径，而非 workaround**：所有分组固定测试都先 `openMainFlyout`（显式固定主浮层）再操作分组——这恰好绕过了"主浮层瞬态"的场景。补测：hover 瞬态打开主浮层 → 点击分组 → 移出展开区 + 超过延迟窗口 → 断言主浮层与分组均保持。此用例修复前必红。
- **被掩盖的 bug 在上层 bug 修复后会显形**：selectionchange 误杀弹窗时，点击分组整弹窗直接消失，根本观察不到分组能否固定。上层 bug 修复后，下层更细的交互缺陷才暴露——修复后应回归测试完整的用户操作路径（hover 打开 → 点击固定 → 移出 → 再点关闭 → Escape），而非只测"点击是否生效"。

## Related Issues

- [selection-popup-inside-click-selectionchange-dismissal](./selection-popup-inside-click-selectionchange-dismissal.md) — 同一弹窗的 selectionchange 误杀 bug；修复后才暴露本文档的嵌套固定域缺陷。
- [source-switcher-click-to-pin](./source-switcher-click-to-pin.md) — 快切栏的点击固定参考实现；快切栏的分组 pill 在常驻栏中（无外层瞬态容器），所以 pin 分组即足够，不存在嵌套固定域问题。
- CONCEPTS.md `Pinned Group Flyout` 条目——pin 的生命周期与关闭路径全集；本文档补充了 SelectionSearchPopup 特有的嵌套域 cascade 语义。
