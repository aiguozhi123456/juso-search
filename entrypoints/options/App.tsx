import { useEffect, useState } from 'react';
import type { ProviderId } from '@/lib/providers/types';
import { allProviders } from '@/lib/providers/registry';
import { getActiveProviderId, setActiveProviderId } from '@/lib/storage';
import { KeyInput } from '@/components/KeyInput';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LocaleToggle } from '@/components/LocaleToggle';
import { t, MSG } from '@/lib/i18n';

export default function App() {
  const providers = allProviders();
  const [active, setActive] = useState<ProviderId | null>(null);

  useEffect(() => {
    void getActiveProviderId().then(setActive);
  }, []);

  async function choose(id: ProviderId) {
    await setActiveProviderId(id);
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
        <select value={active ?? ''} onChange={(e) => choose(e.target.value as ProviderId)}>
          <option value="" disabled>
            {t(MSG.opts_choose_placeholder)}
          </option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {t(p.label)}
              {p.supportsAnswer ? '' : t(MSG.opts_no_ai_answer)}
            </option>
          ))}
        </select>
      </section>

      <section>
        <h2>{t(MSG.opts_apikey_heading)}</h2>
        <p className="hint">{t(MSG.opts_apikey_hint)}</p>
        {providers.map((p) => (
          <KeyInput key={p.id} provider={p} />
        ))}
      </section>

      <section>
        <h2>{t(MSG.locale_group)}</h2>
        <LocaleToggle />
      </section>
    </div>
  );
}
