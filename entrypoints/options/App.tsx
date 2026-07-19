import { useEffect, useRef, useState } from 'react';
import type { ProviderId } from '@/lib/providers/types';
import { allProviders } from '@/lib/providers/registry';
import type { SourceId } from '@/lib/sources';
import { allSources, normalizeSourceOrder } from '@/lib/sources';
import { sendMessage } from '@/lib/messaging';
import { KeyInput } from '@/components/KeyInput';
import { ThemeToggle } from '@/components/ThemeToggle';
import { StyleToggle } from '@/components/StyleToggle';
import { LocaleToggle } from '@/components/LocaleToggle';
import { ConfigExportImport } from '@/components/ConfigExportImport';
import { Wordmark } from '@/components/Wordmark';
import { ChevronDownIcon, ChevronUpIcon } from '@/components/icons';
import { t, MSG } from '@/lib/i18n';

export default function App() {
  const providers = allProviders();
  const [configuredProviderIds, setConfiguredProviderIds] = useState<ProviderId[]>([]);
  const [active, setActive] = useState<SourceId | null>(null);
  const [sourceOrder, setSourceOrder] = useState<SourceId[]>(() => normalizeSourceOrder(undefined));
  const [savingSourceOrder, setSavingSourceOrder] = useState(false);
  const [sourceOrderError, setSourceOrderError] = useState('');
  const [sourceHidden, setSourceHiddenState] = useState<SourceId[]>([]);
  const [savingSourceHidden, setSavingSourceHidden] = useState(false);
  const configRequestEpoch = useRef(0);
  const sourceOrderRevision = useRef(0);
  const sourceHiddenRevision = useRef(0);

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
      const hiddenRevisionAtRequest = sourceHiddenRevision.current;
      const config = await sendMessage('getProviderConfig', undefined);
      setActive(config.activeSourceId);
      setConfiguredProviderIds(config.configuredProviderIds);
      if (requestEpoch === configRequestEpoch.current && orderRevisionAtRequest === sourceOrderRevision.current) {
        setSourceOrder(normalizeSourceOrder(config.sourceOrder));
      }
      if (requestEpoch === configRequestEpoch.current && hiddenRevisionAtRequest === sourceHiddenRevision.current) {
        setSourceHiddenState(config.sourceHidden ?? []);
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

  async function toggleHidden(sourceId: SourceId) {
    const previous = sourceHidden;
    const isHidden = sourceHidden.includes(sourceId);
    const next = isHidden ? sourceHidden.filter((id) => id !== sourceId) : [...sourceHidden, sourceId];

    sourceHiddenRevision.current += 1;
    setSourceHiddenState(next);
    setSavingSourceHidden(true);
    try {
      await sendMessage('setSourceHidden', next);
    } catch {
      sourceHiddenRevision.current += 1;
      setSourceHiddenState(previous);
    } finally {
      sourceHiddenRevision.current += 1;
      setSavingSourceHidden(false);
    }
  }

  return (
    <div className="options">
      <div className="options-header">
        <h1 className="options-wordmark">
          <Wordmark suffix={t(MSG.opts_title).split(' · ').slice(1).join(' · ')} />
        </h1>
        <div className="options-toggles">
          <StyleToggle />
          <ThemeToggle />
        </div>
      </div>

      <section data-section="search-source">
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

      <section data-section="quickbar">
        <h2>{t(MSG.opts_quickbar_heading)}</h2>
        <p className="hint">{t(MSG.opts_quickbar_hint)}</p>
        <div className="source-order-list">
          {configuredSources.map((source, index) => {
            const sourceName = t(source.label);
            const hidden = sourceHidden.includes(source.id);
            return (
              <div className={`source-order-row${hidden ? ' source-order-row--hidden' : ''}`} key={source.id}>
                <span>{sourceName}</span>
                <div className="source-order-actions">
                  <button
                    type="button"
                    className="hide-toggle"
                    aria-label={t(hidden ? MSG.opts_quickbar_toggle_show : MSG.opts_quickbar_toggle_hide, sourceName)}
                    title={t(hidden ? MSG.opts_quickbar_toggle_show : MSG.opts_quickbar_toggle_hide, sourceName)}
                    disabled={savingSourceHidden}
                    onClick={() => toggleHidden(source.id)}
                  >
                    {hidden ? t(MSG.opts_quickbar_show) : t(MSG.opts_quickbar_hide)}
                  </button>
                  <button
                    type="button"
                    aria-label={t(MSG.opts_source_order_move_up, sourceName)}
                    title={t(MSG.opts_source_order_move_up, sourceName)}
                    disabled={savingSourceOrder || savingSourceHidden || index === 0}
                    onClick={() => moveSource(source.id, -1)}
                  >
                    <ChevronUpIcon size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label={t(MSG.opts_source_order_move_down, sourceName)}
                    title={t(MSG.opts_source_order_move_down, sourceName)}
                    disabled={savingSourceOrder || savingSourceHidden || index === configuredSources.length - 1}
                    onClick={() => moveSource(source.id, 1)}
                  >
                    <ChevronDownIcon size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {sourceOrderError && <p className="status fail" role="alert">{sourceOrderError}</p>}
      </section>

      <section data-section="api-keys">
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

      <section data-section="locale">
        <h2>{t(MSG.locale_group)}</h2>
        <LocaleToggle />
      </section>

      <section data-section="config">
        <h2>{t(MSG.opts_config_io_heading)}</h2>
        <ConfigExportImport onImported={syncConfig} />
      </section>
    </div>
  );
}
