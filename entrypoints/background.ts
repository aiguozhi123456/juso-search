import { onMessage } from '@/lib/messaging';
import { handleGetProviderConfig, handleSaveProviderKey, handleSearch, handleSetActiveProvider, handleTestKey } from '@/lib/gateway';

export default defineBackground(() => {
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
});
