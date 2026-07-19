import { useEffect, useState } from 'react';
import { getStylePref, setStylePref as persistPref } from './storage';
import type { StylePref } from './storage';
import { isUiPrefChangedMessage } from './ui-pref-sync';

export type { StylePref };

/**
 * UI 风格维度（与 theme 正交）：classic（朱砂经典）/ colorful（分布式多色）。
 *
 * 与 useTheme 的差异：无 system/auto 概念 —— style 是显式选择，默认 classic。
 * 其余约定与 useTheme 一致：
 *   - 初始从 chrome.storage.local 读取（默认 classic）；
 *   - 监听 worker 广播的脱敏变更（多页 / 多标签同步）；
 *   - 乐观更新 + persist 失败回滚；
 *   - resolved 写入 document.documentElement.dataset.style。
 *
 * data-style 在 React 挂载前由 style-init module 写入，挂载后由本 hook 接管。
 */
export function useStyle(): { pref: StylePref; setPref: (pref: StylePref) => void } {
  const [pref, setPrefState] = useState<StylePref>('classic');

  useEffect(() => {
    let alive = true;
    void getStylePref().then((stored) => {
      if (!alive) return;
      setPrefState(stored);
    });
    const onMessage = (message: unknown) => {
      if (isUiPrefChangedMessage(message) && message.key === 'stylePref') setPrefState(message.value);
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => {
      alive = false;
      browser.runtime.onMessage.removeListener(onMessage);
    };
  }, []);

  // 写 <html data-style>，让 CSS 的 [data-style="colorful"] overrides 生效
  useEffect(() => {
    document.documentElement.dataset.style = pref;
  }, [pref]);

  const setPref = (next: StylePref) => {
    const prev = pref;
    setPrefState(next);
    void persistPref(next).catch(() => {
      setPrefState(prev);
    });
  };

  return { pref, setPref };
}
