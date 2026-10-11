import type { BarPositionPref, LocalePref, StylePref, ThemePref } from './storage';

export type UiPrefChangedMessage =
  | { type: 'uiPrefChanged'; key: 'themePref'; value: ThemePref }
  | { type: 'uiPrefChanged'; key: 'localePref'; value: LocalePref }
  | { type: 'uiPrefChanged'; key: 'stylePref'; value: StylePref }
  | { type: 'uiPrefChanged'; key: 'serpBarPosition'; value: BarPositionPref }
  | { type: 'uiPrefChanged'; key: 'selectionSearchEnabled'; value: boolean };

export function isUiPrefChangedMessage(message: unknown): message is UiPrefChangedMessage {
  if (!message || typeof message !== 'object') return false;
  const candidate = message as Partial<UiPrefChangedMessage>;
  if (candidate.type !== 'uiPrefChanged') return false;
  // 枚举校验复用下方各 pref 的守卫（单一定义点）：广播侧（background）与接收侧
  // （本函数）必须对同一 pref 的合法值集保持一致，内联重写字面量枚举会静默漂移。
  if (candidate.key === 'themePref') return isThemePref(candidate.value);
  if (candidate.key === 'localePref') return isLocalePref(candidate.value);
  if (candidate.key === 'stylePref') return isStylePref(candidate.value);
  if (candidate.key === 'serpBarPosition') return isBarPositionPref(candidate.value);
  if (candidate.key === 'selectionSearchEnabled') return typeof candidate.value === 'boolean';
  return false;
}

export function isThemePref(value: unknown): value is ThemePref {
  return value === 'auto' || value === 'light' || value === 'dark';
}

export function isLocalePref(value: unknown): value is LocalePref {
  return value === 'auto' || value === 'zh_CN' || value === 'en';
}

export function isStylePref(value: unknown): value is StylePref {
  return value === 'classic' || value === 'colorful';
}

export function isBarPositionPref(value: unknown): value is BarPositionPref {
  return value === 'auto' || value === 'top' || value === 'inline' || value === 'bottom';
}
