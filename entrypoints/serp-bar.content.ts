import { createElement } from 'react';
import type { Root } from 'react-dom/client';
import { createRoot } from 'react-dom/client';
import { sendMessage } from '@/lib/messaging';
import { allSources } from '@/lib/sources';
import type { SearchEngine } from '@/lib/engines/types';
import type { SearchSource } from '@/lib/sources';
import { SourceSwitcher } from '@/components/SourceSwitcher';
import { matchEngineByUrl, anchorsFor } from '@/lib/engines/registry';
import type { AnchorStrategy } from '@/lib/engines/types';
import { resolveSerpHandoff } from '@/lib/serp-handoff';
import { getStylePref, getThemePref } from '@/lib/storage';
import type { StylePref } from '@/lib/storage';
import { serpBarStyles } from '@/entrypoints/shared/serp-bar-styles';
import { calculateAlignedHostLayout } from '@/lib/serp-bar-layout';
import { pickAnchor, injectPageStyles, removePageStyles } from '@/lib/serp-bar-mount';
import { SERP_CONTENT_MATCH_PATTERNS } from '@/lib/engines/scopes';

/**
 * v2 SERP 注入快切栏：在 Google/Bing/Baidu 搜索结果页注入一行 chip，
 * 把「已配置 AI provider」与「常规搜索引擎」放进同一栏，点击即当前 tab 跳转。
 * 用 shadow DOM 隔离样式，避免污染宿主页。
 *
 * ## 锚点策略：候选级联，按 SERP URL 生命周期 mount
 * 每个 engine 在 lib/engines/*.ts 的 `anchors` 字段声明按优先级降序的候选；content script
 * 启动时取首个选择器命中的候选（pickAnchor），全缺失则交 mountWhenAnchorReady 等末位候选。
 *   - Google：首选 `#rcnt + before + alignTo #center_col`（host 在 #rcnt 外，排在 AIO 上方）；
 *     回退 `#center_col + first`——该策略真机复测会落到 AIO 下方（2026-07-17），仅作 #rcnt 缺失时的防御性兜底。
 *   - Baidu ：首选 `#container + first`；回退 `#content_left + before + alignTo #content_left`。
 *   - Bing  ：仅 `#b_content + before + alignTo #b_content`——避开 #b_content 内部 overlay/inline
 *     布局偷点击，且 #b_results 被激进重建故不能挂其兄弟（searchEngineJump 的 Bing 规则亦同）。
 * 注：Baidu 的 pageStyles CSS 值仍待真机复核（见 lib/engines/baidu.ts 的 TODO(qa) 标记）。
 * 详见各 engine 的 anchors 字段（lib/engines/{google,bing,baidu}.ts）与 registry.ts 的 anchorsFor。
 *
 * **不用 `ui.autoMount()`**：autoMount 的 ping-pong（waitElement 的 isNotExist 检测）
 * 在 Bing/Google「同一同步任务里移除旧节点 + 添加新节点」的合并式 SPA swap 上死锁——
 * MutationObserver 在 swap 完成后的微任务才回调，此时 `#b_results` 已是新节点，
 * isNotExist 永不为真、栏永不重挂。且 host 挂到「被换元素的兄弟」必被一起 detach。
 * 挂持久锚点 + 手动按 URL mount/remove，这两个问题都不存在——host 的父级不参与结果重建。
 *
 * 参考：Greasyfork「移动端聚合搜索引擎导航 SearchSwitcher」Bing 分支即锚
 * `header` 一次性 appendChild，无 autoMount、无重挂——验证此模式可行。
 */
export default defineContentScript({
  matches: SERP_CONTENT_MATCH_PATTERNS,
  cssInjectionMode: 'ui',
  async main(ctx) {
    const initialUrl = window.location.href;
    const engine = matchEngineByUrl(initialUrl);
    if (!engine) return;

    // 初始化（异步读取 worker 代理的 provider 配置与主题偏好）。
    // onMount 是同步签名（返回 TMounted），异步值在此预读后经 state 闭包喂给渲染。
    const state = await loadBarState(engine, initialUrl);

    // 持久锚点策略：按当前 engine 的候选列表（首选→回退）取首个已存在的选择器；
    // 全部缺失时落到末位候选，交由 mountWhenAnchorReady 等待其出现。
    // 注：级联解析仅在 content script 启动时做一次，SPA 导航不重解析——若启动时首选
    // 选择器缺失则本次生命周期内走回退，并不劣于此前单锚点行为。
    const strategy = pickAnchor(anchorsFor(state.engine));

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
        shadowHost.dataset.engine = state.engine.id;
        shadowHost.dataset.theme = state.resolvedTheme;
        shadowHost.dataset.style = state.stylePref;
        mountedHost = shadowHost;
        syncAlignedHost(shadowHost, strategy);
        injectPageStyles(state.engine);
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
        removePageStyles();
        mounted?.root.unmount();
      },
    });
    // Google/Bing/Baidu 是 SPA：后续搜索用 history.pushState/replaceState，不重载页面、
    // 也不重新注入 content script（WXT ContentScriptContext 专门暴露 wxt:locationchange）。
    // 按 URL 手动 mount/remove：离开当前 engine 的 canonical SERP route 时卸载，返回时重挂；不使用按锚点存在性
    // 检测的 autoMount，避免合并式 DOM swap 导致死锁。
    let locationRevision = 0;
    let mountObserver: MutationObserver | null = null;
    const stopWaitingForAnchor = () => {
      mountObserver?.disconnect();
      mountObserver = null;
    };
    const mountWhenAnchorReady = (revision: number) => {
      const mountIfReady = () => {
        if (revision !== locationRevision || ui.mounted) return false;
        if (!document.querySelector(strategy.selector)) return false;
        ui.mount();
        return true;
      };
      if (mountIfReady()) return;
      mountObserver = new MutationObserver(() => {
        if (revision !== locationRevision || mountIfReady()) stopWaitingForAnchor();
      });
      mountObserver.observe(document.documentElement, { childList: true, subtree: true });
    };
    const syncLocation = (url: string) => {
      const revision = ++locationRevision;
      stopWaitingForAnchor();
      const nextEngine = matchEngineByUrl(url);
      if (!nextEngine) {
        if (ui.mounted) ui.remove();
        return;
      }
      state.engine = nextEngine;
      state.query = readQuery(nextEngine, url);
      if (!ui.mounted) {
        mountWhenAnchorReady(revision);
        return;
      }
      if (mountedHost) syncAlignedHost(mountedHost, strategy);
      if (mountedRoot) render(mountedRoot, state, nextEngine);
    };
    ctx.onInvalidated(stopWaitingForAnchor);
    ctx.addEventListener(window, 'wxt:locationchange', ({ newUrl }) => syncLocation(newUrl.href));
    syncLocation(window.location.href);

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
  stylePref: StylePref;
}

/** 读 config/theme/style/sources/query 并 resolve theme，产出 onMount 渲染所需全部值。 */
async function loadBarState(engine: SearchEngine, url: string): Promise<BarState> {
  const config = await sendMessage('getProviderConfig', undefined);
  const sources = allSources(config.configuredProviderIds, config.sourceOrder, config.sourceHidden);
  const themePref = await getThemePref();
  const stylePref = await getStylePref();
  return {
    engine,
    query: readQuery(engine, url),
    sources,
    resolvedTheme: resolveTheme(themePref),
    stylePref,
  };
}

function readQuery(engine: SearchEngine, url: string): string {
  return engine.extractQuery(url) ?? '';
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
