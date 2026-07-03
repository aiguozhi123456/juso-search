import { useTheme, type ThemePref } from '@/lib/useTheme';
import { t, MSG } from '@/lib/i18n';

const OPTIONS: { value: ThemePref; icon: string; labelKey: keyof typeof MSG }[] = [
  { value: 'auto', icon: '🌓', labelKey: 'theme_auto' },
  { value: 'light', icon: '☀️', labelKey: 'theme_light' },
  { value: 'dark', icon: '🌙', labelKey: 'theme_dark' },
];

// 三态主题切换：自动（跟随系统）/ 浅色 / 深色。
export function ThemeToggle() {
  const { pref, setPref } = useTheme();
  return (
    <div className="theme-toggle" role="group" aria-label={t(MSG.theme_group)}>
      {OPTIONS.map((opt) => {
        const label = t(MSG[opt.labelKey]);
        return (
          <button
            key={opt.value}
            type="button"
            className={pref === opt.value ? 'active' : ''}
            onClick={() => setPref(opt.value)}
            title={label}
            aria-label={label}
            aria-pressed={pref === opt.value}
          >
            {opt.icon}
          </button>
        );
      })}
    </div>
  );
}
