import { createElement } from 'react';
import type { Root } from 'react-dom/client';
import { createRoot } from 'react-dom/client';
import { sendMessage } from '@/lib/messaging';
import { allSources } from '@/lib/sources';
import type { SearchEngine } from '@/lib/engines/types';
import type { SearchSource } from '@/lib/sources';
import { SourceSwitcher } from '@/components/SourceSwitcher';
import { matchEngineByUrl } from '@/lib/engines/registry';
import { pickAnchorStrategy } from '@/lib/engines/serp-anchor';
import type { AnchorStrategy } from '@/lib/engines/serp-anchor';
import { resolveSerpHandoff } from '@/lib/serp-handoff';
import { getThemePref } from '@/lib/storage';
import { serpBarStyles } from '@/entrypoints/shared/serp-bar-styles';

/**
 * v2 SERP 注入快切栏：在 Google/Bing 搜索结果页注入一行 chip，
 * 把「已配置 AI provider」与「常规搜索引擎」放进同一栏，点击即当前 tab 跳转。
 * 用 shadow DOM 隔离样式，避免污染宿主页。
 *
 * ## 锚点策略：两套独立方案，一次性 mount
 * Google 用 `#search + before`（d8dde21 起即此方案）：host 作为 #search 前置兄弟落在
 * #center_col 内，自动继承居中列对齐 search box；#search 元素身份在 SPA 导航时保持，
 * host 存活。Bing 用 `#b_content 前` + 运行时同步 content box：避开 #b_content 内部的
 * 旧式 inline/negative-margin 结果布局偷点击，且 #b_results 被激进重建故不能挂其兄弟。
 * 详见 lib/engines/serp-anchor.ts 的策略与证据。
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
    const strategy = pickAnchorStrategy(state.engine);

    // 已挂载的 React root/host，供 wxt:locationchange 重渲与布局同步命中。
    let mountedRoot: Root | null = null;
    let mountedHost: HTMLElement | null = null;

    const ui = await createShadowRootUi<{ root: Root }>(ctx, {
      name: 'juso-serp-bar',
      position: 'inline',
      anchor: strategy.selector,
      append: strategy.append,
      onMount(uiContainer, _shadow, shadowHost) {
        shadowHost.dataset.theme = state.resolvedTheme;
        mountedHost = shadowHost;
        applyHostLayout(shadowHost, strategy);
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

function applyHostLayout(host: HTMLElement, strategy: AnchorStrategy): void {
  // createShadowRootUi 会注入 `:host{all:initial!important}`，普通 :host CSS 无法覆盖。
  // 这些 host 级布局属性必须用 inline !important 固定，避免自定义元素按 inline 参与
  // Bing 的旧式 SERP 布局而导致视觉位置与 hit-test 位置偏移。
  host.style.setProperty('display', 'block', 'important');
  host.style.setProperty('position', 'relative', 'important');
  host.style.setProperty('z-index', '20', 'important');
  host.style.setProperty('pointer-events', 'auto', 'important');
  host.style.setProperty('box-sizing', 'border-box', 'important');
  host.style.setProperty('padding', '8px 0', 'important');
  host.style.setProperty(
    'font-family',
    'system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif',
    'important',
  );
  host.style.setProperty('visibility', 'visible', 'important');
  syncAlignedHost(host, strategy);
}

function syncAlignedHost(host: HTMLElement, strategy: AnchorStrategy): void {
  if (!strategy.alignTo) return;
  const target = document.querySelector(strategy.alignTo);
  if (!(target instanceof HTMLElement)) return;
  const rect = target.getBoundingClientRect();
  const style = window.getComputedStyle(target);
  const paddingLeft = parsePx(style.paddingLeft);
  const paddingRight = parsePx(style.paddingRight);
  const left = Math.max(0, rect.left + window.scrollX + paddingLeft);
  const width = Math.max(0, rect.width - paddingLeft - paddingRight);
  host.style.setProperty('margin-left', `${left}px`, 'important');
  host.style.setProperty('margin-right', '0', 'important');
  host.style.setProperty('width', `${width}px`, 'important');
  host.style.setProperty('max-width', `${width}px`, 'important');
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
