import { useBarPosition, type BarPositionPref } from '@/lib/useBarPosition';
import { useSlidingIndicator } from '@/components/useSlidingIndicator';
import { t, MSG } from '@/lib/i18n';
import { MonitorIcon } from '@/components/icons';

/** 顶栏位图标：圆角框 + 顶部填充条。 */
function TopIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <rect x="7" y="6" width="10" height="3" rx="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** 底栏位图标：圆角框 + 底部填充条。 */
function BottomIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <rect x="7" y="15" width="10" height="3" rx="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** 内联栏位图标：圆角框 + 居中填充条（内容区垂直居中）。 */
function InlineIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <rect x="7" y="10.5" width="10" height="3" rx="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

type IconComponent = typeof MonitorIcon;

const OPTIONS: { value: BarPositionPref; Icon: IconComponent; labelKey: keyof typeof MSG }[] = [
  { value: 'auto', Icon: MonitorIcon, labelKey: 'bar_position_auto' },
  { value: 'top', Icon: TopIcon, labelKey: 'bar_position_top' },
  { value: 'inline', Icon: InlineIcon, labelKey: 'bar_position_inline' },
  { value: 'bottom', Icon: BottomIcon, labelKey: 'bar_position_bottom' },
];

/**
 * 4 态快切栏栏位切换器：自动 / 顶栏（覆盖）/ 内联 / 底栏。
 *
 * 指示器语言：用位置图标（显示器 / 顶栏框 / 底栏框）替代文字，更直观地表达栏位。
 * 滑动指示器走共享 useSlidingIndicator（六处分段控件的单一实现）：
 *   - 测量激活段 offsetLeft/Top/Width/Height，经 CSS 变量喂给 .bar-position-toggle-indicator；
 *   - 测量失败（jsdom 0 offset）→ 不渲染指示器，回退 active 段直接实色 bg。
 *
 * 与 ThemeToggle 平行：role="group" + aria-label + aria-pressed，仅用图标
 * （文字标签保留在 title / aria-label 供无障碍与 tooltip）。
 */
export function BarPositionToggle() {
  const { pref, setPref } = useBarPosition();
  const { containerRef, style, isReady } = useSlidingIndicator('[data-active="true"]');

  return (
    <div
      ref={containerRef}
      className="bar-position-toggle"
      role="group"
      aria-label={t(MSG.bar_position_group)}
      data-active-position={pref}
      style={style}
    >
      {isReady && <span className="bar-position-toggle-indicator" aria-hidden="true" />}
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
            <opt.Icon size={16} />
          </button>
        );
      })}
    </div>
  );
}
