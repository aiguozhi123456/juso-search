import { useSlidingIndicator } from '@/components/useSlidingIndicator';
import { t, MSG } from '@/lib/i18n';

const OPTIONS = [
  { value: true, labelKey: 'ai_auto_enter_on' },
  { value: false, labelKey: 'ai_auto_enter_off' },
] as const;

/**
 * AI 自动回车 2 态切换器：开（自动提交）/ 关（仅预填）。
 * 滑动指示器走共享 useSlidingIndicator（受控组件，状态由父组件管理）。
 */
interface AiAutoEnterToggleProps {
  enabled: boolean;
  onChange: (value: boolean) => void;
}

export function AiAutoEnterToggle({ enabled, onChange }: AiAutoEnterToggleProps) {
  const { containerRef, style, isReady } = useSlidingIndicator('[data-active="true"]');

  return (
    <div ref={containerRef} className="ai-auto-enter-toggle" role="group" aria-label={t(MSG.ai_auto_enter_group)} data-active={enabled ? 'true' : 'false'} style={style}>
      {isReady && <span className="ai-auto-enter-toggle-indicator" aria-hidden="true" />}
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
