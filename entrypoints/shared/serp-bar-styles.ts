// SERP 注入栏样式（自包含，注入进 shadow root）。
// shadow root 隔离了宿主页 CSS，也意味着读不到扩展 tokens.css —— 此处把
// 需要的令牌按 data-theme 内联，保证栏在 light/dark 下都有可读底色。
//
// 令牌取值与 entrypoints/shared/tokens.css 对齐（仅取栏用到的子集）。
export const serpBarStyles = `
:host, :host([data-theme="light"]) {
  --bg: #ffffff; --bg-soft: #fafafa; --fg: #1a1a1a; --muted: #666;
  --border: #e3e3e3; --accent: #1a73e8; --on-accent: #ffffff;
}
:host([data-theme="dark"]) {
  --bg: #1c1c1c; --bg-soft: #262626; --fg: #eaeaea; --muted: #9aa0a6;
  --border: #3c4043; --accent: #8ab4f8; --on-accent: #1c1c1c;
}

:host {
  display: block;
  padding: 8px 0;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
}

.source-switcher { display: flex; gap: 6px; flex-wrap: wrap; }
.source-switcher button {
  display: inline-flex; align-items: center; gap: 5px;
  border: 1px solid var(--border); background: var(--bg); border-radius: 999px;
  padding: 4px 12px; font-size: 13px; cursor: pointer; color: var(--muted);
}
.source-switcher button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.source-switcher button:disabled { opacity: 0.55; cursor: default; }
.source-switcher button.active { border-color: var(--accent); color: var(--accent); font-weight: 600; }
.source-switcher .source-icon { border-radius: 3px; display: inline-block; }
.source-switcher .no-answer { font-size: 11px; opacity: 0.7; }
`;
