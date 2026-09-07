---
title: 演示页复用真实样式的三层模式：全局引入 / 真实类名 / shadow root 注入
date: 2026-09-08
category: docs/solutions/design-patterns/
module: onboarding demos（引导页演示）
problem_type: design_pattern
component: frontend_stimulus
severity: low
applies_when:
  - "预览/示意/mock 页面必须追踪真实产品样式（onboarding、教程页、组件展示框）"
  - "真实样式以 shadow-root 样式字符串形态存在（弹窗类 content script UI 天然如此）"
  - "页面防御性 !important 重置不允许真实样式进入 light DOM"
  - "发现自己在示意样式里成组重抄真实规则时"
tags: [shadow-root, style-reuse, css-drift, onboarding, demo-pages, single-source]
---

# 演示页复用真实样式的三层模式：全局引入 / 真实类名 / shadow root 注入

## Context

引导页 `entrypoints/onboarding/` 含 5 个纯 CSS 动画示意，逐一复刻真实产品 UI（搜索框打字、API key 行、快切栏、划词弹窗、来源布局编辑器）。原本每个示意都**重 declare** 了真实样式表的近似拷贝——从 `entrypoints/search/styles.css`、`entrypoints/options/styles.css`、`entrypoints/shared/selection-search-styles.ts` 抄来几十组规则。这类拷贝在真实 UI 每次变动时静默漂移：示意向用户展示的不再是产品现状，而是一份过时快照，且没有任何测试或报错会提醒。

本次重构把拷贝替换为三层复用模式，示意与真实 UI「构造上同步」：

1. **全局引入**：`entrypoints/onboarding/main.tsx` 直接 import 真实页级样式表，真实组件类页内全域可解析；
2. **真实类名**：示意 markup 直接建在真实类名上，只留少量带注释的小型覆盖组；
3. **shadow root 注入**：light DOM 装不下真实样式时（划词弹窗），示意自建 shadow root，注入**真实样式字符串**——与生产 content script 注入自身 shadow root 的是同一份 `selectionSearchStyles`。

## Guidance

### 第一层：全局引入真实页级样式表（冲突要在注释里消解）

`main.tsx` 顶部引入 `../options/styles.css` 与 `../search/styles.css`，真实类（`.key-row`、`.search-box`、`.switcher-track`、`.group-flyout`、`.result-card`、`.loading-skeleton`、`.layout-*` 等）随即可用。两份页级样式表共存必有碰撞，**每处碰撞当场评估并在 import 处注释**，不要留待后人重新排查：

- `@keyframes juso-fade-in` 两表重名（options 版带 translateY，search 版纯淡入），后载的 search 版全局生效 → 消解方式：引导页 markup 不使用该动画（`.options` section 与 `.history-overlay` 均不在引导页），无视觉影响；
- body 仅新增 `overflow-x: clip` → 本页无横向溢出，评估为无害；
- `.wordmark-text` 被 search 表带上 `font-size: var(--text-xl)` → 在 `styles.css` 作用域恢复：`.onboarding-header .wordmark-text { font-size: inherit; }`。

### 第二层：markup 建在真实类名上，覆盖组要小、要注释、要作用域

示意结构镜像真实组件（`.key-row` 镜像 `components/KeyInput.tsx` 的行结构；pill 与分组 trigger 连 `::after` 的 ▾ 箭头都来自真实样式）。只保留小型覆盖组，一律以演示前缀作用域限定（如 `.onboarding-qb-demo .switcher-group { ... }`），**绝不裸写 `.search-box` 之类的全局覆盖**。覆盖真实动画规则时注意特异性：浮层相位覆盖用 `(0,3,0)` 压过真实表 `(0,2,0)` 的一次性 `juso-rise` 入场。覆盖组头部注释写清「覆盖了什么、为什么」。

三条相邻约束（本次各踩过一次）：

1. **跨帧保留 transform 的动画（fill-mode both / keyframes 持有 transform）让每个动画元素自成 stacking context，兄弟绘制顺序需要显式 z-index**。真实 `.switcher-group` 无 z-index，浮层 z-20 直接参与 stage 层叠会盖过演示光标 z-5；把分组抬到 `z-index: 2` 自成 context，浮层收进组内，光标移入浮层点选时仍在最上层。
2. **带溢出行为的真实组件必须在示意框内留足空间**。`.group-flyout` 有真实 `min-width: max-content`（宽度随内容）；示意框尺寸要让浮层完全落在框内（实测：浮层起于 trigger 下方 ~33px、高 ~98px），绝不盖住下一个演示栏目。
3. **真实 `!important` 样式不能靠 transition/animation 在同一属性上做演示动画**——`!important` 声明优先级高于 CSS 动画。悬停高亮改为动画 `box-shadow: inset 0 0 0 999px var(--bg-soft)`：真实表对 `.juso-sel-source-item` 声明了 `background: transparent !important`，但未声明 box-shadow，动画可生效。

### 第三层：light DOM 装不下时，shadow root 注入真实样式字符串

划词弹窗的真实样式是 `entrypoints/shared/selection-search-styles.ts` 里的样式**字符串**——正是生产 content script 注入自身 shadow root 的那份。它无法经页面样式表复用：

- 表内 `* { margin: 0 !important; padding: 0 !important }` 是宿主页防御性重置，在 light DOM 全局注入会击穿整个引导页；而 shadow 隔离让它恰好只约束弹窗子树；
- `:host` 规则（零尺寸 host + `:host([data-theme])` 令牌自包含——shadow root 读不到扩展 `tokens.css`，令牌按 data-theme 内联在表内）只在 shadow root 内成立。

注入的固定套路（见 `SelectionDemo.tsx`）：

```tsx
const hostRef = useRef<HTMLDivElement>(null);
const [shadowRoot, setShadowRoot] = useState<ShadowRoot | null>(null);

useLayoutEffect(() => {
  const host = hostRef.current;
  if (!host) return;
  // StrictMode 双效应下复用同一 root（attachShadow 对同一 host 只能调用一次）
  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  if (root.firstChild == null) {
    const style = document.createElement('style');
    style.textContent = `${selectionSearchStyles}\n${DEMO_ANIM_STYLES}`;
    root.appendChild(style);
  }
  setShadowRoot(root);
}, []);

return (
  <div ref={hostRef} data-theme={resolved === 'dark' ? 'dark' : 'light'}>
    {shadowRoot &&
      createPortal(
        <div className="juso-sel-popup">{/* 真实展开态结构，.juso-sel-* 类名照搬 */}</div>,
        shadowRoot,
      )}
  </div>
);
```

要点：

- **StrictMode 安全的 attach**：`host.shadowRoot ?? host.attachShadow({ mode: 'open' })`——React StrictMode 双跑 effect，而同一 host 的 `attachShadow` 二次调用会抛错；
- **样式只注入一次**（`root.firstChild == null` 守卫），真实字符串 + 演示动画补充表拼成一段 `<style>`；演示补充的 keyframes 命名独立，隔离在 shadow 内不与页面重名；
- **`createPortal(content, shadowRoot)`** 渲染演示内容；
- **host 携带 `data-theme`**，镜像生产约定（content script 的 `shadowHost.dataset.theme`），亮/暗令牌来自表内 `:host([data-theme])` 规则；
- **host 零尺寸 + 溢出可见**（真实表 `:host` 规则本身如此约定），弹窗子元素可经 host 溢出绘制；定位/浮现动画留在页面侧 wrapper（`.onboarding-sel-popupwrap` 的相位动画），shadow host 保持「哑」；
- 演示不可交互的元素用同构标签替换（生产 `button` → 演示 `span`），类名结构不变。

## Why This Matters

样式拷贝的漂移是静默的：改真实 UI 不会报错、不会挂测试，示意照常渲染——直到用户按示意去认产品，发现对不上。三层模式把「一致」变成构造保证：真实样式表变了，示意跟着变，无需同步维护。副作用是删代码——仅划词弹窗一处就删了 ~70 行拷贝 CSS；其余四类演示的几十组拷贝规则同样清零，只剩带注释的小型覆盖组，每一处「示意与真实的差异」都显式可读。

## When to Apply

- 任何必须追踪真实产品样式的预览/示意/mock 页面：onboarding、教程页、README 内嵌演示、组件展示框——不限于 onboarding；
- 真实样式以 shadow-root 样式字符串形态存在（弹窗类 content script UI 天然如此），或其防御性 `!important` 重置不允许进入 light DOM；
- 发现自己在示意样式里重抄真实规则组时——先问能否 import 真实表、能否用真实类名，最后才考虑拷贝（拷贝时必须注释来源与漂移风险）；
- 不适用：示意**有意**偏离真实外观时——那是第二层「小型作用域覆盖组 + 注释」的领地，不是拷贝的理由。

## Examples

**Before（拷贝漂移）**——示意样式表里成组的近似拷贝，真实 UI 一变即过时：

```css
/* ❌ 旧写法：.onboarding-sel-* 下手抄弹窗样式（近似 .juso-sel-* 真实表） */
.onboarding-sel-popup { display: inline-flex; flex-direction: column; font-size: 13px; ... }
.onboarding-sel-bar { display: flex; align-items: center; background: #fff; border: 1px solid #e3e3e3; ... }
/* ……几十行，与 shared/selection-search-styles.ts 的距离只增不减 */
```

**After（三层复用）**——同一弹窗，零拷贝：

```tsx
// ① 真实样式字符串（与生产 content script 注入的同源）注入自建 shadow root
style.textContent = `${selectionSearchStyles}\n${DEMO_ANIM_STYLES}`;
// ② markup 用真实类名 + data-theme 主题
<div ref={hostRef} data-theme={resolved === 'dark' ? 'dark' : 'light'}>
  {shadowRoot && createPortal(<div className="juso-sel-popup">…</div>, shadowRoot)}
</div>
// ③ 演示差异只留带注释的补充表，且不与真实表争同一属性：
// 悬停高亮用 inset box-shadow（真实表 background: transparent !important 压不住动画，
// 但未声明 box-shadow）
@keyframes sel-item-hover {
  66%, 76% { box-shadow: inset 0 0 0 999px var(--bg-soft); }
}
```

页级组件类演示（无 shadow 需求）走前两层即可，`entrypoints/onboarding/main.tsx` 引入真实表 + `styles.css` 里 `.onboarding-qb-demo` 前缀的覆盖组（`z-index: 2` 抬分组、浮层相位覆盖、框内留白）是现成范例。

## Related

- [划词搜索浮层不可见：WXT shadow root host 的 all:initial 重置吞掉内联定位](../ui-bugs/wxt-shadow-root-inline-style-clobber.md) —— 同一份 `selection-search-styles.ts` 单源与 shadow host 注入机制（零尺寸 host + 内层 wrapper、`:host` 自守）；本文把该样式字符串在演示自建 shadow root 里复用。
- [划词弹窗点击固定展开的 shadow DOM 适配](selection-popup-click-to-pin-shadow-dom-adaptation.md) —— 同一 Selection Search 弹窗组件与 `data-theme` shadow host 约定的交互侧适配。
- [正交样式轴与语义色归属](orthogonal-style-axis-and-semantic-color-ownership.md) —— 同类「样式双份漂移」问题（扩展页与 shadow 表两处维护）；本文的单源注入是该问题在演示/预览场景的通用解法。
