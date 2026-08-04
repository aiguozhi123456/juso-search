import { useEffect, useState } from 'react';
import { getBarPositionPref, setBarPositionPref as persistPref } from './storage';
import type { BarPositionPref } from './storage';
import { isUiPrefChangedMessage } from './ui-pref-sync';

export type { BarPositionPref };

/**
 * 快切栏栏位偏好：auto（默认：桌面解析为内联，窄屏 ≤480px 解析为底栏）/ top（固定覆盖顶栏）/ inline（内联引擎锚点插入）/ bottom（固定覆盖底栏）。
 *
 * 与 useStyle 的差异：bar position 仅由内容脚本消费，不写入 options 页 DOM，
 * 因此无 dataset 副作用。其余约定与 useStyle 一致：
 *   - 初始从 chrome.storage.local 读取（默认 auto）；
 *   - 监听 worker 广播的脱敏变更（多页 / 多标签同步）；
 *   - 乐观更新 + persist 失败回滚。
 *
 * 回滚安全：persist 失败时，先重新读取 storage 当前值再回滚，而非盲目回退到
 * 写入前的本地值——避免在并发写入场景下覆盖另一标签页已持久化的更新。
 */
export function useBarPosition(): { pref: BarPositionPref; setPref: (pref: BarPositionPref) => void } {
  const [pref, setPrefState] = useState<BarPositionPref>('auto');

  useEffect(() => {
    let alive = true;
    void getBarPositionPref().then((stored) => {
      if (!alive) return;
      setPrefState(stored);
    });
    const onMessage = (message: unknown) => {
      if (isUiPrefChangedMessage(message) && message.key === 'serpBarPosition') setPrefState(message.value);
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => {
      alive = false;
      browser.runtime.onMessage.removeListener(onMessage);
    };
  }, []);

  const setPref = (next: BarPositionPref) => {
    setPrefState(next);
    void persistPref(next).catch(async () => {
      // 回滚前重读 storage：若另一标签页已写入更新，采纳它而非盲目回退旧值。
      const current = await getBarPositionPref();
      setPrefState(current);
    });
  };

  return { pref, setPref };
}
