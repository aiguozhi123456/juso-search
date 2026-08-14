import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { t, MSG } from '@/lib/i18n';

const OPTIONS = [
  { value: true, labelKey: 'selection_search_on' },
  { value: false, labelKey: 'selection_search_off' },
] as const;

interface IndicatorMetrics { x: number; y: number; w: number; h: number; }

/**
 * 划词搜索 2 态切换器：开（选中文本显示搜索弹窗）/ 关（不显示）。
 * 复用 StyleToggle/FlatLayoutToggle 的滑动指示器机制（受控组件，状态由父组件管理）。
 */
interface SelectionSearchToggleProps {
  enabled: boolean;
  onChange: (value: boolean) => void;
}

export function SelectionSearchToggle({ enabled, onChange }: SelectionSearchToggleProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<IndicatorMetrics | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) { setIndicator(null); return; }
    const activeBtn = container.querySelector<HTMLButtonElement>('[data-active="true"]');
    if (!activeBtn) { setIndicator(null); return; }
    setIndicator({ x: activeBtn.offsetLeft, y: activeBtn.offsetTop, w: activeBtn.offsetWidth, h: activeBtn.offsetHeight });
  }, [enabled]);

  const isReady = indicator != null && indicator.w > 0;
  const style = isReady
    ? ({ '--indicator-x': `${indicator!.x}px`, '--indicator-y': `${indicator!.y}px`, '--indicator-w': `${indicator!.w}px`, '--indicator-h': `${indicator!.h}px` } as CSSProperties)
    : undefined;

  return (
    <div ref={containerRef} className="selection-search-toggle" role="group" aria-label={t(MSG.selection_search_group)} data-active={enabled ? 'true' : 'false'} style={style}>
      {isReady && <span className="selection-search-toggle-indicator" aria-hidden="true" />}
      {OPTIONS.map((opt) => {
        const active = enabled === opt.value;
        const label = t(MSG[opt.labelKey]);
        return (
          <button key={String(opt.value)} type="button" className={active ? 'active' : ''} data-active={active ? 'true' : 'false'} onClick={() => onChange(opt.value)} title={label} aria-label={label} aria-pressed={active}>
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
