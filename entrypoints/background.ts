import { onMessage } from '@/lib/messaging';
import {
  handleClearSearchCache,
  handleDeleteCachedSearch,
  handleDeleteProviderKey,
  handleExportConfig,
  handleGetCachedSearchEntry,
  handleGetProviderConfig,
  handleGetSearchCacheSummaries,
  handleImportConfig,
  handleListAgentProviders,
  handlePreviewImport,
  handleSaveProviderKey,
  handleSearch,
  handleSetActiveProvider,
  handleSetActiveSource,
  handleSetSourceHidden,
  handleSetSourceOrder,
  handleTestKey,
} from '@/lib/gateway';
import { isLocalePref, isThemePref, type UiPrefChangedMessage } from '@/lib/ui-pref-sync';
import { buildSafeSearchUrl } from '@/lib/search-page-url';
import { getSchemaReady } from '@/lib/gateway';
import { isTrustedBridgeSender, runAgentBridge } from '@/lib/agent-bridge';
import { runEngineSearch } from '@/lib/engine-search';

export default defineBackground(() => {
  // 预热 schema 迁移：worker 启动即触发 ensureSchema+ensureCacheSchema（懒加载 memoized），
  // 让首条消息到达前迁移大概率已完成。handler 仍会 await getSchemaReady() 兜底。
  void getSchemaReady();
  // 独立扩展页：点工具栏图标在标签页打开搜索页（无 default_popup，onClicked 才会触发）
  browser.action.onClicked.addListener(() => {
    browser.tabs.create({ url: browser.runtime.getURL('/search.html') });
  });

  // API 网关：key 仅在此 worker 内读取并发往 provider（R7）
  onMessage('search', ({ data }) => handleSearch(data));
  onMessage('testKey', ({ data }) => handleTestKey(data));
  onMessage('getProviderConfig', () => handleGetProviderConfig());
  onMessage('setActiveProvider', ({ data }) => handleSetActiveProvider(data));
  onMessage('setActiveSource', ({ data }) => handleSetActiveSource(data));
  onMessage('setSourceOrder', ({ data }) => handleSetSourceOrder(data));
  onMessage('setSourceHidden', ({ data }) => handleSetSourceHidden(data));
  onMessage('saveProviderKey', ({ data }) => handleSaveProviderKey(data.providerId, data.key));
  onMessage('deleteProviderKey', ({ data }) => handleDeleteProviderKey(data));
  // SERP 注入栏把「跳 Juso 搜索页」委托给 worker：网页上下文直接 location.assign 到
  // chrome-extension:// 会被客户端拦截（ERR_BLOCKED_BY_CLIENT），只能在特权上下文用
  // tabs.update 导航当前 tab。buildSafeSearchUrl 固定 base=/search.html 并白名单转发
  // provider/query 参数，防止误用 caller 把当前 tab 导航到 options.html 等特权页。
  onMessage('openSearchPage', ({ data, sender }) => {
    const tabId = sender.tab?.id;
    if (tabId === undefined) {
      console.warn('[openSearchPage] no sender tab; ignoring');
      return; // 非内容脚本来源（无 tab），安全跳过
    }
    const target = buildSafeSearchUrl(data);
    if (!target) {
      console.warn('[openSearchPage] rejected deep link', data);
      return;
    }
    void browser.tabs
      .update(tabId, { url: target })
      .catch((e) => console.warn('[openSearchPage] tabs.update failed', tabId, e));
  });
  onMessage('getSearchCacheSummaries', () => handleGetSearchCacheSummaries());
  onMessage('getCachedSearchEntry', ({ data }) => handleGetCachedSearchEntry(data));
  onMessage('deleteCachedSearch', ({ data }) => handleDeleteCachedSearch(data));
  onMessage('clearSearchCache', () => handleClearSearchCache());
  onMessage('exportConfig', () => handleExportConfig());
  onMessage('previewImport', ({ data }) => handlePreviewImport(data));
  onMessage('importConfig', ({ data }) => handleImportConfig(data));
  onMessage('agentBridgeClaim', async ({ data, sender }) => {
    if (!isTrustedBridgeSender(sender, browser.runtime.id)) return { ok: false };
    return runAgentBridge(data, { fetch, handleSearch, listProviders: handleListAgentProviders, handleEngineSearch: (request, signal) => runEngineSearch(request, signal, { tabs: browser.tabs }) });
  });

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    const themePref = changes.themePref?.newValue;
    if (isThemePref(themePref)) {
      void broadcastUiPref({ type: 'uiPrefChanged', key: 'themePref', value: themePref });
    }
    const localePref = changes.localePref?.newValue;
    if (isLocalePref(localePref)) {
      void broadcastUiPref({ type: 'uiPrefChanged', key: 'localePref', value: localePref });
    }
  });
});

async function broadcastUiPref(message: UiPrefChangedMessage): Promise<void> {
  await browser.runtime.sendMessage(message).catch(() => undefined);
}
