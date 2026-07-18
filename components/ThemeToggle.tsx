import { useTheme, type ThemePref } from '@/lib/useTheme';
import { t, MSG } from '@/lib/i18n';
import { MonitorIcon, SunIcon, MoonIcon } from './icons';

const OPTIONS: { value: ThemePref; Icon: typeof MonitorIcon; labelKey: keyof typeof MSG }[] = [
  { value: 'auto', Icon: MonitorIcon, labelKey: 'theme_auto' },
  { value: 'light', Icon: SunIcon, labelKey: 'theme_light' },
  { value: 'dark', Icon: MoonIcon, labelKey: 'theme_dark' },
];

// 三态主题切换：自动（跟随系统）/ 浅色 / 深色。
export function ThemeToggle() {
  const { pref, setPref } = useTheme();
  return (
    <div className="theme-toggle" role="group" aria-label={t(MSG.theme_group)}>
      {OPTIONS.map((opt) => {
        const label = t(MSG[opt.labelKey]);
        const { Icon } = opt;
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
            <Icon size={16} />
          </button>
        );
      })}
    </div>
  );
}
