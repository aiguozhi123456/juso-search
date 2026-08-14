---
title: 划词搜索浮层不可见：WXT shadow root host 的 all:initial 重置吞掉内联定位
date: 2026-08-14
category: docs/solutions/ui-bugs/
module: selection-search content script（划词搜索）
problem_type: ui_bug
component: frontend_stimulus
severity: high
description: "划词搜索浮层经 WXT createShadowRootUi 挂载后完全不可见：WXT 向每个 shadow root 注入 `:host{all:initial !important}`，把宿主元素上的内联 position/left/top/zIndex 全部重置，宿主塌陷进普通文档流。修复：定位改到 shadow root 内层 wrapper div（host 重置够不着），host 保持零尺寸（position:static !important; overflow:visible）。同批修复：删除 cssInjectionMode:'ui'（css 字符串常量不是可加载的 CSS 文件）、position:absolute + 页面坐标跟随选区、两层 hover-intent 150ms 延迟关闭、epoch 计数防 ui.mount() 竞态。"
symptoms:
  - 划词后浮动浮层完全不可见——宿主元素被 WXT 注入的 `:host{all:initial !important}` 重置清掉内联 position/left/top/zIndex，塌陷进普通文档流
  - defineContentScript 加 cssInjectionMode:'ui' 后运行时报错 [wxt] Failed to load styles @ .../selection-search.css，实际传给 createShadowRootUi 的 css 是字符串常量而非真实 CSS 文件
  - 浮层用 position:fixed 时随视口滚动偏离选区位置，需要跟随页面坐标（x+scrollX, y+scrollY）
  - 子 flyout 在鼠标到达前就收起（hover gap），需要两层 CSS flush + 150ms 延迟关闭/重入取消
  - 快速连续两次划词可导致 ui.mount() 被重复调用产生孤儿 React root（异步竞态）
root_cause: wrong_api
resolution_type: code_fix
related_components:
  - WXT createShadowRootUi
  - SERP switch bar hover-intent
tags:
  - selection-search
  - wxt
  - shadow-root
  - shadow-host-css-reset
  - css-injection-mode
  - hover-intent
  - position-absolute
  - async-race-guard
---

# 划词搜索弹窗：WXT shadow-root 定位、hover 穿缝、滚动固定与异步挂载竞态修复

## Problem

Chrome MV3 扩展（WXT + React + TypeScript，juso-search）的划词搜索（selection search）弹窗（`entrypoints/selection-search.content.ts` + `components/SelectionSearchPopup.tsx`）在真实使用中暴露出一组相互纠缠的缺陷：弹窗初始不可见（被 WXT 注入的 `:host { all: initial !important }` 覆盖了宿主内联定位样式）、扩展浮层在鼠标穿过缝隙时提前收回、滚动后弹窗"消失"、以及快速连选时挂载两次导致双重弹窗与内存泄漏。用户可见影响是：选中文字后要么完全没有弹窗，要么弹窗一闪而过、要么浮层无法保持展开，划词搜索在多数页面上不可用。

## Symptoms

- 弹窗完全不渲染/渲染在屏幕外：选中文本后没有任何可见 UI；`position: fixed; left: …px; top: …px` 全部失效，宿主坍缩成 `display: inline` 的零尺寸元素，被布局到 `<html>` 末尾的文档流中。
- 运行时样式加载报错（在尝试 `cssInjectionMode: 'ui'` 后出现）：
  `[wxt] Failed to load styles @ chrome-extension://<id>/content-scripts/selection-search.css. Did you forget to import the stylesheet in your entrypoint? TypeError: Failed to fetch`
- 展开浮层（expand flyout）在鼠标从主 chip 移向浮层的过程中收回：触发区与浮层之间存在 `margin-top: 4px` 缝隙，越过缝隙即触发 `mouseleave`，浮层在鼠标到达前消失。
- 滚动即消失：用户报告"鼠标向下滚动一下，弹窗就不见了"（position: fixed 时弹窗浮在视口，滚动后与所选文字脱节；修复后用户进一步要求"弹窗停在选中位置、随页面滚动"）。
- 快速连续选中（连选两次）出现两个叠加弹窗，且内存泄漏：`onMount` 被无条件重复执行，前一次创建的 React root 与 DOM 节点成为孤儿。

## What Didn't Work

- 直接在 shadow host（`shadowHost`）上设 inline 样式定位：`shadowHost.style.position = 'fixed'; shadowHost.style.zIndex = '2147483646'; shadowHost.style.left/top = ...px`。作者普通 inline 样式（normal 优先级）打不过 WXT 注入进每个 shadow root UI 的 `:host { all: initial !important }`（author `!important` 规则），定位全被复位，弹窗不可见。
- 增加 `cssInjectionMode: 'ui'`（照搬 read-frog 的"import CSS 文件"模式）：本项目样式是字符串常量 `selectionSearchStyles` 直接传给 `createShadowRootUi` 的 `css` 选项，而不是以 `import './x.css'` 方式引入的样式文件；WXT 因此以为存在 `content-scripts/selection-search.css` 并生成 fetch 引用，运行时文件不存在，抛 `Failed to load styles`。
- 直接删除"滚动即关闭"的 dismiss 监听来"修"滚动消失：只消除了误关，但 `position: fixed` 本身导致弹窗钉在视口、滚动后与所选文字脱节，体验仍错误（该"修复"随后被正确方案取代）。
- 单一挂载入口不做守卫：`showPopup` 每次无条件走到 `ui.mount()`，`onMount` 内部 `createRoot(wrapper)` 重复执行，产生孤儿 root 与叠加弹窗。

## Solution

一组独立的修复，各自针对一个根因；全部落在 `entrypoints/selection-search.content.ts`、`components/SelectionSearchPopup.tsx`、`entrypoints/shared/selection-search-styles.ts`、`lib/selection-search-position.ts`。

### 1. Shadow host 零尺寸 reset + 内层 wrapper 定位（Bug 1 + Bug 4 定位）

位置样式不再设在 host 上，而是放在 shadow root 内部的 `<div>` wrapper 上。shadow CSS 先让 host 保持零尺寸、static、overflow visible（使内部 absolute wrapper 的子元素可以在视口任意位置绘制）：

```css
/* entrypoints/shared/selection-search-styles.ts */
/* WXT 注入 :host { all: initial !important } 会覆盖 host 的 inline 样式。
   保持 host 零尺寸 + static + overflow:visible，让内部 wrapper（position:absolute）
   的子元素可以在视口任意位置绘制。 */
:host {
  display: block !important;
  width: 0 !important;
  height: 0 !important;
  overflow: visible !important;
  position: static !important;
}
```

`onMount` 中在内部 wrapper 上设 `position: absolute`（随页面滚动）+ `left/top`（页面坐标）+ `zIndex`，React root 挂到 wrapper 上：

```ts
// entrypoints/selection-search.content.ts
onMount(uiContainer, _shadow, shadowHost) {
  const state = popupState;
  if (!state) return { root: null as unknown as Root };
  // 不在 shadowHost 上设 position/left/top——WXT 注入的 :host { all: initial !important }
  // 会覆盖 inline 样式。改为在内部 wrapper 上设 position:absolute（host reset 触达不到内部元素）。
  shadowHost.dataset.theme = state.theme;
  shadowHost.dataset.style = state.stylePref;
  shadowHost.dataset.flyoutUp = state.flyoutUp ? 'true' : 'false';
  shadowHost.dataset.subFlyoutLeft = state.subFlyoutLeft ? 'true' : 'false';
  mountedHost = shadowHost;
  const wrapper = document.createElement('div');
  wrapper.style.position = 'absolute';
  wrapper.style.zIndex = '2147483646';
  wrapper.style.left = `${state.x}px`;
  wrapper.style.top = `${state.y}px`;
  uiContainer.append(wrapper);
  const root = createRoot(wrapper);
  root.render(/* <SelectionSearchPopup … /> */);
  return { root };
},
```

定位从视口坐标转为页面坐标（`position: absolute` 随页面滚动，不随视口固定）：

```ts
const pos = computePosition(mouseX, mouseY);
// 转为页面坐标：position:absolute 随页面滚动，不随视口固定。
const subFlyoutLeft = pos.x + 520 > window.innerWidth;
popupState = {
  // …
  x: pos.x + window.scrollX,
  y: pos.y + window.scrollY,
  flyoutUp: pos.flyoutUp,
  subFlyoutLeft,
};
ui.mount();
```

### 2. 移除 `cssInjectionMode: 'ui'`（Bug 2）

删除 `defineContentScript` 中的 `cssInjectionMode: 'ui'`。`createShadowRootUi` 的 `css` 选项独立工作，不依赖 cssInjectionMode；字符串常量样式无需构建成物理 CSS 文件。

### 3. 无缝隙浮层 + hover-intent 延迟关闭（Bug 3）

CSS 上浮层紧贴触发区底边（`top: 100%`、无 margin 缝隙），呼吸间距由内部 `padding-top` 提供：

```css
/* 紧贴 expand-area 底边（top:100%，无 margin 缝隙）：穿缝会触发 mouseleave
   把浮层提前收回。呼吸由内部 padding-top 提供（同快切栏 group-flyout 模式）。 */
.juso-sel-flyout {
  position: absolute !important;
  left: 0 !important;
  top: 100% !important;
  min-width: 180px !important;
  max-width: 240px !important;
  background: var(--bg) !important;
  border: 1px solid var(--border) !important;
  border-radius: var(--radius) !important;
  box-shadow: var(--shadow) !important;
  padding: 4px !important;
  padding-top: 6px !important;
  z-index: 1 !important;
}
```

JS 上复用快切栏 SourceSwitcher 的 hover-intent 模式（见 Related Issues）：150ms 延迟关闭，重新进入取消关闭：

```tsx
// components/SelectionSearchPopup.tsx
const cancelClose = useCallback(() => {
  if (closeTimerRef.current != null) {
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }
}, []);

const scheduleClose = useCallback(() => {
  if (closeTimerRef.current != null) clearTimeout(closeTimerRef.current);
  closeTimerRef.current = setTimeout(() => {
    closeTimerRef.current = null;
    setOpen(false);
  }, 150);
}, []);

useEffect(() => () => cancelClose(), [cancelClose]);
// …
<div
  className="juso-sel-expand-area"
  onMouseEnter={() => { cancelClose(); setOpen(true); }}
  onMouseLeave={scheduleClose}
>
```

### 4. Epoch 计数器守卫异步挂载竞态（Bug 5）

`showPopup` 在 await 配置加载期间可能被新的选中事件打断；epoch 让过期的 `showPopup` 在 await 之后自动退出，不再二次 `ui.mount()`：

```ts
let showEpoch = 0;

async function showPopup(text: string, mouseX: number, mouseY: number) {
  dismissPopup();
  currentQuery = text;
  const epoch = ++showEpoch;
  try {
    const [config, themePref, stylePref, localePref, fixedSourceId] = await Promise.all([
      sendMessage('getProviderConfig', undefined),
      getThemePref(),
      getStylePref(),
      getLocalePref(),
      getSelectionSearchSource(),
    ]);
    if (epoch !== showEpoch) return; // 被更新的 showPopup 取代
    // … 构建 popupState …
    ui.mount();
  } catch {
    // 配置加载或挂载失败——静默不弹窗。
  }
}
```

### 5. 分组侧边级联子浮层 + 边缘翻转 + 选区折叠关闭（Bug 6）

分组源列表改为悬停分组行时向右展开的级联子浮层（`position: absolute; left: 100%; top: 0`），由 CSS `:hover`/`:focus-within` 驱动，替代内联手风琴：

```css
.juso-sel-group-sources {
  display: none !important;
  position: absolute !important;
  left: 100% !important;
  top: 0 !important;
  min-width: 180px !important;
  max-width: 240px !important;
  background: var(--bg) !important;
  border: 1px solid var(--border) !important;
  border-radius: var(--radius) !important;
  box-shadow: var(--shadow) !important;
  padding: 4px !important;
  padding-left: 6px !important;
  z-index: 2 !important;
}
.juso-sel-group:hover > .juso-sel-group-sources,
.juso-sel-group:focus-within > .juso-sel-group-sources {
  display: block !important;
}
```

视口右缘翻转：弹窗靠近右缘（`pos.x + 520 > window.innerWidth`）时在 host 上打 `data-sub-flyout-left="true"`，CSS 把子浮层翻到左侧：

```css
/* 边缘翻转：弹窗靠近视口右侧时，子浮层向左展开。 */
:host([data-sub-flyout-left="true"]) .juso-sel-group-sources {
  left: auto !important;
  right: 100% !important;
  padding-left: 4px !important;
  padding-right: 6px !important;
}
```

主 chip 统一放大镜 SVG（strokeWidth 1.5、14px，与展开箭头一致），去掉 favicon/文字/品牌底色，`aria-label` + `title` 传源名：

```tsx
<button
  type="button"
  className="juso-sel-primary"
  onClick={() => onSearch(primarySource)}
  title={sourceLabel(primarySource, t)}
  aria-label={sourceLabel(primarySource, t)}
>
  <svg className="juso-sel-search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <circle cx="7" cy="7" r="5" />
    <path d="M10.5 10.5 L14 14" strokeLinecap="round" />
  </svg>
</button>
```

选区折叠时关闭弹窗，用 `mountedHost` 守卫避免每次 selectionchange 都做多余处理：

```ts
function handleSelectionChange() {
  if (!mountedHost) return;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) dismissPopup();
}
```

## Why This Works

- **host 零尺寸 + 内部 wrapper 定位**：WXT 对每个 shadow root UI 注入 `:host { all: initial !important }`，`!important` 的 author 规则在级联中胜过普通 inline 样式，所以凡是在 host 元素上设的 inline 定位都会被复位——这就是 Bug 1 的根因。`all: initial` 只作用于 host 自身，不进入 shadow root 内部；把 `position/left/top/zIndex` 放到内部 wrapper 后，再叠加 `:host { position: static; width:0; height:0; overflow:visible }` 让 host 成为零尺寸锚点，wrapper 便能在视口任意位置以 absolute 定位绘制。这也顺带消灭了"弹窗出现在文档末尾"的幽灵。
- **移除 cssInjectionMode 即可**：`cssInjectionMode: 'ui'` 让 WXT 认为 content script 有 `import '*.css'`，从而生成物理 CSS 文件的 fetch 引用；而本项目的样式是 `css` 选项里传入的字符串常量，不存在该文件，于是运行时报 `Failed to load styles`。`css` 选项与 cssInjectionMode 无关，去掉它即恢复。
- **无缝隙 + hover-intent**：`margin-top: 4px` 的缝隙是 mouseleave 的"缝隙"，鼠标穿过时触发 `mouseleave` 使浮层收回；`top:100%` 无缝贴合后鼠标路径上不再有非热区，内部 `padding-top` 提供视觉呼吸而不产生事件缝隙。150ms 延迟关闭 + 重新进入取消关闭，让指针短暂滑出又滑回也不会闪断（与 SERP 快切栏同一 hover-intent 模式）。
- **absolute + 页面坐标**：`position: fixed` 相对视口，滚动后弹窗钉在屏幕位置上、与所选文字脱节（用户最初感知为"弹窗不见了"）；`position: absolute` 相对 `document.documentElement`，用 `pos.x + window.scrollX / pos.y + window.scrollY` 把视口坐标转页面坐标后，弹窗随页面滚动停在被选文字附近。
- **epoch 守卫**：WXT 的 `mount()` 不检查是否已挂载，`onMount` 无条件执行；两次快速 `showPopup` 的 await 段交错，旧的一次 await 完成后再 `ui.mount()`，就会二次 `createRoot(wrapper)` 产生孤儿 root + 叠加弹窗。epoch 使旧调用在 await 后自检退出，只有最新的一次能 mount。
- **子浮层用 CSS 而非 JS 状态**：`:hover`/`:focus-within` 级联天然在指针路径上保持展开，不需要 JS 事件桥接，也支持键盘 focus；`data-sub-flyout-left` 走 host attribute，CSS 一行翻转，不引入 JS 分支。

## Prevention

- 永远不要在 shadow host 元素上设置 inline 定位样式——WXT 的 `:host { all: initial !important }` 必然覆盖。位置必须放在 shadow root 内部的 wrapper（或任何内部元素）上；host 保持零尺寸 + static + overflow:visible 作为锚点。`onMount` 里加注释说明这一约束。
- 新增 `defineContentScript` 配置（如 `cssInjectionMode`）后，运行 `npm run build` 并检查 `.output/chrome-mv3/` 的 manifest 与生成产物：确认它不会为不存在的物理资源生成引用（本类 `Failed to load styles @ chrome-extension://…/content-scripts/xxx.css` 错误即来自产物引用与真实文件不一致）。
- 凡"浮层/菜单"类 UI：热区之间不得有 margin/非热区缝隙（用内部 padding 代替），并配套 hover-intent 延迟关闭（scheduleClose/cancelClose）与卸载清理；否则鼠标穿过缝隙必然触发提前收回。
- 涉及 async 前置（读配置/发消息）再挂载 UI 的流程，用 epoch（或等价 generation/abort）计数器在 await 之后校验是否仍是最近一次调用；不要依赖 WXT `mount()` 的幂等性（它不守卫重复 mount）。
- 图标视觉一致性：同一 UI 内并排的图标保持相同尺寸与 strokeWidth（主 chip 放大镜与展开箭头均为 14px / strokeWidth 1.5）；统一图标时去掉文字/品牌底色，用 `aria-label` + `title` 承担可访问性与悬停提示。
- 视口边缘翻转类逻辑放到 host attribute + CSS 规则里（`data-sub-flyout-left`），保持 JS 只算几何、CSS 负责表现。
- 定位纯函数（`lib/selection-search-position.ts`）保持无浏览器依赖、可单测，viewport 尺寸走参数注入。

## Related Issues

- [source-switcher-click-to-pin](../ui-bugs/source-switcher-click-to-pin.md) — 本次 Bug 3（hover 穿缝）复用其文档化的 hover-intent 两段式模式（无 margin 缝隙贴合 + 延迟关闭/取消关闭定时器）；本次的 `scheduleClose`/`cancelClose` 与其 `pinnedGroupId` 状态机共享同一"指针热区 + 定时器"结构。
- [serp-bar-bottom-position-and-scroll-hide](../architecture-patterns/serp-bar-bottom-position-and-scroll-hide.md) — SERP 快切栏浮层状态机（hover-intent 120ms、touch focus/click 竞态、shadow-safe 外部关闭、scroll-hide 关浮层）是划词弹窗交互的姊妹文档；group-flyout 的"无缝贴合 + padding 呼吸"与 `data-flyout-up` 翻转写法在此均有对应。
- [serp-bar-engine-specific-anchors](../ui-bugs/serp-bar-engine-specific-anchors.md) — WXT `:host { all: initial !important }` host-reset 陷阱的既有文档，其预防规则是"在 shadow CSS 里 restore host + 用 namespaced CSS custom properties 传动态值"；本学习证明了浮层类 UI 的更简单逃生路径——host 零尺寸 static + 内部 wrapper 定位（reset 只作用于 host 元素本身）。两者是同一陷阱的两种解法，非矛盾。
- [context-menu-mv3-worker-lifecycle](../logic-errors/context-menu-mv3-worker-lifecycle.md) — 姊妹"选中文本 → 搜索"入口（右键菜单 vs 划词弹窗），共享 serp-handoff / allSources / buildSafeSearchUrl 管线与 worker 消息开标签（openNewTab / openSearchPageNewTab），但缺陷领域不同。
- [serp-switch-bar-and-unified-source-model](../architecture-patterns/serp-switch-bar-and-unified-source-model.md) — createShadowRootUi / shadow-DOM 注入基础架构（data-theme 自包含 token stylesheet、host data-* attribute bridge）；划词弹窗复用了该模式并新增 data-flyoutUp / data-subFlyoutLeft 标志。
- 仓库架构说明：docs/plans/2026-07-01-001-juso-search-plan.md、CONCEPTS.md。
