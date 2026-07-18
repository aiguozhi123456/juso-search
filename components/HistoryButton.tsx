import { t, MSG } from '@/lib/i18n';
import { HistoryIcon } from './icons';

export function HistoryButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  const label = t(MSG.history_button);
  return (
    <button
      type="button"
      className="history-button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      <HistoryIcon size={18} />
    </button>
  );
}
