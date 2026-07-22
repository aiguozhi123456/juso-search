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

:host([data-style="colorful"][data-theme="light"]) {
  --color-red: #d94841; --color-red-soft: #fff1f0;
  --color-orange: #e87524; --color-orange-soft: #fff4e8;
  --color-green: #238636; --color-green-soft: #edf8ef;
  --color-teal: #0f7f81; --color-teal-soft: #eaf8f7;
  --color-cyan: #087ea4; --color-cyan-soft: #e8f7fb;
  --color-blue: #2563eb; --color-blue-soft: #edf3ff;
  --color-violet: #7040d8; --color-violet-soft: #f3efff;
  --color-on-fill: #ffffff;
  --brand: var(--color-blue); --brand-on: var(--color-on-fill); --brand-soft: var(--color-blue-soft);
}
:host([data-style="colorful"][data-theme="dark"]) {
  --color-red: #ff7b72; --color-red-soft: #32191a;
  --color-orange: #ffa657; --color-orange-soft: #2f2116;
  --color-green: #56d364; --color-green-soft: #172a1b;
  --color-teal: #39c5bb; --color-teal-soft: #122a29;
  --color-cyan: #67d4ea; --color-cyan-soft: #122930;
  --color-blue: #79a8ff; --color-blue-soft: #18243a;
  --color-violet: #b794f6; --color-violet-soft: #281f3b;
  --color-on-fill: #121722;
  --brand: var(--color-blue); --brand-on: var(--color-on-fill); --brand-soft: var(--color-blue-soft);
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

/* 抖音：fixed 贴在搜索框(#douyin-header, h=56)正下方；筛选区(综合/视频/用户…)
 * 在 #search-toolbar-container 内，由 pageStyles 把该工具栏整体下移腾出栏位。
 * left/width 用视口绝对坐标（--juso-serp-left），对齐搜索内容列（#search-content-area），
 * 不能用相对父元素的 --juso-serp-offset-left（fixed 的 containing block 是 viewport）。 */
:host([data-engine="douyin"]) {
  position: fixed !important;
  top: 56px !important;
  left: var(--juso-serp-left, 72px) !important;
  margin-top: 0 !important;
  margin-left: 0 !important;
  width: var(--juso-serp-width, 801px) !important;
  max-width: calc(100vw - 24px) !important;
  z-index: 600 !important;
  background: var(--bg) !important;
  box-sizing: border-box !important;
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

/* 彩色风格：来源 ID 拥有稳定实色；容器与阴影保持经典的克制处理。 */
:host([data-style="colorful"]) .source-switcher button {
  --source-color: var(--color-blue);
  --source-soft: var(--color-blue-soft);
}
:host([data-style="colorful"]) .source-switcher button[data-source="google"] { --source-color: var(--color-blue); --source-soft: var(--color-blue-soft); }
:host([data-style="colorful"]) .source-switcher button[data-source="bing"] { --source-color: var(--color-cyan); --source-soft: var(--color-cyan-soft); }
:host([data-style="colorful"]) .source-switcher button[data-source="baidu"] { --source-color: var(--color-red); --source-soft: var(--color-red-soft); }
:host([data-style="colorful"]) .source-switcher button[data-source="tavily"] { --source-color: var(--color-violet); --source-soft: var(--color-violet-soft); }
:host([data-style="colorful"]) .source-switcher button[data-source="exa"] { --source-color: var(--color-teal); --source-soft: var(--color-teal-soft); }
:host([data-style="colorful"]) .source-switcher button[data-source="stepfun"] { --source-color: var(--color-orange); --source-soft: var(--color-orange-soft); }
:host([data-style="colorful"]) .source-switcher button[data-source="stepfun-plan"] { --source-color: var(--color-green); --source-soft: var(--color-green-soft); }
:host([data-style="colorful"]) .source-switcher button:hover:not(:disabled):not([data-active="true"]) {
  color: var(--source-color);
  background: var(--source-soft);
}
:host([data-style="colorful"]) .source-switcher button.active {
  background: var(--source-color);
  border-color: var(--source-color);
  color: var(--color-on-fill);
}
:host([data-style="colorful"]) .source-switcher[style*="--indicator-w"] button.active {
  background: transparent;
  border-color: transparent;
}
:host([data-style="colorful"]) .source-switcher button[data-active="true"] { color: var(--color-on-fill); }
:host([data-style="colorful"]) .source-switcher[data-active-source="google"] .switcher-indicator { background: var(--color-blue); }
:host([data-style="colorful"]) .source-switcher[data-active-source="bing"] .switcher-indicator { background: var(--color-cyan); }
:host([data-style="colorful"]) .source-switcher[data-active-source="baidu"] .switcher-indicator { background: var(--color-red); }
:host([data-style="colorful"]) .source-switcher[data-active-source="tavily"] .switcher-indicator { background: var(--color-violet); }
:host([data-style="colorful"]) .source-switcher[data-active-source="exa"] .switcher-indicator { background: var(--color-teal); }
:host([data-style="colorful"]) .source-switcher[data-active-source="stepfun"] .switcher-indicator { background: var(--color-orange); }
:host([data-style="colorful"]) .source-switcher[data-active-source="stepfun-plan"] .switcher-indicator { background: var(--color-green); }
:host([data-style="colorful"]) .source-switcher button:focus-visible {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--source-color) 30%, transparent);
}
`;
