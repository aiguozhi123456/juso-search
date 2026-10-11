import { useEffect, useRef, useSyncExternalStore } from 'react';
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
  // 挂载读取在途期间用户/跨标签广播可能已切换 locale：迟到的 stored 值不得覆盖更新的选择。
  const supersededRef = useRef(false);

  // 初始化 + 监听 worker 广播的脱敏变更（多页/多标签同步）
  useEffect(() => {
    let alive = true;
    void getLocalePref()
      .then((stored) => {
        if (!alive || supersededRef.current) return;
        applyLocalePref(stored);
      })
      .catch(() => {
        // 读取失败：保留 i18n 模块当前 locale（默认 auto），避免 unhandled rejection。
      });
    const onMessage = (message: unknown) => {
      if (isUiPrefChangedMessage(message) && message.key === 'localePref') {
        supersededRef.current = true;
        setLocale(message.value);
      }
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
    supersededRef.current = true; // 本地新选择比在途挂载读取新
    setLocale(next); // 乐观更新，立即响应 UI
    void persistPref(next).catch(() => setLocale(prev)); // 失败回滚
  };

  return { pref, setPref };
}
