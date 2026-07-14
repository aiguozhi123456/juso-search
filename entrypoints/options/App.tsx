import { useEffect, useRef, useState } from 'react';
import type { ProviderId } from '@/lib/providers/types';
import { allProviders } from '@/lib/providers/registry';
import type { SourceId } from '@/lib/sources';
import { allSources, normalizeSourceOrder } from '@/lib/sources';
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
  const [sourceOrder, setSourceOrder] = useState<SourceId[]>(() => normalizeSourceOrder(undefined));
  const [savingSourceOrder, setSavingSourceOrder] = useState(false);
  const [sourceOrderError, setSourceOrderError] = useState('');
  const configRequestEpoch = useRef(0);
  const sourceOrderRevision = useRef(0);

  useEffect(() => {
    syncConfig();
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
      const requestEpoch = ++configRequestEpoch.current;
      const orderRevisionAtRequest = sourceOrderRevision.current;
      const config = await sendMessage('getProviderConfig', undefined);
      setActive(config.activeSourceId);
      setConfiguredProviderIds(config.configuredProviderIds);
      if (requestEpoch === configRequestEpoch.current && orderRevisionAtRequest === sourceOrderRevision.current) {
        setSourceOrder(normalizeSourceOrder(config.sourceOrder));
      }
    })();
  }

  const configuredSources = allSources(configuredProviderIds, sourceOrder);

  async function choose(id: SourceId) {
    await sendMessage('setActiveSource', id);
    setActive(id);
  }

  async function moveSource(sourceId: SourceId, direction: -1 | 1) {
    const visibleIndex = configuredSources.findIndex((source) => source.id === sourceId);
    const adjacentSource = configuredSources[visibleIndex + direction];
    if (visibleIndex === -1 || !adjacentSource || savingSourceOrder) return;

    const previousOrder = sourceOrder;
    const nextOrder = [...sourceOrder];
    const sourceIndex = nextOrder.indexOf(sourceId);
    const adjacentIndex = nextOrder.indexOf(adjacentSource.id);
    [nextOrder[sourceIndex], nextOrder[adjacentIndex]] = [nextOrder[adjacentIndex], nextOrder[sourceIndex]];

    sourceOrderRevision.current += 1;
    setSourceOrder(nextOrder);
    setSavingSourceOrder(true);
    setSourceOrderError('');
    try {
      await sendMessage('setSourceOrder', nextOrder);
    } catch {
      setSourceOrder(previousOrder);
      setSourceOrderError(t(MSG.opts_source_order_save_failed));
    } finally {
      sourceOrderRevision.current += 1;
      setSavingSourceOrder(false);
    }
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
        <h2>{t(MSG.opts_source_order_heading)}</h2>
        <p className="hint">{t(MSG.opts_source_order_hint)}</p>
        <div className="source-order-list">
          {configuredSources.map((source, index) => {
            const sourceName = t(source.label);
            return (
              <div className="source-order-row" key={source.id}>
                <span>{sourceName}</span>
                <div className="source-order-actions">
                  <button
                    type="button"
                    aria-label={t(MSG.opts_source_order_move_up, sourceName)}
                    title={t(MSG.opts_source_order_move_up, sourceName)}
                    disabled={savingSourceOrder || index === 0}
                    onClick={() => moveSource(source.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={t(MSG.opts_source_order_move_down, sourceName)}
                    title={t(MSG.opts_source_order_move_down, sourceName)}
                    disabled={savingSourceOrder || index === configuredSources.length - 1}
                    onClick={() => moveSource(source.id, 1)}
                  >
                    ↓
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {sourceOrderError && <p className="status fail" role="alert">{sourceOrderError}</p>}
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
