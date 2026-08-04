import type { BarPositionPref, LocalePref, StylePref, ThemePref } from './storage';

export type UiPrefChangedMessage =
  | { type: 'uiPrefChanged'; key: 'themePref'; value: ThemePref }
  | { type: 'uiPrefChanged'; key: 'localePref'; value: LocalePref }
  | { type: 'uiPrefChanged'; key: 'stylePref'; value: StylePref }
  | { type: 'uiPrefChanged'; key: 'serpBarPosition'; value: BarPositionPref };

export function isUiPrefChangedMessage(message: unknown): message is UiPrefChangedMessage {
  if (!message || typeof message !== 'object') return false;
  const candidate = message as Partial<UiPrefChangedMessage>;
  if (candidate.type !== 'uiPrefChanged') return false;
  if (candidate.key === 'themePref') return candidate.value === 'auto' || candidate.value === 'light' || candidate.value === 'dark';
  if (candidate.key === 'localePref') return candidate.value === 'auto' || candidate.value === 'zh_CN' || candidate.value === 'en';
  if (candidate.key === 'stylePref') return candidate.value === 'classic' || candidate.value === 'colorful';
  if (candidate.key === 'serpBarPosition') return candidate.value === 'auto' || candidate.value === 'top' || candidate.value === 'inline' || candidate.value === 'bottom';
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
