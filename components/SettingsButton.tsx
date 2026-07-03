import { t, MSG } from '@/lib/i18n';

interface SettingsButtonProps {
  onClick: () => void;
}

// 顶栏常驻「设置」入口，点击经 background 打开独立设置标签页。
export function SettingsButton({ onClick }: SettingsButtonProps) {
  const label = t(MSG.open_settings);
  return (
    <button
      type="button"
      className="settings-button"
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      ⚙
    </button>
  );
}
