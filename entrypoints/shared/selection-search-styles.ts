// 划词搜索弹窗样式（自包含，注入进 shadow root）。
// shadow root 隔离了宿主页 CSS，也意味着读不到扩展 tokens.css —— 此处把
// 需要的令牌按 data-theme 内联，保证弹窗在 light/dark 下都有可读底色。
//
// 令牌取值与 entrypoints/shared/serp-bar-styles.ts 对齐（仅取弹窗用到的子集）。
export const selectionSearchStyles = `
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
:host, :host([data-theme="light"]) {
  --bg: #ffffff; --bg-soft: #f5f5f5; --fg: #1a1a1a; --muted: #666;
  --border: #e3e3e3; --border-soft: #eee;
  --brand: #c8372d; --brand-on: #ffffff; --brand-soft: #fdf3f1;
  --radius: 8px; --radius-sm: 4px;
  --shadow: 0 4px 16px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.08);
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}
:host([data-theme="dark"]) {
  --bg: #1c1c1c; --bg-soft: #2a2a2a; --fg: #eaeaea; --muted: #9aa0a6;
  --border: #3c4043; --border-soft: #333;
  --brand: #ff6b5b; --brand-on: #1a0a08; --brand-soft: #2a1816;
  --radius: 8px; --radius-sm: 4px;
  --shadow: 0 4px 16px rgba(0,0,0,0.4), 0 1px 4px rgba(0,0,0,0.3);
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}

* { box-sizing: border-box !important; margin: 0 !important; padding: 0 !important; }

.juso-sel-popup {
  display: inline-flex !important;
  flex-direction: column !important;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
  font-size: 13px !important;
  line-height: 1.4 !important;
  color: var(--fg) !important;
}

.juso-sel-bar {
  display: flex !important;
  align-items: center !important;
  gap: 0 !important;
  background: var(--bg) !important;
  border: 1px solid var(--border) !important;
  border-radius: var(--radius) !important;
  box-shadow: var(--shadow) !important;
  padding: 3px !important;
}

/* 主 chip：仅放大镜图标，无文字无品牌色（与展开按钮统一风格）。 */
.juso-sel-primary {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  padding: 5px !important;
  border: none !important;
  background: transparent !important;
  color: var(--muted) !important;
  border-radius: var(--radius-sm) !important;
  cursor: pointer !important;
  transition: background 120ms var(--ease-out), color 120ms var(--ease-out) !important;
}
.juso-sel-primary:hover { background: var(--bg-soft) !important; color: var(--fg) !important; }

/* 主 chip 统一放大镜图标（不使用 source favicon）。 */
.juso-sel-search-icon {
  width: 14px !important;
  height: 14px !important;
  flex-shrink: 0 !important;
  display: block !important;
}

/* 展开区域：仅 hover 此区域才触发 flyout（不是整个 bar）。 */
.juso-sel-expand-area {
  position: relative !important;
  display: flex !important;
  align-items: center !important;
}

.juso-sel-expand {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 26px !important;
  height: 28px !important;
  border: none !important;
  background: transparent !important;
  color: var(--muted) !important;
  cursor: pointer !important;
  border-radius: var(--radius-sm) !important;
  padding: 0 !important;
  transition: background 120ms var(--ease-out), color 120ms var(--ease-out) !important;
}
.juso-sel-expand:hover { background: var(--bg-soft) !important; color: var(--fg) !important; }
.juso-sel-expand svg { width: 14px !important; height: 14px !important; display: block !important; }

.juso-sel-favicon {
  width: 16px !important;
  height: 16px !important;
  flex-shrink: 0 !important;
  border-radius: 2px !important;
  display: block !important;
  object-fit: contain !important;
}

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

:host([data-flyout-up="true"]) .juso-sel-flyout {
  top: auto !important;
  bottom: 100% !important;
  padding-top: 4px !important;
  padding-bottom: 6px !important;
}

/* 分组行：名称 + 右箭头，hover 触发侧边子浮层。 */
.juso-sel-group {
  position: relative !important;
}
.juso-sel-group-row {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  gap: 8px !important;
  padding: 6px 8px !important;
  border-radius: var(--radius-sm) !important;
  cursor: pointer !important;
  font-size: 13px !important;
  white-space: nowrap !important;
  color: var(--fg) !important;
  transition: background 100ms var(--ease-out) !important;
}
.juso-sel-group-row svg {
  width: 10px !important;
  height: 10px !important;
  flex-shrink: 0 !important;
  color: var(--muted) !important;
  display: block !important;
}
.juso-sel-group:hover > .juso-sel-group-row {
  background: var(--bg-soft) !important;
}
.juso-sel-group:hover > .juso-sel-group-row svg {
  color: var(--fg) !important;
}
.juso-sel-group.open > .juso-sel-group-row {
  background: var(--bg-soft) !important;
}
.juso-sel-group.open > .juso-sel-group-row svg {
  color: var(--fg) !important;
}

/* 侧边级联子浮层：hover 分组行时向右展开（非内联手风琴）。 */
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
  /* 紧贴分组行右侧（无 margin 缝隙），padding-left 提供呼吸。 */
  padding-left: 6px !important;
  z-index: 2 !important;
}
.juso-sel-group.open > .juso-sel-group-sources {
  display: block !important;
}

/* 边缘翻转：弹窗靠近视口右侧时，子浮层向左展开。 */
:host([data-sub-flyout-left="true"]) .juso-sel-group-sources {
  left: auto !important;
  right: 100% !important;
  padding-left: 4px !important;
  padding-right: 6px !important;
}

/* 弹窗向上翻转（flyoutUp）时，子浮层向上展开，避免溢出视口底部。 */
:host([data-sub-flyout-up="true"]) .juso-sel-group-sources {
  top: auto !important;
  bottom: 100% !important;
  padding-top: 4px !important;
  padding-bottom: 6px !important;
}

.juso-sel-source-item {
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;
  width: 100% !important;
  padding: 6px 8px !important;
  border: none !important;
  background: transparent !important;
  color: var(--fg) !important;
  border-radius: var(--radius-sm) !important;
  cursor: pointer !important;
  font-size: 13px !important;
  font-family: inherit !important;
  text-align: left !important;
  white-space: nowrap !important;
  transition: background 100ms var(--ease-out) !important;
}
.juso-sel-source-item:hover { background: var(--bg-soft) !important; }
.juso-sel-source-item span {
  overflow: hidden !important;
  text-overflow: ellipsis !important;
}
`;
