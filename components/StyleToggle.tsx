import { useStyle, type StylePref } from '@/lib/useStyle';
import { useSlidingIndicator } from '@/components/useSlidingIndicator';
import { t, MSG } from '@/lib/i18n';

const OPTIONS: { value: StylePref; labelKey: keyof typeof MSG }[] = [
  { value: 'classic', labelKey: 'style_classic' },
  { value: 'colorful', labelKey: 'style_colorful' },
];

/**
 * 2 态风格切换器：经典（朱砂）/ 彩色（分布式类别色）。
 *
 * 滑动指示器走共享 useSlidingIndicator（六处分段控件的单一实现）：
 *   - 测量激活段 offsetLeft/Top/Width/Height，经 CSS 变量喂给 .style-toggle-indicator；
 *   - 测量失败（jsdom 0 offset）→ 不渲染指示器，回退 active 段直接实色 bg。
 *
 * 与 ThemeToggle 平行：role="group" + aria-label + aria-pressed，但只用文字标签
 * （"经典"/"彩色"文字已经明确表达选择，无需额外图标）。
 */
export function StyleToggle() {
  const { pref, setPref } = useStyle();
  const { containerRef, style, isReady } = useSlidingIndicator('[data-active="true"]');

  return (
    <div
      ref={containerRef}
      className="style-toggle"
      role="group"
      aria-label={t(MSG.style_group)}
      data-active-style={pref}
      style={style}
    >
      {isReady && <span className="style-toggle-indicator" aria-hidden="true" />}
      {OPTIONS.map((opt) => {
        const active = pref === opt.value;
        const label = t(MSG[opt.labelKey]);
        return (
          <button
            key={opt.value}
            type="button"
            className={active ? 'active' : ''}
            data-active={active ? 'true' : 'false'}
            onClick={() => setPref(opt.value)}
            title={label}
            aria-label={label}
            aria-pressed={active}
          >
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
