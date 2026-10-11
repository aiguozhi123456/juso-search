import { useSlidingIndicator } from '@/components/useSlidingIndicator';
import { t, MSG } from '@/lib/i18n';

const OPTIONS = [
  { value: true, labelKey: 'selection_search_on' },
  { value: false, labelKey: 'selection_search_off' },
] as const;

/**
 * 划词搜索 2 态切换器：开（选中文本显示搜索弹窗）/ 关（不显示）。
 * 滑动指示器走共享 useSlidingIndicator（受控组件，状态由父组件管理）。
 */
interface SelectionSearchToggleProps {
  enabled: boolean;
  onChange: (value: boolean) => void;
}

export function SelectionSearchToggle({ enabled, onChange }: SelectionSearchToggleProps) {
  const { containerRef, style, isReady } = useSlidingIndicator('[data-active="true"]');

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
