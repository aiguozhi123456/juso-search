import { useLocale, type LocalePref } from '@/lib/useLocale';
import { t, MSG } from '@/lib/i18n';

const OPTIONS: { value: LocalePref; label: string }[] = [
  { value: 'auto', label: MSG.locale_auto },
  { value: 'zh_CN', label: MSG.locale_zh },
  { value: 'en', label: MSG.locale_en },
];

// 设置页 UI 语言偏好：自动（跟随浏览器）/ 中文 / English。
export function LocaleToggle() {
  const { pref, setPref } = useLocale();
  return (
    <div className="locale-toggle" role="group" aria-label={t(MSG.locale_group)}>
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
            {t(opt.label)}
          </button>
        );
      })}
    </div>
  );
}
