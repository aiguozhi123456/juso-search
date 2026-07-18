// SERP 注入栏样式（自包含，注入进 shadow root）。
// shadow root 隔离了宿主页 CSS，也意味着读不到扩展 tokens.css —— 此处把
// 需要的令牌按 data-theme 内联，保证栏在 light/dark 下都有可读底色。
//
// 令牌取值与 entrypoints/shared/tokens.css 对齐（仅取栏用到的子集 + brand 朱砂）。
export const serpBarStyles = `
:host, :host([data-theme="light"]) {
  --bg: #ffffff; --bg-soft: #fafafa; --fg: #1a1a1a; --muted: #666;
  --border: #e3e3e3; --border-soft: #eee;
  --brand: #c8372d; --brand-on: #ffffff; --brand-soft: #fdf3f1;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --duration-fast: 120ms;
  --duration-normal: 180ms;
  --radius-sm: 4px;
  --radius-full: 999px;
}
:host([data-theme="dark"]) {
  --bg: #1c1c1c; --bg-soft: #262626; --fg: #eaeaea; --muted: #9aa0a6;
  --border: #3c4043; --border-soft: #2a2a2a;
  --brand: #ff6b5b; --brand-on: #1a0a08; --brand-soft: #2a1816;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --duration-fast: 120ms;
  --duration-normal: 180ms;
  --radius-sm: 4px;
  --radius-full: 999px;
}

:host {
  display: block !important;
  position: relative !important;
  z-index: 20 !important;
  box-sizing: border-box !important;
  padding: 8px 0 !important;
  margin-left: var(--juso-serp-offset-left, 0px) !important;
  width: var(--juso-serp-width, auto) !important;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif !important;
  visibility: visible !important;
  pointer-events: auto !important;
}

:host([data-engine="bing"]) {
  z-index: 1 !important;
}

/* 签名滑动指示器 segmented control（与搜索页同款） */
.source-switcher {
  position: relative;
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px;
  background: var(--bg-soft);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-full);
}
.switcher-indicator {
  position: absolute;
  left: var(--indicator-x, 0);
  top: var(--indicator-y, 0);
  width: var(--indicator-w, 0);
  height: var(--indicator-h, 0);
  background: var(--brand);
  border-radius: var(--radius-full);
  transition: left var(--duration-normal) var(--ease-out),
              top var(--duration-normal) var(--ease-out),
              width var(--duration-normal) var(--ease-out),
              height var(--duration-normal) var(--ease-out);
  z-index: 0;
  pointer-events: none;
}
.source-switcher button {
  position: relative;
  z-index: 1;
  display: inline-flex; align-items: center; gap: 5px;
  border: 1px solid transparent; background: transparent;
  border-radius: var(--radius-full);
  padding: 4px 12px; font-size: 13px; cursor: pointer; color: var(--muted);
  transition: color var(--duration-fast) var(--ease-out),
              background var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out);
}
.source-switcher button:hover:not(:disabled):not([data-active="true"]) {
  color: var(--brand); background: var(--brand-soft);
}
.source-switcher button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px rgba(200, 55, 45, 0.28);
}
:host([data-theme="dark"]) .source-switcher button:focus-visible {
  box-shadow: 0 0 0 3px rgba(255, 107, 91, 0.36);
}
.source-switcher button:disabled { opacity: 0.55; cursor: default; }
.source-switcher button[data-active="true"] { color: var(--brand-on); font-weight: 600; }
/* fallback：未测量到指示器时，active 直接用实色（与搜索页一致） */
.source-switcher button.active {
  background: var(--brand); color: var(--brand-on); border-color: var(--brand);
}
.source-switcher[style*="--indicator-w"] button.active {
  background: transparent; border-color: transparent;
}
.source-switcher .source-icon { border-radius: var(--radius-sm); display: inline-block; }
.source-switcher .no-answer { font-size: 11px; opacity: 0.78; font-weight: 500; }
`;
