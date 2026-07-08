import { onMessage } from '@/lib/messaging';
import {
  handleClearSearchCache,
  handleDeleteCachedSearch,
  handleExportConfig,
  handleGetCachedSearchEntry,
  handleGetProviderConfig,
  handleGetSearchCacheSummaries,
  handleImportConfig,
  handlePreviewImport,
  handleSaveProviderKey,
  handleSearch,
  handleSetActiveProvider,
  handleTestKey,
} from '@/lib/gateway';
import { isLocalePref, isThemePref, type UiPrefChangedMessage } from '@/lib/ui-pref-sync';
import { getSchemaReady } from '@/lib/gateway';

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
  onMessage('saveProviderKey', ({ data }) => handleSaveProviderKey(data.providerId, data.key));
  onMessage('getSearchCacheSummaries', () => handleGetSearchCacheSummaries());
  onMessage('getCachedSearchEntry', ({ data }) => handleGetCachedSearchEntry(data));
  onMessage('deleteCachedSearch', ({ data }) => handleDeleteCachedSearch(data));
  onMessage('clearSearchCache', () => handleClearSearchCache());
  onMessage('exportConfig', () => handleExportConfig());
  onMessage('previewImport', ({ data }) => handlePreviewImport(data));
  onMessage('importConfig', ({ data }) => handleImportConfig(data));

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
