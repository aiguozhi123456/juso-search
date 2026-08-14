// 划词搜索 content script：选中文本后显示搜索弹窗。
//
// 弹窗结构（详见 components/SelectionSearchPopup.tsx）：
//   主 chip（固定源，点击即搜） + 展开按钮（hover/click 出分组源列表）
//
// 生命周期：
//   - 启动读 selectionSearchEnabled；关闭则不弹窗（仍注册 pref sync 以便实时开启）
//   - mouseup(capture) → requestAnimationFrame → 读 selection → 非空且不在输入框内 → showPopup
//   - mousedown(capture) 点击弹窗外部 → dismissPopup
//   - Escape → dismissPopup
//   - selectionchange → 选区折叠时 dismissPopup
//   - uiPrefChanged(selectionSearchEnabled) → 实时更新 enabled 标志
//
// 权限模型：matches *://*/* 全局注入（MV3 content_scripts.matches 本身即注入授权），
// 排除 SERP 结果页（SERP 快切栏已覆盖）。WAR <all_urls> 确保 favicon 在所有页面可加载。
//
// 定位：position:absolute 挂 document.documentElement，用鼠标坐标 + scrollX/Y 转为
// 页面坐标定位（弹窗随页面滚动，不随视口固定）。视口边缘翻转（flyout 朝上/朝下）。

import { createElement } from 'react';
import type { Root } from 'react-dom/client';
import { createRoot } from 'react-dom/client';
import { sendMessage } from '@/lib/messaging';
import { allSources } from '@/lib/sources';
import type { SearchSource } from '@/lib/sources';
import { resolveSerpHandoff } from '@/lib/serp-handoff';
import { getSelectionSearchEnabled, getSelectionSearchSource, getThemePref, getStylePref, getLocalePref } from '@/lib/storage';
import type { StylePref } from '@/lib/storage';
import { applyLocalePref, setLocale } from '@/lib/i18n';
import { isUiPrefChangedMessage } from '@/lib/ui-pref-sync';
import { SERP_CONTENT_MATCH_PATTERNS } from '@/lib/engines/scopes';
import type { GroupConfig } from '@/lib/source-groups';
import { computePosition } from '@/lib/selection-search-position';
import { createInsidePointerGuard } from '@/lib/selection-search-dismiss';
import { SelectionSearchPopup } from '@/components/SelectionSearchPopup';
import { selectionSearchStyles } from '@/entrypoints/shared/selection-search-styles';

interface PopupState {
  sources: SearchSource[];
  groupConfig: GroupConfig;
  primarySource: SearchSource;
  aiAutoEnter: boolean;
  flatLayoutFewSources: boolean;
  theme: 'light' | 'dark';
  stylePref: StylePref;
  x: number;
  y: number;
  flyoutUp: boolean;
  subFlyoutLeft: boolean;
  subFlyoutUp: boolean;
}

export default defineContentScript({
  matches: ['*://*/*'],
  excludeMatches: [...SERP_CONTENT_MATCH_PATTERNS],
  runAt: 'document_idle',
  async main(ctx) {
    let enabled = await getSelectionSearchEnabled();
    let currentQuery = '';
    let mountedHost: HTMLElement | null = null;
    let popupState: PopupState | null = null;
    let showEpoch = 0;
    // 弹窗内指针按下守卫：压制「弹窗内 mousedown 折叠选区 → selectionchange 误关弹窗」。
    const guard = createInsidePointerGuard();

    const ui = await createShadowRootUi<{ root: Root }>(ctx, {
      name: 'juso-selection-search',
      position: 'inline',
      anchor: () => 'html',
      append: (_anchor, root) => {
        (document.documentElement ?? document.body).appendChild(root);
      },
      css: selectionSearchStyles,
      onMount(uiContainer, _shadow, shadowHost) {
        const state = popupState;
        if (!state) return { root: null as unknown as Root };
        // 不在 shadowHost 上设 position/left/top——WXT 注入的 :host { all: initial !important }
        // 会覆盖 inline 样式。改为在内部 wrapper 上设 position:absolute（host reset 触达不到内部元素）。
        shadowHost.dataset.theme = state.theme;
        shadowHost.dataset.style = state.stylePref;
        shadowHost.dataset.flyoutUp = state.flyoutUp ? 'true' : 'false';
        shadowHost.dataset.subFlyoutLeft = state.subFlyoutLeft ? 'true' : 'false';
        shadowHost.dataset.subFlyoutUp = state.subFlyoutUp ? 'true' : 'false';
        mountedHost = shadowHost;
        const wrapper = document.createElement('div');
        wrapper.style.position = 'absolute';
        wrapper.style.zIndex = '2147483646';
        wrapper.style.left = `${state.x}px`;
        wrapper.style.top = `${state.y}px`;
        uiContainer.append(wrapper);
        const root = createRoot(wrapper);
        root.render(createElement(SelectionSearchPopup, {
          sources: state.sources,
          groupConfig: state.groupConfig,
          primarySource: state.primarySource,
          flatLayoutFewSources: state.flatLayoutFewSources,
          onSearch: handleSearch,
        }));
        return { root };
      },
      onRemove(mounted) {
        mountedHost = null;
        mounted?.root?.unmount();
      },
    });

    function dismissPopup() {
      if (ui.mounted) {
        try { ui.remove(); } catch { /* WXT remove 失败时仍清本地句柄 */ }
      }
      mountedHost = null;
      // 防跨弹窗重建泄漏：弹窗内 mousedown 置位的压制标志必须随 dismiss 清除，
      // 否则重建后的弹窗会误压制本应发生的 selectionchange 关闭（弹窗内按下拖出弹窗松开、
      // 触屏 pointercancel、中途禁用开关等场景）。
      guard.clear();
    }

    function handleSearch(source: SearchSource) {
      const handoff = resolveSerpHandoff(source, currentQuery, { aiAutoEnter: popupState?.aiAutoEnter ?? true });
      dismissPopup();
      if (!handoff) return;
      if (handoff.kind === 'navigate') {
        void sendMessage('openNewTab', handoff.url);
      } else {
        void sendMessage('openSearchPageNewTab', handoff.deepLink);
      }
    }

    async function showPopup(text: string, mouseX: number, mouseY: number) {
      dismissPopup();
      currentQuery = text;
      const epoch = ++showEpoch;
      try {
        const [config, themePref, stylePref, localePref, fixedSourceId] = await Promise.all([
          sendMessage('getProviderConfig', undefined),
          getThemePref(),
          getStylePref(),
          getLocalePref(),
          getSelectionSearchSource(),
        ]);
        if (epoch !== showEpoch) return; // 被更新的 showPopup 取代
        applyLocalePref(localePref);
        const sources = allSources(
          config.configuredProviderIds,
          config.sourceOrder,
          config.sourceHidden,
          config.siteEngines ?? [],
          config.customEngines ?? [],
          config.providerInstances ?? [],
        );
        if (sources.length === 0) return;
        // 解析主源：固定源优先（须仍可见），否则跟随激活源，否则首个可见源。
        let primarySource: SearchSource | undefined;
        if (fixedSourceId) {
          primarySource = sources.find((s) => s.id === fixedSourceId);
        }
        if (!primarySource) {
          primarySource = sources.find((s) => s.id === config.activeSourceId);
        }
        primarySource ??= sources[0];
        if (!primarySource) return;
        const pos = computePosition(mouseX, mouseY);
        // 转为页面坐标：position:absolute 随页面滚动，不随视口固定。
        // 子浮层边缘翻转：弹窗靠近视口右侧时子浮层向左展开。
        const subFlyoutLeft = pos.x + 520 > window.innerWidth;
        const subFlyoutUp = pos.flyoutUp;
        popupState = {
          sources,
          groupConfig: config.groupConfig,
          primarySource,
          aiAutoEnter: config.aiAutoEnter ?? true,
          flatLayoutFewSources: config.flatLayoutFewSources ?? true,
          theme: resolveTheme(themePref),
          stylePref,
          x: pos.x + window.scrollX,
          y: pos.y + window.scrollY,
          flyoutUp: pos.flyoutUp,
          subFlyoutLeft,
          subFlyoutUp,
        };
        ui.mount();
      } catch {
        // 配置加载或挂载失败——静默不弹窗。
      }
    }

    // === 事件处理 ===

    function handleMouseUp(event: MouseEvent) {
      if (!enabled) return;
      // 点击在弹窗内部时不触发新弹窗（让弹窗自己的 onClick 处理）。
      if (mountedHost && event.composedPath().includes(mountedHost)) {
        // mousedown 默认动作已过、selectionchange 塌陷已派发（若被折叠），清除压制标志防陈旧。
        guard.clear();
        return;
      }
      // 捕获鼠标坐标（event 在 rAF 后可能被回收）。
      const mx = event.clientX;
      const my = event.clientY;
      // requestAnimationFrame：等浏览器完成双击选词扩展后再读 selection。
      requestAnimationFrame(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
          dismissPopup();
          return;
        }
        const text = selection.toString().trim();
        if (!text || text.length > 500) { dismissPopup(); return; }
        // 输入框内划词通常是编辑操作——不弹窗。
        const anchor = selection.anchorNode;
        if (anchor) {
          const el = anchor.nodeType === Node.ELEMENT_NODE ? (anchor as Element) : anchor.parentElement;
          if (el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
            dismissPopup();
            return;
          }
        }
        // 用鼠标坐标定位（弹窗出现在光标附近）。
        void showPopup(text, mx, my);
      });
    }

    function handleMouseDown(event: MouseEvent) {
      // 记录本次 mousedown 是否在弹窗内：内部 → 记录 true 并放行（click 由弹窗处理）；
      // 外部 → 记录 false 并关闭。
      if (guard.noteMouseDown(event.composedPath(), mountedHost)) return;
      dismissPopup();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') dismissPopup();
    }

    function handleSelectionChange() {
      if (!mountedHost) return;
      // 弹窗内指针按下引起的选区塌陷不应关闭弹窗（如点击分组容器等普通 div：
      // mousedown 默认动作折叠划词选区 → selectionchange，click 尚未到达）。
      if (guard.shouldSuppressSelectionDismiss()) return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) dismissPopup();
    }

    function onPrefMessage(message: unknown) {
      if (!isUiPrefChangedMessage(message)) return;
      if (message.key === 'selectionSearchEnabled') {
        enabled = message.value;
        if (!enabled) dismissPopup();
        return;
      }
      if (message.key === 'localePref') {
        setLocale(message.value);
      }
    }

    // === 注册监听 ===

    ctx.addEventListener(document, 'mouseup', handleMouseUp, { capture: true });
    ctx.addEventListener(document, 'mousedown', handleMouseDown, { capture: true });
    ctx.addEventListener(document, 'keydown', handleKeyDown);
    ctx.addEventListener(document, 'selectionchange', handleSelectionChange);

    browser.runtime.onMessage.addListener(onPrefMessage);
    ctx.onInvalidated(() => {
      dismissPopup();
      browser.runtime.onMessage.removeListener(onPrefMessage);
    });
  },
});

function resolveTheme(pref: 'auto' | 'light' | 'dark'): 'light' | 'dark' {
  if (pref === 'auto') {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return pref;
}
