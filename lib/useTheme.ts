import { useEffect, useMemo, useState } from 'react';
import { getThemePref, setThemePref as persistPref } from './storage';
import type { ThemePref } from './storage';
import { isUiPrefChangedMessage } from './ui-pref-sync';

export type { ThemePref };
export type ResolvedTheme = 'light' | 'dark';

/** 系统当前是否偏好深色（SSR/无 matchMedia 时默认浅色）。 */
function systemPrefersDark(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** auto → 跟随系统；light/dark 直接返回。 */
function resolve(pref: ThemePref, sysDark: boolean): ResolvedTheme {
  if (pref === 'auto') return sysDark ? 'dark' : 'light';
  return pref;
}

export interface UseTheme {
  pref: ThemePref;
  resolved: ResolvedTheme;
  setPref: (pref: ThemePref) => void;
}

/**
 * 主题偏好与解析。
 * - 初始化从 chrome.storage.local 读取（默认 auto）。
   * - 监听 worker 广播的脱敏偏好变更实现多页/多标签同步。
 * - auto 模式下监听 prefers-color-scheme 变化实时更新。
 * - resolved 由 pref + systemDark 派生（单一写入路径），写入 document.documentElement.dataset.theme。
 *
 * 注意：data-theme 在挂载前由 theme-init module + CSS media fallback 尽早写入，本 hook 接管挂载后的维护。
 */
export function useTheme(): UseTheme {
  const [pref, setPrefState] = useState<ThemePref>('auto');
  // 系统深色偏好作为独立状态，便于 auto 模式下 matchMedia 变化时触发派生重算
  const [systemDark, setSystemDark] = useState<boolean>(() => systemPrefersDark());

  // 初始读取 + 监听 worker 广播的脱敏变更（多页/多标签同步）
  useEffect(() => {
    let alive = true;
    void getThemePref().then((stored) => {
      if (!alive) return;
      setPrefState(stored);
    });
    const onMessage = (message: unknown) => {
      if (isUiPrefChangedMessage(message) && message.key === 'themePref') setPrefState(message.value);
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => {
      alive = false;
      browser.runtime.onMessage.removeListener(onMessage);
    };
  }, []);

  // auto 模式下跟随系统偏好。无 matchMedia 时（部分受限/隐私 webview）安全降级，不抛错。
  useEffect(() => {
    if (pref !== 'auto') return;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(systemPrefersDark());
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [pref]);

  // resolved 单一派生路径：pref + systemDark → ResolvedTheme
  const resolved = useMemo(() => resolve(pref, systemDark), [pref, systemDark]);

  // 把解析结果写到 <html data-theme>
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  const setPref = (next: ThemePref) => {
    const prev = pref;
    setPrefState(next); // 乐观更新，立即响应 UI
    void persistPref(next).catch(() => {
      // persist 失败（配额/争用）→ 回滚，避免状态与存储长期不一致
      setPrefState(prev);
    });
  };

  return { pref, resolved, setPref };
}
