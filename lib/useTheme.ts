import { useEffect, useState } from 'react';
import { getThemePref, setThemePref as persistPref } from './storage';
import type { ThemePref } from './storage';

export type { ThemePref };
export type ResolvedTheme = 'light' | 'dark';

/** 系统当前是否偏好深色（SSR/无 matchMedia 时默认浅色）。 */
function systemPrefersDark(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** auto → 跟随系统；light/dark 直接返回。 */
function resolve(pref: ThemePref): ResolvedTheme {
  if (pref === 'auto') return systemPrefersDark() ? 'dark' : 'light';
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
 * - auto 模式下监听 prefers-color-scheme 变化实时更新。
 * - 把解析结果写入 document.documentElement.dataset.theme，供 tokens.css 的 [data-theme] 选择器消费。
 */
export function useTheme(): UseTheme {
  const [pref, setPrefState] = useState<ThemePref>('auto');
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve('auto'));

  // 初始读取 + 监听 storage 变更（多页/多标签同步）
  useEffect(() => {
    let alive = true;
    void getThemePref().then((stored) => {
      if (!alive) return;
      setPrefState(stored);
      setResolved(resolve(stored));
    });
    const onChanged = (changes: { themePref?: { newValue?: unknown } }) => {
      const nv = changes.themePref?.newValue;
      if (nv === 'auto' || nv === 'light' || nv === 'dark') {
        setPrefState(nv);
        setResolved(resolve(nv));
      }
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => {
      alive = false;
      browser.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  // auto 模式下跟随系统偏好
  useEffect(() => {
    if (pref !== 'auto') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setResolved(systemPrefersDark() ? 'dark' : 'light');
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [pref]);

  // 把解析结果写到 <html data-theme>
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  const setPref = (next: ThemePref) => {
    setPrefState(next);
    setResolved(resolve(next));
    void persistPref(next);
  };

  return { pref, resolved, setPref };
}
