import { useLocale, type LocalePref } from '@/lib/useLocale';
import { t, MSG } from '@/lib/i18n';

const OPTIONS: { value: LocalePref; label: string }[] = [
  { value: 'auto', label: 'A' },
  { value: 'zh_CN', label: '中' },
  { value: 'en', label: 'EN' },
];

// UI 语言切换：自动（跟随浏览器）/ 中文 / English。
// 复用 .theme-toggle 样式（搜索页顶栏 + 设置页头部均可放）。
export function LocaleToggle() {
  const { pref, setPref } = useLocale();
  return (
    <div className="theme-toggle locale-toggle" role="group" aria-label={t(MSG.locale_group)}>
      {OPTIONS.map((opt) => {
        const ariaLabel =
          opt.value === 'auto'
            ? `${t(MSG.locale_auto)} (${t(MSG.locale_group)})`
            : t(MSG[opt.value === 'zh_CN' ? 'locale_zh' : 'locale_en']);
        return (
          <button
            key={opt.value}
            type="button"
            className={pref === opt.value ? 'active' : ''}
            onClick={() => setPref(opt.value)}
            title={ariaLabel}
            aria-label={ariaLabel}
            aria-pressed={pref === opt.value}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
