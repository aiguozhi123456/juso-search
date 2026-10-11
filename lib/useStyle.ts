import { useEffect, useRef, useState } from 'react';
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
  // 最新值 ref：回滚基准。渲染闭包捕获的 prev 在连续快速切换（未重渲染）时会陈旧。
  const prefRef = useRef<StylePref>('classic');
  // 挂载读取在途期间用户/跨标签广播可能已切换 style：迟到的 stored 值不得覆盖更新的选择。
  const supersededRef = useRef(false);
  const applyPref = (next: StylePref) => {
    prefRef.current = next;
    setPrefState(next);
  };

  useEffect(() => {
    let alive = true;
    void getStylePref()
      .then((stored) => {
        if (!alive || supersededRef.current) return;
        applyPref(stored);
      })
      .catch(() => {
        // 读取失败：保持默认 classic（style-init 预挂载已写同值），避免 unhandled rejection。
      });
    const onMessage = (message: unknown) => {
      if (isUiPrefChangedMessage(message) && message.key === 'stylePref') {
        supersededRef.current = true;
        applyPref(message.value);
      }
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
    const prev = prefRef.current;
    supersededRef.current = true; // 本地新选择比在途挂载读取新
    applyPref(next);
    void persistPref(next).catch(async () => {
      // 回滚安全（与 useBarPosition 同模式）：重读 storage 采纳当前真实值，
      // 而非盲目回退写前值——并发写入/连续切换时不会覆盖更新的成功值。
      try {
        applyPref(await getStylePref());
      } catch {
        // 重读失败：仅当状态仍持有本次乐观值时回退（ref 基准，非渲染闭包的陈旧 prev）。
        if (prefRef.current === next) applyPref(prev);
      }
    });
  };

  return { pref, setPref };
}
