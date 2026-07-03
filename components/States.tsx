import { t, MSG } from '@/lib/i18n';

interface ErrorProps {
  message: string;
  onOpenSettings?: () => void;
}

export function Loading() {
  return <div className="state">{t(MSG.state_loading)}</div>;
}

export function Empty() {
  return <div className="state">{t(MSG.state_empty)}</div>;
}

export function ErrorState({ message, onOpenSettings }: ErrorProps) {
  return (
    <div className="state error">
      <p>{message}</p>
      {onOpenSettings && <button onClick={onOpenSettings}>{t(MSG.open_settings_cta)}</button>}
    </div>
  );
}
