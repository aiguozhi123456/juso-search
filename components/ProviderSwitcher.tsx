import type { ProviderAdapter, ProviderId } from '@/lib/providers/types';

interface Props {
  providers: ProviderAdapter[];
  active: ProviderId | null;
  onSwitch: (id: ProviderId) => void;
}

export function ProviderSwitcher({ providers, active, onSwitch }: Props) {
  return (
    <div className="provider-switcher">
      {providers.map((p) => (
        <button
          key={p.id}
          className={p.id === active ? 'active' : ''}
          onClick={() => onSwitch(p.id)}
          title={p.supportsAnswer ? '支持 AI 综合答案' : '仅结果（无 AI 综合答案）'}
        >
          {p.label}
          {!p.supportsAnswer && <span className="no-answer"> · 无答案</span>}
        </button>
      ))}
    </div>
  );
}
