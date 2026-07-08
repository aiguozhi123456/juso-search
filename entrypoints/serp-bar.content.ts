import { createElement } from 'react';
import type { Root } from 'react-dom/client';
import { createRoot } from 'react-dom/client';
import { sendMessage } from '@/lib/messaging';
import { allSources } from '@/lib/sources';
import type { SearchSource } from '@/lib/sources';
import { SourceSwitcher } from '@/components/SourceSwitcher';
import { matchEngineByUrl } from '@/lib/engines/registry';
import { resolveSerpHandoff } from '@/lib/serp-handoff';
import { getThemePref } from '@/lib/storage';
import { serpBarStyles } from '@/entrypoints/shared/serp-bar-styles';

/**
 * v2 SERP 注入快切栏：在 Google/Bing 搜索结果页注入一行 chip，
 * 把「已配置 AI provider」与「常规搜索引擎」放进同一栏，点击即当前 tab 跳转。
 * 用 shadow DOM 隔离样式，避免污染宿主页。
 *
 * 锚点选择器（Google/Bing DOM 易变，真机 dogfood 阶段需复核）：
 *   Google: #search（结果主区）/ #rso（结果列表）
 *   Bing:   #b_results（结果主区）
 * 栏插在结果容器**之前**（append:'before'），实现「结果上方 inline」。
 * 找不到锚点时回退插到 body 顶部，保证栏至少可见。
 */
export default defineContentScript({
  matches: ['https://www.google.com/search*', 'https://www.bing.com/search*'],
  cssInjectionMode: 'ui',
  async main(ctx) {
    const url = window.location.href;
    const currentEngine = matchEngineByUrl(url);
    if (!currentEngine) return; // 非已知 engine（如国别域名），不注入

    // 提取当前查询词（栏内 chip 跳转都带上它）。
    const query = new URLSearchParams(window.location.search).get(currentEngine.queryParam) ?? '';

    // 读已配置 provider（worker 代理，不读 key 明文）。
    const config = await sendMessage('getProviderConfig', undefined);
    const sources = allSources(config.configuredProviderIds);

    // 主题跟随：shadow root 隔离了宿主页 CSS，需在 shadowHost 上显式设 data-theme。
    const themePref = await getThemePref();
    const resolvedTheme = resolveTheme(themePref);

    // onMount 把 React root 经由 mountedRoot 闭包变量暴露给 locationchange 重渲——
    // ui.mount() 本身返回 void，{ root } 仅在 onRemove 回调里可达。
    let mountedRoot: Root | null = null;
    const ui = await createShadowRootUi<{ root: Root }>(ctx, {
      name: 'juso-serp-bar',
      position: 'inline',
      anchor: pickAnchor(),
      append: 'before',
      onMount(uiContainer, _shadow, shadowHost) {
        shadowHost.dataset.theme = resolvedTheme;
        const styleEl = document.createElement('style');
        styleEl.textContent = serpBarStyles;
        uiContainer.append(styleEl);
        const mountEl = document.createElement('div');
        uiContainer.append(mountEl);
        const root = createRoot(mountEl);
        mountedRoot = root;
        root.render(
          createElement(SourceSwitcher, {
            sources,
            activeId: currentEngine.id,
            onSelect: (source: SearchSource) => onSelect(source, query),
          }),
        );
        return { root };
      },
      onRemove(mounted) {
        mountedRoot = null;
        mounted?.root.unmount();
      },
    });
    ui.mount();

    // Google/Bing 是 SPA：后续搜索用 history.pushState/replaceState，不重载页面、
    // 也不重新注入 content script（WXT ContentScriptContext 专门暴露 wxt:locationchange）。
    // 在此重算 engine/query 并对同一 React root 重渲，避免 chip 查询词与 active 高亮停在首次。
    ctx.addEventListener(window, 'wxt:locationchange', () => {
      if (!mountedRoot) return; // 已被 onRemove 卸载，不再重渲
      const nextEngine = matchEngineByUrl(window.location.href);
      if (!nextEngine) return; // 离开已知 engine（如跳到 google.com/maps），不重渲
      const nextQuery =
        new URLSearchParams(window.location.search).get(nextEngine.queryParam) ?? '';
      mountedRoot.render(
        createElement(SourceSwitcher, {
          sources,
          activeId: nextEngine.id,
          onSelect: (source: SearchSource) => onSelect(source, nextQuery),
        }),
      );
    });
  },
});

/**
 * 选中某 chip：
 *   engine   → 当前 tab location.assign 到该 engine SERP/首页（https，网页可导航）；
 *   provider → 委托 background 用 tabs.update 跳 Juso 搜索页深链（带 query，空查询跳首页）。
 *
 * provider 分支不能在网页上下文直接 location.assign 到 chrome-extension://，会被客户端
 * 拦截（ERR_BLOCKED_BY_CLIENT）；交给 worker 在特权上下文导航当前 tab。跳转意图由
 * resolveSerpHandoff 纯函数解析（便于单测），此处只负责按 kind 执行副作用。
 */
function onSelect(source: SearchSource, query: string): void {
  const handoff = resolveSerpHandoff(source, query);
  if (!handoff) return;
  if (handoff.kind === 'navigate') {
    location.assign(handoff.url);
    return;
  }
  void sendMessage('openSearchPage', handoff.deepLink);
}

/** 优先选结果容器；找不到回退 body（append:'before' 对 body 也成立）。 */
function pickAnchor(): string {
  const candidates = ['#search', '#rso', '#b_results'];
  for (const sel of candidates) {
    if (document.querySelector(sel)) return sel;
  }
  return 'body';
}

function resolveTheme(pref: 'auto' | 'light' | 'dark'): 'light' | 'dark' {
  if (pref === 'auto') {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return pref;
}
