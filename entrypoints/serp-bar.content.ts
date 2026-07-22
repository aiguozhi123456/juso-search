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
import {
  pickAnchor,
  injectPageStyles,
  removePageStyles,
  canAttemptMount,
  shouldUpgradeFromLastResort,
  consumeRemountBudget,
  DEFAULT_REMOUNT_BUDGET,
} from '@/lib/serp-bar-mount';
import { SERP_CONTENT_MATCH_PATTERNS } from '@/lib/engines/scopes';

/**
 * v2 SERP 注入快切栏：在常规搜索引擎结果页注入一行 chip。
 *
 * ## 锚点策略
 * 每个 engine 在 `anchors` 声明候选；**每次 mount 时**通过 `pickAnchor` 重选
 * （小红书/抖音等 SPA 会延迟渲染或重建 DOM）。
 *
 * ## 宿主被 SPA 拆掉
 * 挂载后若 shadow host 被网页从 document 移除，detach observer 节流后
 * `ui.remove()` 再 `mountWhenAnchorReady`，并有每 locationRevision 的重挂预算。
 *
 * ## 兜底升级（仅 last-resort）
 * 仅当挂在末位兜底（如 #app）时，非兜底候选出现才升级 remount。
 * 禁止「#search-input → .feeds-container」跳位（小红书必然位置抖动）。
 *
 * WXT `anchor`/`append` 支持函数：mount 时再解析，才能吃到动态 pick 的结果。
 */
export default defineContentScript({
  matches: SERP_CONTENT_MATCH_PATTERNS,
  cssInjectionMode: 'ui',
  runAt: 'document_idle',
  async main(ctx) {
    const initialUrl = window.location.href;
    const engine = matchEngineByUrl(initialUrl);
    if (!engine) return;

    const state = await loadBarState(engine, initialUrl);

    // 当前选用的锚点策略；每次 pick 后更新，供 append 回调与对齐布局使用。
    let strategy = pickAnchor(anchorsFor(state.engine));

    let mountedRoot: Root | null = null;
    let mountedHost: HTMLElement | null = null;
    // 当前挂载所用候选在 engine.anchors 中的 index（0=首选）；用于升级判断。
    let mountedAnchorIndex = -1;

    const ui = await createShadowRootUi<{ root: Root }>(ctx, {
      name: 'juso-serp-bar',
      position: 'inline',
      // 函数锚点：每次 mountUi→getAnchor 时重选候选（首选→回退）。
      anchor: () => {
        strategy = pickAnchor(anchorsFor(state.engine));
        return strategy.selector;
      },
      // 自定义 append：按当前 strategy.append 插入。before/after 无 parent 时硬失败，
      // 避免 onMount 跑完但 host 不在 document 里（ui.mounted 与 DOM 脱节）。
      append: (anchor, root) => {
        switch (strategy.append) {
          case 'first':
            anchor.prepend(root);
            break;
          case 'last':
            anchor.append(root);
            break;
          case 'replace':
            anchor.replaceWith(root);
            break;
          case 'after': {
            const parent = anchor.parentElement;
            if (!parent) throw new Error('serp-bar: after-append needs parentElement');
            parent.insertBefore(root, anchor.nextElementSibling);
            break;
          }
          case 'before':
          default: {
            const parent = anchor.parentElement;
            if (!parent) throw new Error('serp-bar: before-append needs parentElement');
            parent.insertBefore(root, anchor);
            break;
          }
        }
      },
      css: serpBarStyles,
      onMount(uiContainer, _shadow, shadowHost) {
        shadowHost.dataset.engine = state.engine.id;
        shadowHost.dataset.theme = state.resolvedTheme;
        shadowHost.dataset.style = state.stylePref;
        mountedHost = shadowHost;
        mountedAnchorIndex = anchorsFor(state.engine).findIndex((c) => c.selector === strategy.selector);
        if (mountedAnchorIndex < 0) mountedAnchorIndex = 0;
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
        mountedAnchorIndex = -1;
        removePageStyles();
        mounted?.root.unmount();
      },
    });

    let locationRevision = 0;
    let mountObserver: MutationObserver | null = null;
    let detachObserver: MutationObserver | null = null;
    let upgradeObserver: MutationObserver | null = null;
    let detachRemountTimer: ReturnType<typeof setTimeout> | null = null;
    // 每个 locationRevision 的重挂预算，防止敌对 SPA 无限重建拖垮扩展。
    let remountBudget = 0;
    const DETACH_REMOUNT_MS = 80;

    const stopWaitingForAnchor = () => {
      mountObserver?.disconnect();
      mountObserver = null;
    };
    const stopWatchingDetach = () => {
      detachObserver?.disconnect();
      detachObserver = null;
    };
    const stopWatchingUpgrade = () => {
      upgradeObserver?.disconnect();
      upgradeObserver = null;
    };
    const clearDetachRemountTimer = () => {
      if (detachRemountTimer != null) {
        clearTimeout(detachRemountTimer);
        detachRemountTimer = null;
      }
    };

    const safeRemove = () => {
      try {
        if (ui.mounted) ui.remove();
      } catch {
        // WXT remove 失败时仍清本地句柄，避免假 mounted 态。
        mountedRoot = null;
        mountedHost = null;
        mountedAnchorIndex = -1;
        removePageStyles();
      }
    };

    const mountWhenAnchorReady = (revision: number) => {
      // 防止并发 wait 叠多个 document 级 MutationObserver。
      stopWaitingForAnchor();
      clearDetachRemountTimer();

      const mountIfReady = () => {
        if (revision !== locationRevision) return false;
        // host 已被 SPA 拆掉但 WXT 仍认为 mounted：先清理再重挂。
        if (ui.mounted) {
          if (mountedHost && document.contains(mountedHost)) return false;
          safeRemove();
        }
        const candidates = anchorsFor(state.engine);
        if (!canAttemptMount({
          candidates,
          remountBudget,
          querySelectorFn: (s) => document.querySelector(s),
        })) return false;
        // mount 前再校验 revision，避免 locationchange 竞态挂到过期 URL。
        if (revision !== locationRevision) return false;
        remountBudget = consumeRemountBudget(remountBudget);
        strategy = pickAnchor(candidates);
        try {
          ui.mount();
        } catch {
          return false;
        }
        if (revision !== locationRevision) {
          safeRemove();
          return false;
        }
        if (!mountedHost || !document.contains(mountedHost)) {
          safeRemove();
          return false;
        }
        watchHostDetachment(revision);
        watchLastResortUpgrade(revision);
        return true;
      };

      if (mountIfReady()) return;
      mountObserver = new MutationObserver(() => {
        if (revision !== locationRevision || mountIfReady()) stopWaitingForAnchor();
      });
      mountObserver.observe(document.documentElement, { childList: true, subtree: true });
    };

    /**
     * 仅当挂在末位兜底（#app）时，非兜底候选出现才升级。
     * 不从 #search-input 跳到 .feeds-container——那是小红书必然抖动的根因。
     */
    const watchLastResortUpgrade = (revision: number) => {
      stopWatchingUpgrade();
      const candidates = anchorsFor(state.engine);
      if (!isLastResortMounted(candidates, mountedAnchorIndex)) return;
      upgradeObserver = new MutationObserver(() => {
        if (revision !== locationRevision) return;
        if (!shouldUpgradeFromLastResort({
          candidates: anchorsFor(state.engine),
          mountedAnchorIndex,
          querySelectorFn: (s) => document.querySelector(s),
        })) return;
        stopWatchingUpgrade();
        stopWatchingDetach();
        safeRemove();
        if (revision === locationRevision) mountWhenAnchorReady(revision);
      });
      upgradeObserver.observe(document.documentElement, { childList: true, subtree: true });
    };

    /** 监视 shadow host 是否被网页从 document 移除；节流后重挂。 */
    const watchHostDetachment = (revision: number) => {
      stopWatchingDetach();
      detachObserver = new MutationObserver(() => {
        if (revision !== locationRevision) return;
        if (!mountedHost) return;
        if (document.contains(mountedHost)) return;
        stopWatchingDetach();
        stopWatchingUpgrade();
        // 节流：同一 revision 下合并多次 detach burst，避免 React 根抖动。
        clearDetachRemountTimer();
        detachRemountTimer = setTimeout(() => {
          detachRemountTimer = null;
          if (revision !== locationRevision) return;
          safeRemove();
          if (revision === locationRevision && remountBudget > 0) {
            mountWhenAnchorReady(revision);
          }
        }, DETACH_REMOUNT_MS);
      });
      detachObserver.observe(document.documentElement, { childList: true, subtree: true });
    };

    const syncLocation = (url: string) => {
      const revision = ++locationRevision;
      remountBudget = DEFAULT_REMOUNT_BUDGET;
      stopWaitingForAnchor();
      stopWatchingDetach();
      stopWatchingUpgrade();
      clearDetachRemountTimer();
      const nextEngine = matchEngineByUrl(url);
      if (!nextEngine) {
        safeRemove();
        return;
      }
      state.engine = nextEngine;
      state.query = readQuery(nextEngine, url);
      strategy = pickAnchor(anchorsFor(nextEngine));
      const hostOrphaned = Boolean(mountedHost && !document.contains(mountedHost));
      if (!ui.mounted || hostOrphaned || !mountedHost) {
        if (ui.mounted) safeRemove();
        mountWhenAnchorReady(revision);
        return;
      }
      if (mountedHost) syncAlignedHost(mountedHost, strategy);
      if (mountedRoot) render(mountedRoot, state, nextEngine);
      watchHostDetachment(revision);
      watchLastResortUpgrade(revision);
    };

    ctx.onInvalidated(() => {
      stopWaitingForAnchor();
      stopWatchingDetach();
      stopWatchingUpgrade();
      clearDetachRemountTimer();
      safeRemove();
    });
    ctx.addEventListener(window, 'wxt:locationchange', ({ newUrl }) => syncLocation(newUrl.href));
    syncLocation(window.location.href);

    ctx.addEventListener(window, 'resize', () => {
      if (mountedHost && document.contains(mountedHost)) syncAlignedHost(mountedHost, strategy);
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
  const targetRect = target.getBoundingClientRect();
  const targetStyle = readHorizontalBoxStyle(window.getComputedStyle(target));
  const layout = calculateAlignedHostLayout(
    parent.getBoundingClientRect(),
    readHorizontalBoxStyle(window.getComputedStyle(parent)),
    targetRect,
    targetStyle,
  );
  host.style.setProperty('--juso-serp-offset-left', `${layout.offsetLeft}px`, 'important');
  host.style.setProperty('--juso-serp-width', `${layout.width}px`, 'important');
  // 视口绝对 left：供 position:fixed 宿主（抖音）对齐内容列。
  const viewportLeft = targetRect.left + targetStyle.borderLeft + targetStyle.paddingLeft;
  host.style.setProperty('--juso-serp-left', `${viewportLeft}px`, 'important');
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

function isLastResortMounted(candidates: { selector: string }[], index: number): boolean {
  return candidates.length > 1 && index === candidates.length - 1;
}
