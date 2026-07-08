import { createElement } from 'react';
import type { Root } from 'react-dom/client';
import { createRoot } from 'react-dom/client';
import { sendMessage } from '@/lib/messaging';
import { allSources } from '@/lib/sources';
import type { SearchEngine } from '@/lib/engines/types';
import type { SearchSource } from '@/lib/sources';
import { matchEngineByUrl } from '@/lib/engines/registry';
import { pickAnchorSelector } from '@/lib/engines/serp-anchor';
import { resolveSerpHandoff } from '@/lib/serp-handoff';
import { getThemePref } from '@/lib/storage';
import { serpBarStyles } from '@/entrypoints/shared/serp-bar-styles';

/**
 * v2 SERP 注入快切栏：在 Google/Bing 搜索结果页注入一行 chip，
 * 把「已配置 AI provider」与「常规搜索引擎」放进同一栏，点击即当前 tab 跳转。
 * 用 shadow DOM 隔离样式，避免污染宿主页。
 *
 * 锚点选择（Google/Bing DOM 易变，真机 dogfood 阶段需复核）：
 *   Google: #search（结果主区）/ #rso（结果列表）
 *   Bing:   #b_results（结果主区）
 * 栏插在结果容器**之前**（append:'before'），实现「结果上方 inline」。
 *
 * 时序与 SPA 鲁棒性（回归「Bing 有时注入不生效」）：
 *   - 用 ui.autoMount()（内部 MutationObserver 观察锚点选择器函数），
 *     锚点元素由 SPA 延迟挂载或后续导航重挂时自动 (re)mount / unmount，
 *     不再依赖 document_idle 时同步命中锚点。
 *   - anchor 为**函数**而非首次匹配字符串：每次检查都按当前 URL 重算 engine，
 *     SPA 切换 engine（google↔bing）也能跟进。
 *   - 不回退 body：body-before 插入会把 shadow host 挂到 <body> 之外、不占布局，
 *     造成「完全看不见」。宁可等锚点出现，也不要落到不可见位置。
 */
export default defineContentScript({
  matches: ['https://www.google.com/search*', 'https://www.bing.com/search*'],
  cssInjectionMode: 'ui',
  async main(ctx) {
    // 初始化（异步读取 worker 代理的 provider 配置与主题偏好）。
    // onMount 是同步签名（返回 TMounted），异步值在此预读后经 state 闭包喂给渲染。
    const state = await loadBarState();

    // onMount/onRemove 之间维护的 React root；autoMount 反复 (un)mount 时，
    // 通过这个闭包变量让 wxt:locationchange 重渲命中「当前已挂载的 root」。
    let mountedRoot: Root | null = null;

    const ui = await createShadowRootUi<{ root: Root }>(ctx, {
      name: 'juso-serp-bar',
      position: 'inline',
      // 函数锚点：每次都按当前 URL 解析 engine 并给主选择器；autoMount 观察它。
      anchor: () => pickAnchorSelector(matchEngineByUrl(window.location.href)),
      append: 'before',
      onMount(uiContainer, _shadow, shadowHost) {
        shadowHost.dataset.theme = state.resolvedTheme;
        // 防御宿主页 CSS 折叠 host（shadow DOM 只隔离内部样式，host 元素本身受宿主布局支配）。
        shadowHost.style.display = 'block';
        shadowHost.style.minHeight = '40px';
        const styleEl = document.createElement('style');
        styleEl.textContent = serpBarStyles;
        uiContainer.append(styleEl);
        const mountEl = document.createElement('div');
        uiContainer.append(mountEl);
        const root = createRoot(mountEl);
        mountedRoot = root;
        render(root, state, state.engine);
        return { root };
      },
      onRemove(mounted) {
        mountedRoot = null;
        mounted?.root.unmount();
      },
    });
    // autoMount：锚点出现自动 mount、消失自动 unmount，根治 SPA 重挂导致的「留白无栏」
    // 与 document_idle 时锚点尚未就绪导致的「完全不出现」。
    ui.autoMount();

    // Google/Bing 是 SPA：后续搜索用 history.pushState/replaceState，不重载页面、
    // 也不重新注入 content script（WXT ContentScriptContext 专门暴露 wxt:locationchange）。
    // 在此重算 engine/query 并对同一 React root 重渲（若已挂载），避免 chip 查询词与 active
    // 高亮停在首次；engine 切换时同步刷新 state.engine 供下一次 onMount 使用。
    ctx.addEventListener(window, 'wxt:locationchange', () => {
      const nextEngine = matchEngineByUrl(window.location.href);
      if (!nextEngine) return; // 离开已知 engine（如跳到 google.com/maps），不重渲
      state.engine = nextEngine;
      state.query = readQuery(nextEngine);
      if (!mountedRoot) return; // 当前未挂载（锚点暂时不在），等 autoMount 重挂时自然用新 state
      render(mountedRoot, state, nextEngine);
    });
  },
});

interface BarState {
  engine: SearchEngine;
  query: string;
  sources: SearchSource[];
  resolvedTheme: 'light' | 'dark';
}

/** 读 config/theme/sources/query 并 resolve theme，产出 onMount 渲染所需全部值。 */
async function loadBarState(): Promise<BarState> {
  const engine = matchEngineByUrl(window.location.href);
  // main() 仅在 matches 命中的 SERP 页运行，engine 必中；保守兜底仍 early-return。
  if (!engine) {
    throw new Error('serp-bar: no engine matched on matched SERP URL');
  }
  const config = await sendMessage('getProviderConfig', undefined);
  const sources = allSources(config.configuredProviderIds);
  const themePref = await getThemePref();
  return {
    engine,
    query: readQuery(engine),
    sources,
    resolvedTheme: resolveTheme(themePref),
  };
}

function readQuery(engine: SearchEngine): string {
  return new URLSearchParams(window.location.search).get(engine.queryParam) ?? '';
}

function render(root: Root, state: BarState, engine: SearchEngine): void {
  root.render(
    createElement(SourceSwitcher, {
      sources: state.sources,
      activeId: engine.id,
      onSelect: (source: SearchSource) => onSelect(source, state.query),
    }),
  );
}

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

function resolveTheme(pref: 'auto' | 'light' | 'dark'): 'light' | 'dark' {
  if (pref === 'auto') {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return pref;
}
