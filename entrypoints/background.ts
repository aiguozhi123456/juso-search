import { onMessage } from '@/lib/messaging';
import {
  handleClearSearchCache,
  handleDeleteCachedSearch,
  handleDeleteProviderKey,
  handleDeleteSiteEngine,
  handleCreateSiteEngine,
  handleCreateCustomEngine,
  handleUpdateCustomEngine,
  handleDeleteCustomEngine,
  handleCreateProviderInstance,
  handleUpdateProviderInstance,
  handleDeleteProviderInstance,
  handleExportConfig,
  handleGetCachedSearchEntry,
  handleGetProviderConfig,
  handleGetSearchCacheSummaries,
  handleImportConfig,
  handleListAgentInstances,
  handleListAgentProviders,
  handlePreviewImport,
  handleSaveProviderKey,
  handleSearch,
  handleSearchInstance,
  handleSetActiveProvider,
  handleSetActiveSource,
  handleClearProviderMaxResults,
  handleSetProviderMaxResults,
  handleSetSourceHidden,
  handleSetSourceOrder,
  handleSetGroupConfig,
  handleTestKey,
  handleUpdateSiteEngine,
} from '@/lib/gateway';
import { isBarPositionPref, isLocalePref, isStylePref, isThemePref, type UiPrefChangedMessage } from '@/lib/ui-pref-sync';
import { buildSafeSearchUrl } from '@/lib/search-page-url';
import { getSchemaReady } from '@/lib/gateway';
import { isTrustedBridgeSender, runAgentBridge } from '@/lib/agent-bridge';
import { runEngineSearch } from '@/lib/engine-search';
import { getAgentBridgeEnabled, getEngineSearchEnabled } from '@/lib/storage';
import { sanitizeOpenNewTabUrl } from '@/lib/custom-engines';

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
  onMessage('setGroupConfig', ({ data }) => handleSetGroupConfig(data));
  onMessage('createSiteEngine', ({ data }) => handleCreateSiteEngine(data));
  onMessage('updateSiteEngine', ({ data }) => handleUpdateSiteEngine(data));
  onMessage('deleteSiteEngine', ({ data }) => handleDeleteSiteEngine(data));
  onMessage('createCustomEngine', ({ data }) => handleCreateCustomEngine(data));
  onMessage('updateCustomEngine', ({ data }) => handleUpdateCustomEngine(data));
  onMessage('deleteCustomEngine', ({ data }) => handleDeleteCustomEngine(data));
  onMessage('createProviderInstance', ({ data }) => handleCreateProviderInstance(data));
  onMessage('updateProviderInstance', ({ data }) => handleUpdateProviderInstance(data));
  onMessage('deleteProviderInstance', ({ data }) => handleDeleteProviderInstance(data));
  onMessage('openNewTab', ({ data, sender }) => {
    // sender.tab 只保证存在一个 tab 上下文——内容脚本与「在标签页打开的扩展页」都有 tab，
    // 故此检查并不用于区分内容脚本。真正的安全边界是 sanitizeOpenNewTabUrl 内的 http/https
    // 协议白名单（并拒绝凭据）；此处仅先确保有 tab 可导航。
    const tabId = sender.tab?.id;
    if (tabId === undefined) return;
    const target = sanitizeOpenNewTabUrl(data);
    if (!target) {
      console.warn('[openNewTab] rejected URL', data);
      return;
    }
    void browser.tabs.create({ url: target }).catch((e) => console.warn('[openNewTab] tabs.create failed', e));
  });
  onMessage('saveProviderKey', ({ data }) => handleSaveProviderKey(data.providerId, data.key));
  onMessage('deleteProviderKey', ({ data }) => handleDeleteProviderKey(data));
  onMessage('setProviderMaxResults', ({ data }) => handleSetProviderMaxResults(data.providerId, data.maxResults));
  onMessage('clearProviderMaxResults', ({ data }) => handleClearProviderMaxResults(data));
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
    // 双层门控（默认 false，上架合规）：
    //   - 总开关 off → 整个 Agent Bridge 拒绝（search / list-providers / engine-search 全不响应）。
    //   - engine-search 子开关 off → engine-search 落 extract-failed；其余 action 不受影响。
    if (!(await getAgentBridgeEnabled())) return { ok: false };
    return runAgentBridge(data, {
      fetch: (...args) => fetch(...args),
      handleSearch,
      listProviders: handleListAgentProviders,
      handleSearchInstance: handleSearchInstance,
      listInstances: handleListAgentInstances,
      handleEngineSearch: async (request, signal) => {
        if (!(await getEngineSearchEnabled())) {
          return { engine: request.engineId, query: request.query, error: 'extract-failed' };
        }
        return runEngineSearch(request, signal, { tabs: browser.tabs });
      },
    });
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
    const stylePref = changes.stylePref?.newValue;
    if (isStylePref(stylePref)) {
      void broadcastUiPref({ type: 'uiPrefChanged', key: 'stylePref', value: stylePref });
    }
    const barPosition = changes.serpBarPosition?.newValue;
    if (isBarPositionPref(barPosition)) {
      void broadcastUiPref({ type: 'uiPrefChanged', key: 'serpBarPosition', value: barPosition });
    }
  });
});

async function broadcastUiPref(message: UiPrefChangedMessage): Promise<void> {
  await browser.runtime.sendMessage(message).catch(() => undefined);
}
