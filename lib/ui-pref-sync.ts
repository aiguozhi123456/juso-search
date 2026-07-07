import type { LocalePref, ThemePref } from './storage';

export type UiPrefChangedMessage =
  | { type: 'uiPrefChanged'; key: 'themePref'; value: ThemePref }
  | { type: 'uiPrefChanged'; key: 'localePref'; value: LocalePref };

export function isUiPrefChangedMessage(message: unknown): message is UiPrefChangedMessage {
  if (!message || typeof message !== 'object') return false;
  const candidate = message as Partial<UiPrefChangedMessage>;
  if (candidate.type !== 'uiPrefChanged') return false;
  if (candidate.key === 'themePref') return candidate.value === 'auto' || candidate.value === 'light' || candidate.value === 'dark';
  if (candidate.key === 'localePref') return candidate.value === 'auto' || candidate.value === 'zh_CN' || candidate.value === 'en';
  return false;
}

export function isThemePref(value: unknown): value is ThemePref {
  return value === 'auto' || value === 'light' || value === 'dark';
}

export function isLocalePref(value: unknown): value is LocalePref {
  return value === 'auto' || value === 'zh_CN' || value === 'en';
}
