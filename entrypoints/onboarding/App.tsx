import { useEffect, useState } from 'react';
import { allProviders } from '@/lib/providers/registry';
import { allEngines } from '@/lib/engines/registry';
import { allAiEngines } from '@/lib/ai-engines/registry';
import { sendMessage } from '@/lib/messaging';
import { setOnboardingCompleted } from '@/lib/storage';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LocaleToggle } from '@/components/LocaleToggle';
import { Wordmark } from '@/components/Wordmark';
import { t, MSG } from '@/lib/i18n';
import { useLocale } from '@/lib/useLocale';
import { navigateToSearchPage } from './navigate';
import { SourceLayoutDemo } from './SourceLayoutDemo';
import { WelcomeDemo } from './WelcomeDemo';
import { SelectionDemo } from './SelectionDemo';
import { KeyDemo } from './KeyDemo';
import { QuickbarDemo } from './QuickbarDemo';

const TOTAL_STEPS = 4;

/** 打开设置页并深链到指定导航组（白名单校验在 options 页侧）。 */
function openOptionsGroup(group: 'search' | 'keys' | 'general') {
  const target = `${browser.runtime.getURL('/options.html')}?group=${group}`;
  void browser.tabs.create({ url: target }).catch((e) => console.warn('[onboarding] tabs.create failed', e));
}

export default function App() {
  // 根级订阅 locale：切语言时整树重渲染（t() 与各演示的 COPY() 渲染时求值随动），
  // 否则只有 header 的开关自身刷新、正文与演示停在旧语言。
  useLocale();
  const [step, setStep] = useState(0);
  // null = 尚未从 worker 取回脱敏配置状态（页面绝不读 providerKeys 本体）。
  // 计数语义 = 实际配了 key 的 provider（keyed）：免 key 免费层开箱即可用，不计入「已配置」。
  const [keyedCount, setKeyedCount] = useState<number | null>(null);

  const providerCount = allProviders().length;
  const engineCount = allEngines().length;
  const aiEngineCount = allAiEngines().length;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const config = await sendMessage('getProviderConfig', undefined);
        if (!cancelled) setKeyedCount(config.keyedProviderIds.length);
      } catch {
        // 状态取不到就不显示计数徽章，不阻塞引导流程
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** 完成与跳过同语义：写完成标记后当前页替换进搜索页（写标记失败也要尽量离开引导页）。 */
  async function finish() {
    try {
      await setOnboardingCompleted(true);
    } catch (e) {
      console.warn('[onboarding] persist completed failed', e);
    }
    navigateToSearchPage();
  }

  return (
    <div className="onboarding">
      <header className="onboarding-header">
        <Wordmark />
        <div className="onboarding-header-toggles">
          <LocaleToggle />
          <ThemeToggle />
        </div>
      </header>

      <main className="onboarding-card">
        {step === 0 && (
          <section className="onboarding-step" data-step="welcome">
            <h1 className="onboarding-title">{t(MSG.onboarding_welcome_title)}</h1>
            <p className="onboarding-lead">{t(MSG.onboarding_welcome_desc)}</p>
            <ul className="onboarding-sources">
              <li>{t(MSG.onboarding_welcome_line_providers, String(providerCount))}</li>
              <li>{t(MSG.onboarding_welcome_line_engines, String(engineCount))}</li>
              <li>{t(MSG.onboarding_welcome_line_ai_engines, String(aiEngineCount))}</li>
            </ul>
            <WelcomeDemo />
          </section>
        )}

        {step === 1 && (
          <section className="onboarding-step" data-step="features">
            <h1 className="onboarding-title">{t(MSG.onboarding_features_title)}</h1>
            <ul className="onboarding-features">
              <li>
                <strong>{t(MSG.onboarding_feature_quickbar_title)}</strong>
                <span>{t(MSG.onboarding_feature_quickbar_desc)}</span>
                <QuickbarDemo />
              </li>
              <li>
                <strong>{t(MSG.onboarding_feature_selection_title)}</strong>
                <span>{t(MSG.onboarding_feature_selection_desc)}</span>
                <SelectionDemo />
              </li>
              <li>
                <strong>{t(MSG.onboarding_feature_context_menu_title)}</strong>
                <span>{t(MSG.onboarding_feature_context_menu_desc)}</span>
              </li>
              <li>
                <strong>{t(MSG.onboarding_feature_custom_title)}</strong>
                <span>{t(MSG.onboarding_feature_custom_desc)}</span>
              </li>
              <li>
                <strong>{t(MSG.onboarding_agent_title)}</strong>
                <span>{t(MSG.onboarding_agent_desc)}</span>
                <button
                  type="button"
                  className="onboarding-btn onboarding-features__settings-btn"
                  onClick={() => openOptionsGroup('general')}
                >
                  {t(MSG.onboarding_open_settings)}
                </button>
              </li>
            </ul>
          </section>
        )}

        {step === 2 && (
          <section className="onboarding-step" data-step="keys">
            <h1 className="onboarding-title">{t(MSG.onboarding_keys_title)}</h1>
            <p className="onboarding-lead">{t(MSG.onboarding_keys_desc)}</p>
            <div className="onboarding-keys-status">
              {keyedCount !== null && keyedCount > 0 ? (
                <span className="onboarding-keys-status__badge onboarding-keys-status__badge--ok">
                  {t(MSG.onboarding_keys_status_some, [String(keyedCount), String(providerCount)])}
                </span>
              ) : (
                <span className="onboarding-keys-status__badge">
                  {keyedCount === null ? '' : t(MSG.onboarding_keys_status_none)}
                </span>
              )}
            </div>
            {/* 密钥配置示意（KeyDemo）：点输入 → 粘 key → 保存 → 已配置，紧贴下方 CTA */}
            <KeyDemo />
            <div className="onboarding-actions-row">
              <button
                type="button"
                className="onboarding-btn onboarding-btn--primary"
                onClick={() => openOptionsGroup('keys')}
              >
                {t(MSG.onboarding_keys_open_settings)}
              </button>
            </div>
            <p className="onboarding-hint">{t(MSG.onboarding_keys_no_key_hint)}</p>
          </section>
        )}

        {step === 3 && (
          <section className="onboarding-step" data-step="groups">
            <h1 className="onboarding-title">{t(MSG.onboarding_group_title)}</h1>
            <p className="onboarding-lead">{t(MSG.onboarding_group_desc)}</p>
            {/* 示意复用「来源布局」编辑器的真实结构与样式（SourceLayoutDemo），
                动画为组内拖拽排序（编辑器真实支持的拖拽操作）；跨组归属走置顶/收入分组。 */}
            <SourceLayoutDemo />
            <div className="onboarding-actions-row">
              <button type="button" className="onboarding-btn" onClick={() => openOptionsGroup('search')}>
                {t(MSG.onboarding_open_settings)}
              </button>
            </div>
          </section>
        )}

        <footer className="onboarding-footer">
          <button type="button" className="onboarding-btn onboarding-btn--link" onClick={() => void finish()}>
            {t(MSG.onboarding_skip)}
          </button>
          <div
            className="onboarding-dots"
            role="group"
            aria-label={t(MSG.onboarding_step_indicator, [String(step + 1), String(TOTAL_STEPS)])}
          >
            {Array.from({ length: TOTAL_STEPS }, (_, i) => (
              <span
                key={i}
                className={`onboarding-dots__dot${i === step ? ' onboarding-dots__dot--active' : ''}`}
              />
            ))}
          </div>
          <div className="onboarding-footer-actions">
            {step > 0 && (
              <button type="button" className="onboarding-btn" onClick={() => setStep(step - 1)}>
                {t(MSG.onboarding_back)}
              </button>
            )}
            {step < TOTAL_STEPS - 1 ? (
              <button
                type="button"
                className="onboarding-btn onboarding-btn--primary"
                onClick={() => setStep(step + 1)}
              >
                {t(MSG.onboarding_next)}
              </button>
            ) : (
              <button
                type="button"
                className="onboarding-btn onboarding-btn--primary"
                onClick={() => void finish()}
              >
                {t(MSG.onboarding_finish)}
              </button>
            )}
          </div>
        </footer>
      </main>
    </div>
  );
}
