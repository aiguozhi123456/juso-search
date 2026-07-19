type StylePref = 'classic' | 'colorful';

function isStylePref(value: unknown): value is StylePref {
  return value === 'classic' || value === 'colorful';
}

function applyStyle(pref: StylePref) {
  document.documentElement.dataset.style = pref;
}

// FOUC 防护：在 React 挂载前把 data-style 写到 <html>，避免页面先用 classic 渲染
// 再切到 colorful 造成的色彩闪烁。默认 classic（与无 JS 路径一致）。
try {
  applyStyle('classic');
  if (typeof browser !== 'undefined' && browser.storage?.local) {
    void browser.storage.local.get('stylePref')
      .then((got) => {
        const pref = got.stylePref;
        if (isStylePref(pref)) applyStyle(pref);
      })
      .catch(() => undefined);
  }
} catch {
  // 非 extension / dev 回退：data-style="classic" 已写入，CSS classic tokens 生效。
}
