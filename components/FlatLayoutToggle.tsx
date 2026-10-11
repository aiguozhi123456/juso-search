import { useSlidingIndicator } from '@/components/useSlidingIndicator';
import { t, MSG } from '@/lib/i18n';

const OPTIONS = [
  { value: true, labelKey: 'flat_layout_few_sources_on' },
  { value: false, labelKey: 'flat_layout_few_sources_off' },
] as const;

/**
 * 少量来源自动平铺 2 态切换器：开（源少时自动平铺到顶层）/ 关（始终按分组渲染）。
 * 滑动指示器走共享 useSlidingIndicator（受控组件，状态由父组件管理）。
 */
interface FlatLayoutToggleProps {
  enabled: boolean;
  onChange: (value: boolean) => void;
}

export function FlatLayoutToggle({ enabled, onChange }: FlatLayoutToggleProps) {
  const { containerRef, style, isReady } = useSlidingIndicator('[data-active="true"]');

  return (
    <div ref={containerRef} className="flat-layout-toggle" role="group" aria-label={t(MSG.flat_layout_few_sources_group)} data-active={enabled ? 'true' : 'false'} style={style}>
      {isReady && <span className="flat-layout-toggle-indicator" aria-hidden="true" />}
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
