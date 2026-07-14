import { createElement } from 'react';
import type { Root } from 'react-dom/client';
import { createRoot } from 'react-dom/client';
import { sendMessage } from '@/lib/messaging';
import { allSources } from '@/lib/sources';
import type { SearchEngine } from '@/lib/engines/types';
import type { SearchSource } from '@/lib/sources';
import { SourceSwitcher } from '@/components/SourceSwitcher';
import { matchEngineByUrl, anchorFor } from '@/lib/engines/registry';
import type { AnchorStrategy } from '@/lib/engines/types';
import { resolveSerpHandoff } from '@/lib/serp-handoff';
import { getThemePref } from '@/lib/storage';
import { serpBarStyles } from '@/entrypoints/shared/serp-bar-styles';
import { calculateAlignedHostLayout } from '@/lib/serp-bar-layout';

/**
 * v2 SERP 注入快切栏：在 Google/Bing 搜索结果页注入一行 chip，
 * 把「已配置 AI provider」与「常规搜索引擎」放进同一栏，点击即当前 tab 跳转。
 * 用 shadow DOM 隔离样式，避免污染宿主页。
 *
 * ## 锚点策略：两套独立方案，一次性 mount
 * Google 用 `#rcnt + before` + `#center_col` content-box 同步：AI Overview 位于 #rcnt 内且
 * 排在 #center_col 前，host 须在 #rcnt 外才会位于 AIO/普通结果前方。Bing 用 `#b_content 前`
 * + 运行时同步 content box：避开 #b_content 内部的
 * 旧式 inline/negative-margin 结果布局偷点击，且 #b_results 被激进重建故不能挂其兄弟。
 * 详见各 engine 的 anchor 字段（lib/engines/{google,bing}.ts）与 registry.ts 的 anchorFor。
 *
 * **不用 `ui.autoMount()`**：autoMount 的 ping-pong（waitElement 的 isNotExist 检测）
 * 在 Bing/Google「同一同步任务里移除旧节点 + 添加新节点」的合并式 SPA swap 上死锁——
 * MutationObserver 在 swap 完成后的微任务才回调，此时 `#b_results` 已是新节点，
 * isNotExist 永不为真、栏永不重挂。且 host 挂到「被换元素的兄弟」必被一起 detach。
 * 挂持久锚点 + 一次性 mount，这两个问题都不存在——host 的父级不参与结果重建。
 *
 * 参考：Greasyfork「移动端聚合搜索引擎导航 SearchSwitcher」Bing 分支即锚
 * `header` 一次性 appendChild，无 autoMount、无重挂——验证此模式可行。
 */
export default defineContentScript({
  matches: ['https://www.google.com/search*', 'https://www.bing.com/search*'],
  cssInjectionMode: 'ui',
  async main(ctx) {
    // 初始化（异步读取 worker 代理的 provider 配置与主题偏好）。
    // onMount 是同步签名（返回 TMounted），异步值在此预读后经 state 闭包喂给渲染。
    const state = await loadBarState();

    // 持久锚点策略：按当前 engine 选 selector + append 模式。
    const strategy = anchorFor(state.engine);

    // 已挂载的 React root/host，供 wxt:locationchange 重渲与布局同步命中。
    let mountedRoot: Root | null = null;
    let mountedHost: HTMLElement | null = null;

    const ui = await createShadowRootUi<{ root: Root }>(ctx, {
      name: 'juso-serp-bar',
      position: 'inline',
      anchor: strategy.selector,
      append: strategy.append,
      css: serpBarStyles,
      onMount(uiContainer, _shadow, shadowHost) {
        shadowHost.dataset.theme = state.resolvedTheme;
        mountedHost = shadowHost;
        syncAlignedHost(shadowHost, strategy);
        const mountEl = document.createElement('div');
        uiContainer.append(mountEl);
        const root = createRoot(mountEl);
        mountedRoot = root;
        render(root, state, state.engine);
        return { root };
      },
      onRemove(mounted) {
        mountedRoot = null;
        mountedHost = null;
        mounted?.root.unmount();
      },
    });
    // 一次性 mount：持久锚点在 document_idle 已就绪（SSR），且 SPA 导航不重建它，
    // 不需要 autoMount 的重挂逻辑——后者反而会在合并式 swap 上死锁。
    ui.mount();

    // Google/Bing 是 SPA：后续搜索用 history.pushState/replaceState，不重载页面、
    // 也不重新注入 content script（WXT ContentScriptContext 专门暴露 wxt:locationchange）。
    // 在此重算 engine/query 并对同一 React root 重渲，避免 chip 查询词与 active 高亮
    // 停在首次。host 已挂在持久锚点的兄弟，SPA 导航不会卸载它。
    ctx.addEventListener(window, 'wxt:locationchange', () => {
      const nextEngine = matchEngineByUrl(window.location.href);
      if (!nextEngine) return; // 离开已知 engine（如跳到 google.com/maps），不重渲
      state.engine = nextEngine;
      state.query = readQuery(nextEngine);
      if (!mountedRoot) return;
      if (mountedHost) syncAlignedHost(mountedHost, strategy);
      render(mountedRoot, state, nextEngine);
    });

    ctx.addEventListener(window, 'resize', () => {
      if (mountedHost) syncAlignedHost(mountedHost, strategy);
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
  return engine.extractQuery(window.location.href) ?? '';
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

function syncAlignedHost(host: HTMLElement, strategy: AnchorStrategy): void {
  if (!strategy.alignTo) return;
  const target = document.querySelector(strategy.alignTo);
  const parent = host.parentElement;
  if (!(target instanceof HTMLElement) || !(parent instanceof HTMLElement)) return;
  const layout = calculateAlignedHostLayout(
    parent.getBoundingClientRect(),
    readHorizontalBoxStyle(window.getComputedStyle(parent)),
    target.getBoundingClientRect(),
    readHorizontalBoxStyle(window.getComputedStyle(target)),
  );
  host.style.setProperty('--juso-serp-offset-left', `${layout.offsetLeft}px`, 'important');
  host.style.setProperty('--juso-serp-width', `${layout.width}px`, 'important');
}

function readHorizontalBoxStyle(style: CSSStyleDeclaration) {
  return {
    borderLeft: parsePx(style.borderLeftWidth),
    borderRight: parsePx(style.borderRightWidth),
    paddingLeft: parsePx(style.paddingLeft),
    paddingRight: parsePx(style.paddingRight),
  };
}

function parsePx(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
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
