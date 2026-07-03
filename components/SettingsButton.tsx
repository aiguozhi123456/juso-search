interface SettingsButtonProps {
  onClick: () => void;
}

// 顶栏常驻「设置」入口，点击经 background 打开独立设置标签页。
// title/aria-label 为可访问性文案（i18n 化时由父组件传入）。
export function SettingsButton({ onClick }: SettingsButtonProps) {
  return (
    <button
      type="button"
      className="settings-button"
      onClick={onClick}
      title="设置"
      aria-label="设置"
    >
      ⚙
    </button>
  );
}
