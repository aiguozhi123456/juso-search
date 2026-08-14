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
  --color-yellow: #9a7200; --color-yellow-soft: #fff8dd;
  --color-rose: #b82f63; --color-rose-soft: #fff0f5;
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
  --color-yellow: #e3b341; --color-yellow-soft: #2b2515;
  --color-rose: #f472b6; --color-rose-soft: #321d29;
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

/* 搜狗微信：原生搜索建议（.suggestion）挂在 .header-box（position:relative; z-index:12）的
 * 层叠上下文内，z-index:2 在其内封顶 12——任何抬高下拉的尝试都无法超过共享层 20。
 * 与 Bing 同款解法：仅压低本引擎 host 到 1（12 > 1），让 header 及其建议下拉盖过栏；
 * 页面底部 bottom-form 的建议框在根上下文 z-index:2，同样高于 1。 */
:host([data-engine="weixin"]) {
  z-index: 1 !important;
}

/* 抖音：fixed 贴在搜索框(#douyin-header, h=56)正下方；筛选区(综合/视频/用户…)
 * 在 #search-toolbar-container 内，由 pageStyles 把该工具栏整体下移腾出栏位。
 * left/width 用视口绝对坐标（--juso-serp-left），对齐搜索内容列（#search-content-area），
 * 不能用相对父元素的 --juso-serp-offset-left（fixed 的 containing block 是 viewport）。 */
:host([data-engine="douyin"][data-position="inline"]) {
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

/* 哔哩哔哩：栏宽 = 居中搜索框宽（480px，由 alignTo=.search-input-wrap 计算），
 * chips 默认 inline-flex 左对齐会让可见 chip 块偏左；改为填满栏宽并水平居中，
 * 使 chip 块中心对齐搜索框中心。 */
:host([data-engine="bilibili"]) .source-switcher {
  display: flex !important;
  justify-content: center !important;
}

/* 签名滑动指示器 segmented control（与搜索页同款）。
 * 外层 .source-switcher 不裁剪；横滑与指示器落在 .switcher-track 内。 */
.source-switcher {
  position: relative;
  display: inline-flex;
  max-width: 100%;
  overflow: visible;
}
.switcher-track {
  position: relative;
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px;
  background: var(--bg-soft);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-full);
  max-width: 100%;
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
/* fallback：未测量到指示器时，active 直接用实色（与搜索页一致）。
   指示器锚定的 pill 自身底色由指示器承担；仅清除该 pill 的底色，
   浮层内 active 项（其后无指示器）保留自身实色，避免白字透明底不可见。 */
.source-switcher button.active {
  background: var(--brand); color: var(--brand-on); border-color: var(--brand);
}
.source-switcher button.active[data-indicator-target="true"] {
  background: transparent; border-color: transparent;
}
.source-switcher .source-icon { border-radius: var(--radius-sm); display: inline-block; }
.source-switcher .no-answer { font-size: 11px; opacity: 0.78; font-weight: 500; }

/* ── 来源分组：折叠 pill + hover 浮层（shadow DOM 自包含，与搜索页同构） ── */
.source-switcher .switcher-group { position: relative; display: inline-flex; }
.source-switcher .group-trigger {
  position: relative; z-index: 1;
  display: inline-flex; align-items: center; gap: 5px;
  border: 1px solid transparent; background: transparent;
  border-radius: var(--radius-full);
  padding: 4px 12px; font-size: 13px; cursor: pointer; color: var(--muted);
  font-family: inherit;
  transition: color var(--duration-fast) var(--ease-out),
              background var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out);
}
.source-switcher .group-trigger:hover:not(:disabled) { color: var(--brand); background: var(--brand-soft); }
.source-switcher .group-trigger:disabled { opacity: 0.55; cursor: default; }
.source-switcher .group-trigger .group-label { white-space: nowrap; }
.source-switcher .group-trigger::after { content: '▾'; font-size: 11px; opacity: 0.7; }
.source-switcher .switcher-group.open > .group-trigger { color: var(--brand); background: var(--brand-soft); }
.source-switcher .group-trigger .group-badge {
  width: 6px; height: 6px; border-radius: var(--radius-full);
  background: var(--brand); margin-left: 1px;
}
/* 浮层紧贴 trigger 底边（top:100%，无 margin-top 缝隙）：穿缝会触发 mouseleave
   把浮层提前收回，导致无法切到组内 source。呼吸由内部 padding-top 提供。 */
.source-switcher .group-flyout {
  position: absolute; top: 100%; left: 0;
  display: flex; flex-direction: column; gap: 4px; padding: 4px;
  padding-top: 6px;
  background: var(--bg); border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 6px 20px rgba(0,0,0,0.15);
  z-index: 20; min-width: max-content;
}
.source-switcher .group-flyout button { justify-content: flex-start; white-space: nowrap; }

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
:host([data-style="colorful"]) .source-switcher button[data-source="jina"] { --source-color: var(--color-teal); --source-soft: var(--color-teal-soft); }
:host([data-style="colorful"]) .source-switcher button[data-source="doubao"] { --source-color: var(--color-rose); --source-soft: var(--color-rose-soft); }
:host([data-style="colorful"]) .source-switcher button[data-source="doubao-global"] { --source-color: var(--color-yellow); --source-soft: var(--color-yellow-soft); }
:host([data-style="colorful"]) .source-switcher button:hover:not(:disabled):not([data-active="true"]) {
  color: var(--source-color);
  background: var(--source-soft);
}
:host([data-style="colorful"]) .source-switcher button.active {
  background: var(--source-color);
  border-color: var(--source-color);
  color: var(--color-on-fill);
}
:host([data-style="colorful"]) .source-switcher button.active[data-indicator-target="true"] {
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
:host([data-style="colorful"]) .source-switcher[data-active-source="jina"] .switcher-indicator { background: var(--color-teal); }
:host([data-style="colorful"]) .source-switcher[data-active-source="doubao"] .switcher-indicator { background: var(--color-rose); }
:host([data-style="colorful"]) .source-switcher[data-active-source="doubao-global"] .switcher-indicator { background: var(--color-yellow); }
:host([data-style="colorful"]) .source-switcher button:focus-visible {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--source-color) 30%, transparent);
}

/* 底栏：扁、贴底全宽；page pad 由 #juso-serp-bottom-pad 让出栏高。
 * 放在样式表末尾，等特异性下覆盖抖音的 top:56px。
 * 横滑只在 .switcher-track；flyout 用 fixed 向上（.group-flyout--fixed-up），不被 overflow 裁切。 */
:host([data-position="bottom"]) {
  position: fixed !important;
  bottom: 0 !important;
  left: 0 !important;
  right: 0 !important;
  width: 100% !important;
  margin-left: 0 !important;
  max-width: none !important;
  /* int32 最大值：底栏挂到 document.body（见 serp-bar.content.ts 的 append 分支），
   * 脱离页面 SPA 子树的层叠上下文/containing block；再用最高 z-index 盖过
   * 抖音分享/设置等站点浮层（其值常 >1000）。 */
  z-index: 2147483647 !important;
  background: var(--bg) !important;
  background: color-mix(in srgb, var(--bg) 88%, transparent) !important;
  box-sizing: border-box !important;
  /* 竖向更扁：少挡内容；safe-area 仍抬起 Home 条。 */
  padding: 4px 8px !important;
  padding-bottom: calc(4px + env(safe-area-inset-bottom, 0px)) !important;
  padding-left: calc(8px + env(safe-area-inset-left, 0px)) !important;
  padding-right: calc(8px + env(safe-area-inset-right, 0px)) !important;
  box-shadow: 0 -1px 8px rgba(0,0,0,0.1) !important;
  border-top: 1px solid var(--border-soft) !important;
  /* 不在 host 上用 backdrop-filter：会把 fixed 子元素的 containing block 变成 host，
   * 导致 flyout 的 left/bottom 视口坐标错位。毛玻璃改挂在 .switcher-track。 */
  transition: transform 280ms cubic-bezier(0.16, 1, 0.3, 1) !important;
}
:host([data-position="bottom"][data-hidden="true"]) {
  transform: translateY(100%) !important;
}
:host([data-engine="douyin"][data-position="bottom"]) {
  top: auto !important;
  left: 0 !important;
  width: 100% !important;
  max-width: none !important;
}
/* 顶栏覆盖层：与底栏对称；page pad 由 #juso-serp-top-pad 让出栏高。
 * 放在底栏块之后，等特异性下覆盖抖音 inline 的 top:56px。 */
:host([data-position="top"]) {
  position: fixed !important;
  top: 0 !important;
  left: 0 !important;
  right: 0 !important;
  width: 100% !important;
  margin-left: 0 !important;
  max-width: none !important;
  z-index: 2147483647 !important;
  background: var(--bg) !important;
  background: color-mix(in srgb, var(--bg) 88%, transparent) !important;
  box-sizing: border-box !important;
  padding: 4px 8px !important;
  padding-top: calc(4px + env(safe-area-inset-top, 0px)) !important;
  padding-left: calc(8px + env(safe-area-inset-left, 0px)) !important;
  padding-right: calc(8px + env(safe-area-inset-right, 0px)) !important;
  box-shadow: 0 1px 8px rgba(0,0,0,0.1) !important;
  border-bottom: 1px solid var(--border-soft) !important;
  transition: transform 280ms cubic-bezier(0.16, 1, 0.3, 1) !important;
}
:host([data-position="top"][data-hidden="true"]) {
  transform: translateY(-100%) !important;
}
:host([data-engine="douyin"][data-position="top"]) {
  top: 0 !important;
  left: 0 !important;
  width: 100% !important;
  max-width: none !important;
}
:host([data-position="top"]) .source-switcher {
  display: block !important;
  width: 100% !important;
  max-width: 100% !important;
  overflow: visible !important;
  margin: 0 !important;
  background: transparent !important;
  border: none !important;
  padding: 0 !important;
}
:host([data-position="top"]) .switcher-track {
  display: flex !important;
  flex-wrap: nowrap !important;
  justify-content: flex-start !important;
  width: 100% !important;
  max-width: 100% !important;
  overflow-x: auto !important;
  overflow-y: hidden !important;
  scrollbar-width: none !important;
  -webkit-overflow-scrolling: touch !important;
  padding: 2px 4px !important;
  gap: 2px !important;
  /* 半透明底色提供"磨砂"观感；不放 backdrop-filter——它是 fixed flyout 的祖先，
   * 会建立 containing block 并配合 overflow-y:hidden 裁切向上浮层。host 同理不带。 */
  background: color-mix(in srgb, var(--bg) 88%, transparent) !important;
}
:host([data-position="top"]) .switcher-track::-webkit-scrollbar {
  display: none !important;
}
/* 扁栏 chip：略小于 tip 的加厚 touch，仍可点。 */
:host([data-position="top"]) .source-switcher button,
:host([data-position="top"]) .source-switcher .group-trigger {
  padding: 4px 10px !important;
  font-size: 12px !important;
  flex-shrink: 0 !important;
}
:host([data-position="bottom"]) .source-switcher {
  display: block !important;
  width: 100% !important;
  max-width: 100% !important;
  overflow: visible !important;
  margin: 0 !important;
  background: transparent !important;
  border: none !important;
  padding: 0 !important;
}
:host([data-position="bottom"]) .switcher-track {
  display: flex !important;
  flex-wrap: nowrap !important;
  justify-content: flex-start !important;
  width: 100% !important;
  max-width: 100% !important;
  overflow-x: auto !important;
  overflow-y: hidden !important;
  scrollbar-width: none !important;
  -webkit-overflow-scrolling: touch !important;
  padding: 2px 4px !important;
  gap: 2px !important;
  /* 半透明底色提供"磨砂"观感；不放 backdrop-filter——它是 fixed flyout 的祖先，
   * 会建立 containing block 并配合 overflow-y:hidden 裁切向上浮层。host 同理不带。 */
  background: color-mix(in srgb, var(--bg) 88%, transparent) !important;
}
:host([data-position="bottom"]) .switcher-track::-webkit-scrollbar {
  display: none !important;
}
/* 扁栏 chip：略小于 tip 的加厚 touch，仍可点。 */
:host([data-position="bottom"]) .source-switcher button,
:host([data-position="bottom"]) .source-switcher .group-trigger {
  padding: 4px 10px !important;
  font-size: 12px !important;
  flex-shrink: 0 !important;
}
/* fixed 向上 flyout：位置由 JS 写入 left/bottom；样式只负责外观。
 * z-index 与 host 同取 int32 最大值：host 已是 body 级 fixed 覆盖层（脱离站点子树），
 * flyout 作为其 fixed 子元素无需超过 host；同值即可，且一并盖过站点浮层。 */
:host([data-position="bottom"]) .group-flyout--fixed-up {
  position: fixed !important;
  top: auto !important;
  z-index: 2147483647 !important;
  padding-top: 4px !important;
  padding-bottom: 6px !important;
  box-shadow: 0 -6px 20px rgba(0,0,0,0.15) !important;
}
/* fixed 向下 flyout（顶栏）：位置由 JS 写入 left/top；样式只负责外观。
 * z-index 与 host 同取 int32 最大值（同 fixed-up 理由）。 */
:host([data-position="top"]) .group-flyout--fixed-down {
  position: fixed !important;
  bottom: auto !important;
  z-index: 2147483647 !important;
  padding-top: 6px !important;
  padding-bottom: 4px !important;
  box-shadow: 0 6px 20px rgba(0,0,0,0.15) !important;
}
`;
