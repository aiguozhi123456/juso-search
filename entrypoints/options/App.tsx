import { useEffect, useState } from 'react';
import type { ProviderId } from '@/lib/providers/types';
import { allProviders } from '@/lib/providers/registry';
import type { SourceId } from '@/lib/sources';
import { allSources } from '@/lib/sources';
import { sendMessage } from '@/lib/messaging';
import { KeyInput } from '@/components/KeyInput';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LocaleToggle } from '@/components/LocaleToggle';
import { ConfigExportImport } from '@/components/ConfigExportImport';
import { t, MSG } from '@/lib/i18n';

export default function App() {
  const providers = allProviders();
  const [configuredProviderIds, setConfiguredProviderIds] = useState<ProviderId[]>([]);
  const [active, setActive] = useState<SourceId | null>(null);

  useEffect(() => {
    void (async () => {
      const config = await sendMessage('getProviderConfig', undefined);
      setConfiguredProviderIds(config.configuredProviderIds);
      setActive(config.activeSourceId);
    })();
  }, []);

  function markConfigured(id: ProviderId) {
    setConfiguredProviderIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
    syncConfig();
  }

  function markRemoved(id: ProviderId) {
    setConfiguredProviderIds((ids) => ids.filter((x) => x !== id));
    // worker 端会按 activeSource → activeProvider → 默认 engine 重新解析有效默认源；
    // 此处重新拉取配置以同步 active，避免下拉框显示已失效的选项。
    syncConfig();
  }

  function syncConfig() {
    void (async () => {
      const config = await sendMessage('getProviderConfig', undefined);
      setActive(config.activeSourceId);
      setConfiguredProviderIds(config.configuredProviderIds);
    })();
  }

  const configuredSources = allSources(configuredProviderIds);

  async function choose(id: SourceId) {
    await sendMessage('setActiveSource', id);
    setActive(id);
  }

  return (
    <div className="options">
      <div className="options-header">
        <h1>{t(MSG.opts_title)}</h1>
        <div className="options-toggles">
          <ThemeToggle />
        </div>
      </div>

      <section>
        <h2>{t(MSG.opts_active_engine)}</h2>
        <select value={active ?? ''} onChange={(e) => choose(e.target.value as SourceId)}>
          <option value="" disabled>
            {t(MSG.opts_choose_placeholder)}
          </option>
          {configuredSources.map((s) => (
            <option key={s.id} value={s.id}>
              {t(s.label)}
              {s.kind === 'provider' && !s.supportsAnswer ? t(MSG.opts_no_ai_answer) : ''}
            </option>
          ))}
        </select>
      </section>

      <section>
        <h2>{t(MSG.opts_apikey_heading)}</h2>
        <p className="hint">{t(MSG.opts_apikey_hint)}</p>
        {providers.map((p) => (
          <KeyInput
            key={p.id}
            provider={p}
            configured={configuredProviderIds.includes(p.id)}
            onConfigured={markConfigured}
            onRemoved={markRemoved}
          />
        ))}
      </section>

      <section>
        <h2>{t(MSG.locale_group)}</h2>
        <LocaleToggle />
      </section>

      <section>
        <h2>{t(MSG.opts_config_io_heading)}</h2>
        <ConfigExportImport onImported={syncConfig} />
      </section>
    </div>
  );
}
