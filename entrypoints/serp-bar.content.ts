import { createElement } from 'react';
import type { Root } from 'react-dom/client';
import { createRoot } from 'react-dom/client';
import { sendMessage } from '@/lib/messaging';
import type { ProviderConfigReply } from '@/lib/messaging';
import { allSources } from '@/lib/sources';
import type { SearchEngine } from '@/lib/engines/types';
import type { SearchSource, SourceId } from '@/lib/sources';
import type { GroupConfig } from '@/lib/source-groups';
import { defaultGroupConfig } from '@/lib/source-groups';
import { SourceSwitcher } from '@/components/SourceSwitcher';
import { matchEngineByUrl, anchorsFor } from '@/lib/engines/registry';
import type { AnchorStrategy } from '@/lib/engines/types';
import {
  decidePostWriteSiteEngineNavigation,
  nextQueryAfterSerpContext,
  resolveCurrentSiteEngineHandoff,
  resolveSerpContext,
  resolveSerpHandoff,
} from '@/lib/serp-handoff';
import { getStylePref, getThemePref, getBarPositionPref } from '@/lib/storage';
import type { StylePref, BarPositionPref } from '@/lib/storage';
import { isUiPrefChangedMessage } from '@/lib/ui-pref-sync';
import { serpBarStyles } from '@/entrypoints/shared/serp-bar-styles';
import { calculateAlignedHostLayout } from '@/lib/serp-bar-layout';
import {
  pickAnchor,
  injectPageStyles,
  removePageStyles,
  injectBottomPadStyles,
  removeBottomPadStyles,
  resolveBarPosition,
  canAttemptMount,
  shouldUpgradeFromLastResort,
  shouldMountForEngine,
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
  runAt: 'document_idle',
  async main(ctx) {
    const initialUrl = window.location.href;
    const engine = matchEngineByUrl(initialUrl);
    if (!engine) return;

    const state = await loadBarState(engine, initialUrl);
    // 当前 engine 被用户隐藏时不在快切栏投影中——在其结果页注入栏只会得到
    // 无激活目标的残栏，故不挂载（重载亦然，因判定每次 mount 都做）。
    if (!shouldMountForEngine(engine.id, state.sourceHidden, state.activeSiteId)) return;

    // 当前选用的锚点策略；每次 pick 后更新，供 append 回调与对齐布局使用。
    let strategy = pickAnchor(anchorsFor(state.engine));

    let mountedRoot: Root | null = null;
    let mountedHost: HTMLElement | null = null;
    // 当前挂载所用候选在 engine.anchors 中的 index（0=首选）；用于升级判断。
    let mountedAnchorIndex = -1;

    // Serialize chip selects like the search page (switchReqIdRef): a late
    // applyConfigSnapshot / setActiveSource / location.assign from an older
    // click must not race a newer selection.
    let selectGen = 0;
    let selecting = false;

    // 底栏滚动隐藏：向下滑动藏栏、向上滑动显栏；近顶部始终显示。
    const SCROLL_HIDE_THRESHOLD = 8;
    let lastScrollY = 0;

    /**
     * Apply position chrome: dataset, pageStyles vs pad, scroll-hide baseline.
     * Does NOT render — callers re-render when React props (e.g. bottomMode) must change.
     */
    const applyPositionChrome = (pos: 'top' | 'bottom', opts?: { resetScrollBaseline?: boolean }) => {
      if (!mountedHost) return;
      mountedHost.dataset.position = pos;
      if (pos === 'bottom') {
        // bottom must NOT keep top-bar engine shims (Douyin etc.)
        removePageStyles();
        injectBottomPadStyles();
        delete mountedHost.dataset.hidden;
        if (opts?.resetScrollBaseline !== false) lastScrollY = window.scrollY;
      } else {
        removeBottomPadStyles();
        injectPageStyles(state.engine);
        delete mountedHost.dataset.hidden;
        lastScrollY = 0;
      }
    };

    const handleScrollHide = () => {
      if (!mountedHost || state.resolvedPosition !== 'bottom') return;
      const currentY = window.scrollY;
      // 近顶部始终显示，避免页面顶端无栏可用。
      if (currentY < 10) {
        delete mountedHost.dataset.hidden;
        lastScrollY = currentY;
        return;
      }
      const delta = currentY - lastScrollY;
      // 仅在有意义位移时切换，避免微小抖动反复触发。
      if (Math.abs(delta) < SCROLL_HIDE_THRESHOLD) return;
      if (delta > 0) {
        // 向下滑动——藏栏。SourceSwitcher 经 MutationObserver 关 flyout。
        mountedHost.dataset.hidden = 'true';
      } else {
        // 向上滑动——显栏。
        delete mountedHost.dataset.hidden;
      }
      lastScrollY = currentY;
    };

    /** Apply a fresh provider config onto local bar state and re-render chips. */
    const applyConfigSnapshot = (config: ProviderConfigReply) => {
      const sources = allSources(
        config.configuredProviderIds,
        config.sourceOrder,
        config.sourceHidden,
        config.siteEngines ?? [],
      );
      const rawQuery = readQuery(state.engine, window.location.href);
      const context = resolveSerpContext(
        state.engine.id,
        rawQuery,
        config.siteEngines ?? [],
        config.activeSourceId,
        config.sourceOrder,
        config.sourceHidden,
      );
      state.sources = sources;
      state.sourceHidden = config.sourceHidden;
      // Unresolved/deleted Site Engines no longer strip scope; keep the in-memory
      // base query rather than adopting the raw site-scoped SERP query.
      state.query = nextQueryAfterSerpContext(context, rawQuery, state.query);
      state.activeSiteId = context.matchingSiteId;
      state.activeId = context.activeId;
      // Hidden backing engine with no visible matching site: tear the bar down.
      if (!shouldMountForEngine(state.engine.id, state.sourceHidden, state.activeSiteId)) {
        safeRemove();
        return;
      }
      if (mountedRoot) render(mountedRoot, state, selectSource, selecting);
    };

    const selectSource = (source: SearchSource) => {
      // Mirror search-page: ignore clicks while a select is already in flight
      // (SourceSwitcher is also disabled during selecting).
      if (selecting) return;
      const gen = ++selectGen;
      selecting = true;
      if (mountedRoot) render(mountedRoot, state, selectSource, true);
      void (async () => {
        try {
          await onSelect(source, state.query, applyConfigSnapshot, () => gen === selectGen);
        } finally {
          if (gen === selectGen) {
            selecting = false;
            if (mountedRoot) render(mountedRoot, state, selectSource, false);
          }
        }
      })();
    };

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
        // pageStyles only in top mode; bottom removes engine shims and pads the page.
        applyPositionChrome(state.resolvedPosition);
        const mountEl = document.createElement('div');
        uiContainer.append(mountEl);
        const root = createRoot(mountEl);
        mountedRoot = root;
        render(root, state, selectSource, selecting);
        return { root };
      },
      onRemove(mounted) {
        mountedRoot = null;
        mountedHost = null;
        mountedAnchorIndex = -1;
        lastScrollY = 0;
        removePageStyles();
        removeBottomPadStyles();
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
        lastScrollY = 0;
        removePageStyles();
        removeBottomPadStyles();
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

    const syncLocation = async (url: string) => {
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
      // Refresh config on SPA navigation: site definitions, order and persisted
      // active source can change without a full document reload.
      const refreshed = await loadBarState(nextEngine, url);
      if (revision !== locationRevision) return;
      state.sources = refreshed.sources;
      state.sourceHidden = refreshed.sourceHidden;
      state.query = refreshed.query;
      state.activeId = refreshed.activeId;
      state.activeSiteId = refreshed.activeSiteId;
      state.barPositionPref = refreshed.barPositionPref;
      state.resolvedPosition = refreshed.resolvedPosition;
      // SPA 导航可能带回更新后的分组配置（设置页改过 layout）。
      if (refreshed.groupConfig) state.groupConfig = refreshed.groupConfig;
      // SPA 导航到被隐藏 engine 的结果页：移除栏且不再重挂。
      // 反向（从隐藏 engine 导航回可见 engine）由后续正常挂载路径恢复。
      if (!shouldMountForEngine(nextEngine.id, state.sourceHidden, state.activeSiteId)) {
        safeRemove();
        return;
      }
      state.engine = nextEngine;
      strategy = pickAnchor(anchorsFor(nextEngine));
      const hostOrphaned = Boolean(mountedHost && !document.contains(mountedHost));
      if (!ui.mounted || hostOrphaned || !mountedHost) {
        if (ui.mounted) safeRemove();
        mountWhenAnchorReady(revision);
        return;
      }
      applyPositionChrome(state.resolvedPosition);
      syncAlignedHost(mountedHost, strategy);
      if (mountedRoot) render(mountedRoot, state, selectSource, selecting);
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
    ctx.addEventListener(window, 'wxt:locationchange', ({ newUrl }) => { void syncLocation(newUrl.href); });
    if (window.location.href === initialUrl) {
      remountBudget = DEFAULT_REMOUNT_BUDGET;
      mountWhenAnchorReady(locationRevision);
    } else {
      void syncLocation(window.location.href);
    }

    ctx.addEventListener(window, 'resize', () => {
      if (mountedHost && document.contains(mountedHost)) {
        syncAlignedHost(mountedHost, strategy);
        const next = resolveBarPosition(state.barPositionPref, window.innerWidth);
        if (next !== state.resolvedPosition) {
          state.resolvedPosition = next;
          applyPositionChrome(next);
          // bottomMode 进 React 树：位置变化必须 re-render。
          if (mountedRoot) render(mountedRoot, state, selectSource, selecting);
        }
      }
    });

    // 底栏滚动隐藏：passive 监听，handler 内部按 resolvedPosition 早退。
    ctx.addEventListener(window, 'scroll', handleScrollHide, { passive: true });

    // 实时同步栏位偏好：用户在设置页切换 serpBarPosition 时，已打开的 SERP 标签
    // 无需刷新即可生效。与 theme/style 不同——栏位切换的"无反应"体验比换色更突兀。
    const onPrefMessage = (message: unknown) => {
      if (!isUiPrefChangedMessage(message) || message.key !== 'serpBarPosition') return;
      state.barPositionPref = message.value;
      const next = resolveBarPosition(message.value, window.innerWidth);
      if (next === state.resolvedPosition) return;
      state.resolvedPosition = next;
      if (!mountedHost) return;
      applyPositionChrome(next);
      if (mountedRoot) render(mountedRoot, state, selectSource, selecting);
    };
    browser.runtime.onMessage.addListener(onPrefMessage);
    ctx.onInvalidated(() => {
      browser.runtime.onMessage.removeListener(onPrefMessage);
    });
  },
});

interface BarState {
  engine: SearchEngine;
  query: string;
  sources: SearchSource[];
  sourceHidden: SourceId[];
  groupConfig: GroupConfig;
  /** Visible matching site source, if this backing-engine query was generated by one. */
  activeSiteId: SourceId | null;
  /** Chip to highlight: visible Site Engine first, otherwise the backing engine. */
  activeId: SourceId;
  resolvedTheme: 'light' | 'dark';
  stylePref: StylePref;
  barPositionPref: BarPositionPref;
  resolvedPosition: 'top' | 'bottom';
}

async function loadBarState(engine: SearchEngine, url: string): Promise<BarState> {
  const [config, themePref, stylePref, barPositionPref] = await Promise.all([
    sendMessage('getProviderConfig', undefined),
    getThemePref(),
    getStylePref(),
    getBarPositionPref(),
  ]);
  const sources = allSources(config.configuredProviderIds, config.sourceOrder, config.sourceHidden, config.siteEngines ?? []);
  const rawQuery = readQuery(engine, url);
  const context = resolveSerpContext(
    engine.id,
    rawQuery,
    config.siteEngines ?? [],
    config.activeSourceId,
    config.sourceOrder,
    config.sourceHidden,
  );
  return {
    engine,
    query: context.baseQuery,
    sources,
    sourceHidden: config.sourceHidden,
    groupConfig: config.groupConfig,
    activeSiteId: context.matchingSiteId,
    activeId: context.activeId,
    resolvedTheme: resolveTheme(themePref),
    stylePref,
    barPositionPref,
    resolvedPosition: resolveBarPosition(barPositionPref, window.innerWidth),
  };
}

function readQuery(engine: SearchEngine, url: string): string {
  return engine.extractQuery(url) ?? '';
}

function render(
  root: Root,
  state: BarState,
  onSelectSource: (source: SearchSource) => void,
  disabled = false,
): void {
  root.render(
    createElement(SourceSwitcher, {
      sources: state.sources,
      groupConfig: state.groupConfig ?? defaultGroupConfig([]),
      activeId: state.activeId,
      onSelect: onSelectSource,
      disabled,
      bottomMode: state.resolvedPosition === 'bottom',
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

/**
 * SERP chip select. `isCurrent` is the generation guard from the content-script
 * main scope: after every await, bail if a newer select has superseded this one
 * so we never applyConfigSnapshot / setActiveSource / navigate for a stale gen.
 */
async function onSelect(
  source: SearchSource,
  query: string,
  onUnresolvedSiteEngine?: (config: ProviderConfigReply) => void,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  if (source.kind === 'site-engine') {
    let config: ProviderConfigReply;
    try {
      // A Site Engine chip contains a render-time snapshot. Re-resolve it so
      // Options edits/deletions cannot navigate with stale scoped metadata.
      config = await sendMessage('getProviderConfig', undefined);
    } catch {
      return;
    }
    if (!isCurrent()) return;
    const handoff = resolveCurrentSiteEngineHandoff(source.id, query, config.siteEngines ?? []);
    if (!handoff || handoff.kind !== 'navigate') {
      // Deleted / unresolved: drop the stale chip from local bar state; no navigation.
      onUnresolvedSiteEngine?.(config);
      return;
    }
    // Persist active source before navigating so a failed write does not leave
    // storage out of sync while the tab has already left the SERP.
    try {
      await sendMessage('setActiveSource', source.id);
    } catch {
      return;
    }
    if (!isCurrent()) return;
    // Prefer one post-write read so definitions match storage (Options may have
    // edited/deleted the same Site Engine between the pre-write and post-write reads).
    try {
      config = await sendMessage('getProviderConfig', undefined);
    } catch {
      // Write succeeded; keep navigating with the pre-write handoff URL.
      if (!isCurrent()) return;
      location.assign(handoff.url);
      return;
    }
    if (!isCurrent()) return;
    const decision = decidePostWriteSiteEngineNavigation(
      source.id,
      query,
      config.siteEngines ?? [],
      handoff.url,
    );
    if (decision.kind === 'navigate') {
      location.assign(decision.url);
      return;
    }
    // Deleted between write and re-read: refresh local bar chips; do not navigate.
    onUnresolvedSiteEngine?.(config);
    return;
  }
  if (!isCurrent()) return;
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
