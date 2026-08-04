---
title: "分类 pill 点击固定展开：统一顶栏与底栏的 pin 交互"
date: 2026-08-01
category: docs/solutions/ui-bugs/
module: SourceSwitcher
problem_type: ui_bug
component: frontend_stimulus
severity: medium
description: Source Group 分类 pill 点击固定（pin）交互在各模式下不一致：内联/搜索页点击无效仅 hover 展开，覆盖层可 toggle 但 hover 移出延迟关闭。修复为 pinnedGroupId 状态 + 三分支状态机 + 120ms 延迟关闭检查。
symptoms:
  - 内联/搜索页（非 overlayPosition）点击分类 pill 无反应，onClick 直接 return，仅 hover 展开且移开即收回
  - 覆盖层（overlayPosition/SERP 注入栏）点击可 toggle，但精指针 hover 移出后仍延迟关闭
  - 各模式展开行为不一致：同一次点击在内联不固定、在覆盖层固定
root_cause: logic_error
resolution_type: code_fix
related_components:
  - SERP Switch Bar
tags:
  - source-switcher
  - source-group-layout
  - serp-switch-bar
  - click-to-pin
  - hover-intent
  - pin-state
  - interaction-behavior
---

# 分类 pill 点击固定展开：统一顶栏与底栏的 pin 交互

## Problem

统一快切栏（components/SourceSwitcher.tsx）的分组分类 pill 有两套交互语义：覆盖层（overlayPosition，SERP 注入栏）点击可 toggle 展开，内联/搜索页（entrypoints/search/App.tsx）点击则无效——trigger 的 onClick 直接 return，只能 hover 展开，且鼠标一移出分组（120ms hover-intent 延迟）就收回。用户体感是"点击会导致收回而非固定，再点击、再移开还是会收回"。需求：点击分类后无论 hover 与否都保持展开（固定/pin），内联与覆盖层行为一致。

## Symptoms

- 顶栏/搜索页：点击分组 trigger 无任何语义（onClick 直接 return），展开只能靠 hover；鼠标移出后 120ms 延迟关闭，flyout 被收回。
- 顶栏：点击不会把展开"固定"住，精指针用户点一下想锁定菜单，结果一移开就收，必须一直按着/悬停。
- 底栏：点击可 toggle，但精指针下 hover 移出仍触发延迟关闭，与点击建立的"已展开"状态互相打架。
- 各模式交互不一致：同样的 trigger，点击语义在内联/搜索页是空操作、在覆盖层是 toggle；外部 pointerdown 关闭仅覆盖层启用。

## What Didn't Work

- 单一 `openGroupId` 状态承载所有展开：hover 瞬态展开与点击固定展开在状态上不可区分，`scheduleClose` 的 120ms 延迟关闭对两者一视同仁，无法做到"固定组不因 hover 移出而关闭"。
- 顶栏 onClick 直接 return：点击无语义，等于把唯一可靠的"锁定"手段交给用户时假装它有。
- 外部 pointerdown 关闭只挂在底栏：即使顶栏有了 pin，固定的浮层也无法通过点外部收起，模式行为继续分叉。
- 仅靠 `openGroupId` 判断"点击是否在展开状态下发生"也无法工作：hover 瞬态展开后点击，若按 toggle 处理会直接关闭，用户会以为点错了（点一下反而把 hover 出来的菜单点没了）。

## Solution

在 `openGroupId`（瞬态展开）之上新增 `pinnedGroupId` 状态（components/SourceSwitcher.tsx:67），不变量：`pinnedGroupId ≠ null ⟹ pinnedGroupId === openGroupId`（经 oracle 逐路径推演成立）。各模式共用同一套三分支 onToggle 状态机。

onToggle 三分支（父组件，SourceSwitcher.tsx:203）：

```tsx
onToggle={() => {
  if (openGroupId === item.group.id) {
    if (pinnedGroupId === item.group.id) {
      // 固定展开 → 关闭并取消固定。
      setOpenGroupId(null);
      setPinnedGroupId(null);
    } else {
      // 瞬态展开 → 固定（不关闭）。
      setPinnedGroupId(item.group.id);
    }
  } else {
    // 收起 → 打开并固定。
    setOpenGroupId(item.group.id);
    setPinnedGroupId(item.group.id);
  }
}}
```

onOpen（hover/focus）保持瞬态语义（SourceSwitcher.tsx:193）：单开语义下，固定的是别的组时清掉旧固定；hover 回原组不恢复固定（固定只能由点击产生）：

```tsx
onOpen={() => {
  setOpenGroupId(item.group.id);
  setPinnedGroupId((cur) => (cur === item.group.id ? cur : null));
}}
```

hover-intent 延迟关闭读取最新固定态（SourceSwitcher.tsx:336-360）：render 期把 `pinned` 写入 ref，setTimeout 回调只读 ref——固定组不因 hover 移出关闭，瞬态组 120ms 后照常收起：

```tsx
const pinnedRef = useRef(pinned);
pinnedRef.current = pinned;
const scheduleClose = () => {
  if (closeTimerRef.current != null) clearTimeout(closeTimerRef.current);
  closeTimerRef.current = setTimeout(() => {
    closeTimerRef.current = null;
    if (!pinnedRef.current) handleClose();
  }, 120);
};
```

显式关闭路径统一走 `handleClose` 本地包装（cancelClose + onClose，SourceSwitcher.tsx:346）：Escape、外部 pointerdown、blur、选中组内源都会先取消挂起的延迟关闭定时器，避免旧定时器到期后再触发幂等 onClose。外部 pointerdown 关闭（document capture + composedPath 判断 groupRef/flyoutRef 是否包含目标）从仅覆盖层扩展为各模式统一（SourceSwitcher.tsx:386-402）。

关闭路径全集：再点 trigger、Escape（焦点归还 trigger）、外部 pointerdown、选中组内源、scroll-hide（MutationObserver 观察 host data-hidden）、模式切换（overlayPosition 变化时清空两组状态）。

## Why This Works

根因是"展开"这个状态承载了两种生命周期：hover 产生的瞬态展开与点击建立的用户意图。单一 `openGroupId` 无法区分二者，于是所有关闭逻辑（hover 延迟关闭、外部点击、Escape）只能对它们无差别生效——这就是"点击无法固定、hover 移出即收回"的机制来源。

拆分出 `pinnedGroupId` 后，pin 成为独立、可显式建立/撤销的状态：

- 点击固定由三分支状态机显式建立，撤销路径全部枚举（再点/Escape/外部点击/选中组内源/scroll-hide/模式切换），不再依赖 hover 的隐式生命周期；
- 延迟关闭只在 `!pinnedRef.current` 时生效，把"hover 移出"这个信号的效力限制在瞬态展开上；
- `pinnedRef` 用 render 期写入 + 事件回调读取的 ref 模式，天然拿到最新固定态，且不引发重渲染；
- 固定组 hover 移出不关闭后，用户必须靠显式动作收起，因此所有显式关闭路径都必须存在且先 cancelClose——`handleClose` 包装保证旧定时器不会在关闭后"补刀"；
- 不变量 `pinned ⟹ open` 由三分支 + onOpen 清旧固定共同维持：pinned 只在"打开并固定"或"瞬态转固定"时设置，onOpen 只能清掉别的组的 pin，hover 回原组无法重新固定，单开语义（同一时刻最多一个组展开、最多一个 pin）全程成立。

## Prevention

- 组件级行为测试覆盖 pin 全状态机：tests/SourceSwitcher.test.tsx 删除旧断言"顶栏点击不打开"，新增独立 `describe('SourceSwitcher — click pin (top bar / search page)')` 的 7 个用例——点击开+固定且 hover 移出不关、再点关闭；瞬态展开中点击转固定（不关闭）；Escape 关闭固定；外部 pointerdown 关闭固定/瞬态；单开语义（hover 别的组清除固定且 hover 回不恢复）；trigger/浮层内部 pointerdown 不关闭守卫。vitest 全量 791 通过（SourceSwitcher 35 个）。
- 对含"瞬态 vs 固定"双生命周期的 UI 状态，优先拆两个状态并在组件头注释写明不变量，而不是给单一状态加 flag 堆分支——单一状态加 flag 无法在 render 期区分两种来源。
- 事件回调里读"最新状态"一律走 ref（render 期写入、回调只读），不要闭包捕获 stale 值。
- 新增显式关闭路径时，检查是否与延迟关闭/延迟打开定时器冲突：凡显式路径都必须先 cancelClose，并配套卸载清理（useEffect(() => () => cancelClose(), [])）。
- 各模式共享的交互语义（点击 pin）放到共享组件实现，避免"内联一个行为、覆盖层一个行为"的模式分叉；模式差异（锚定方向、粗指针禁用 hover）留在 overlayPosition 分支内。

## Related Issues

- [serp-bar-bottom-position-and-scroll-hide](../architecture-patterns/serp-bar-bottom-position-and-scroll-hide.md) — 锚点文档：§4d-4f 记录了本次改动所扩展的同一浮层状态机（hover-intent 120ms、touch focus/click 竞态、shadow-safe 外部关闭、scroll-hide 关浮层）。其 §4d/§4e 的代码示例与表述已随本次改动同步刷新（统一为各模式 / overlayPosition）。
- [source-group-layout-layer](../architecture-patterns/source-group-layout-layer.md) — Source Group Layout 布局层（pinned 平铺 vs grouped 折叠、projectLayout），pill 的交互描述（"hover flyout"）未包含点击固定语义。
- [serp-switch-bar-and-unified-source-model](../architecture-patterns/serp-switch-bar-and-unified-source-model.md) — 两宿主（搜索页顶栏 vs shadow-DOM SERP 栏）结构与 projectLayout seam 的结构背景。
- [serp-bottom-bar-body-mount](../ui-bugs/serp-bottom-bar-body-mount.md) — 底栏 flyout 的几何/层级背景（body mount、z-index max、group-flyout--fixed-up）。
- 仓库架构说明：docs/plans/2026-07-01-001-juso-search-plan.md、CONCEPTS.md
