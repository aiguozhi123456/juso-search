type ThemePref = 'auto' | 'light' | 'dark';

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref === 'auto') return systemPrefersDark() ? 'dark' : 'light';
  return pref;
}

function isThemePref(value: unknown): value is ThemePref {
  return value === 'auto' || value === 'light' || value === 'dark';
}

function applyTheme(pref: ThemePref) {
  document.documentElement.dataset.theme = resolveTheme(pref);
}

try {
  applyTheme('auto');
  if (typeof browser !== 'undefined' && browser.storage?.local) {
    void browser.storage.local.get('themePref')
      .then((got) => {
        const pref = got.themePref;
        if (isThemePref(pref)) applyTheme(pref);
      })
      .catch(() => undefined);
  }
} catch {
  // Non-extension/dev fallback: CSS light tokens and prefers-color-scheme media query still apply.
}
