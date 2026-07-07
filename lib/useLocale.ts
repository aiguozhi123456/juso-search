import { useEffect, useSyncExternalStore } from 'react';
import {
  applyLocalePref,
  getCurrentLocalePref,
  subscribeLocale,
  setLocale,
  type LocalePref,
} from './i18n';
import { getLocalePref, setLocalePref as persistPref } from './storage';
import { isUiPrefChangedMessage } from './ui-pref-sync';

export type { LocalePref };

/**
 * UI 语言偏好与切换。
 * - 初始化从 chrome.storage.local 读取（默认 auto）。
  * - 订阅 i18n 模块的 locale 变化（手动切换或跨标签 worker 广播同步），触发组件重渲染。
 * - setPref 乐观更新 + 持久化失败回滚（与 useTheme 同模式）。
 */
export function useLocale(): { pref: LocalePref; setPref: (pref: LocalePref) => void } {
  // 初始化 + 监听 worker 广播的脱敏变更（多页/多标签同步）
  useEffect(() => {
    let alive = true;
    void getLocalePref().then((stored) => {
      if (!alive) return;
      applyLocalePref(stored);
    });
    const onMessage = (message: unknown) => {
      if (isUiPrefChangedMessage(message) && message.key === 'localePref') setLocale(message.value);
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => {
      alive = false;
      browser.runtime.onMessage.removeListener(onMessage);
    };
  }, []);

  // 订阅 i18n 模块，locale 变化时触发重渲染（useSyncExternalStore 保证一致性）
  const pref = useSyncExternalStore(subscribeLocale, getCurrentLocalePref, getCurrentLocalePref);

  const setPref = (next: LocalePref) => {
    const prev = pref;
    setLocale(next); // 乐观更新，立即响应 UI
    void persistPref(next).catch(() => setLocale(prev)); // 失败回滚
  };

  return { pref, setPref };
}
