import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useStyle, type StylePref } from '@/lib/useStyle';
import { t, MSG } from '@/lib/i18n';

const OPTIONS: { value: StylePref; labelKey: keyof typeof MSG }[] = [
  { value: 'classic', labelKey: 'style_classic' },
  { value: 'colorful', labelKey: 'style_colorful' },
];

interface IndicatorMetrics {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 2 态风格切换器：经典（朱砂）/ 彩色（分布式类别色）。
 *
 * 复用 SourceSwitcher 的滑动指示器语言（更小尺寸）：
 *   - useLayoutEffect 在激活段切换时测量其 offsetLeft/Top/Width/Height；
 *   - 通过 CSS 变量 --indicator-x/y/w/h 把位置喂给 .style-toggle-indicator；
 *   - 测量失败（jsdom 0 offset）→ 不渲染指示器，回退到 active 段直接实色 bg。
 *
 * 与 ThemeToggle 平行：role="group" + aria-label + aria-pressed，但只用文字标签
 * （"经典"/"彩色"文字已经明确表达选择，无需额外图标）。
 */
export function StyleToggle() {
  const { pref, setPref } = useStyle();
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<IndicatorMetrics | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      setIndicator(null);
      return;
    }
    const activeBtn = container.querySelector<HTMLButtonElement>('[data-active="true"]');
    if (!activeBtn) {
      setIndicator(null);
      return;
    }
    setIndicator({
      x: activeBtn.offsetLeft,
      y: activeBtn.offsetTop,
      w: activeBtn.offsetWidth,
      h: activeBtn.offsetHeight,
    });
  }, [pref]);

  const isReady = indicator != null && indicator.w > 0;
  const style = isReady
    ? ({
        '--indicator-x': `${indicator!.x}px`,
        '--indicator-y': `${indicator!.y}px`,
        '--indicator-w': `${indicator!.w}px`,
        '--indicator-h': `${indicator!.h}px`,
      } as CSSProperties)
    : undefined;

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
