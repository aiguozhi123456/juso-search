import { useTheme, type ThemePref } from '@/lib/useTheme';

const OPTIONS: { value: ThemePref; icon: string; label: string }[] = [
  { value: 'auto', icon: '🌓', label: '自动' },
  { value: 'light', icon: '☀️', label: '浅色' },
  { value: 'dark', icon: '🌙', label: '深色' },
];

// 三态主题切换：自动（跟随系统）/ 浅色 / 深色。
export function ThemeToggle() {
  const { pref, setPref } = useTheme();
  return (
    <div className="theme-toggle" role="group" aria-label="主题">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={pref === opt.value ? 'active' : ''}
          onClick={() => setPref(opt.value)}
          title={opt.label}
          aria-label={opt.label}
          aria-pressed={pref === opt.value}
        >
          {opt.icon}
        </button>
      ))}
    </div>
  );
}
