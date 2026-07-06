import type { ProviderAdapter, ProviderId } from '@/lib/providers/types';
import { t, MSG } from '@/lib/i18n';

interface Props {
  providers: ProviderAdapter[];
  active: ProviderId | null;
  onSwitch: (id: ProviderId) => void;
  disabled?: boolean;
}

export function ProviderSwitcher({ providers, active, onSwitch, disabled }: Props) {
  return (
    <div className="provider-switcher">
      {providers.map((p) => (
        <button
          key={p.id}
          className={p.id === active ? 'active' : ''}
          disabled={disabled}
          onClick={() => onSwitch(p.id)}
          title={p.supportsAnswer ? t(MSG.tooltip_supports_answer) : t(MSG.tooltip_no_answer)}
        >
          {t(p.label)}
          {!p.supportsAnswer && <span className="no-answer">{t(MSG.provider_no_answer_badge)}</span>}
        </button>
      ))}
    </div>
  );
}
