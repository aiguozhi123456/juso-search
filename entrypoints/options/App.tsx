import { useEffect, useRef, useState } from 'react';
import type { ProviderId } from '@/lib/providers/types';
import { allProviders } from '@/lib/providers/registry';
import type { SourceId } from '@/lib/sources';
import { allSources, normalizeSourceOrder, sourceLabel } from '@/lib/sources';
import type { SiteEngineDefinition } from '@/lib/site-engines';
import { sendMessage } from '@/lib/messaging';
import { KeyInput } from '@/components/KeyInput';
import { ThemeToggle } from '@/components/ThemeToggle';
import { StyleToggle } from '@/components/StyleToggle';
import { LocaleToggle } from '@/components/LocaleToggle';
import { ConfigExportImport } from '@/components/ConfigExportImport';
import { AgentBridgeSettings } from '@/components/AgentBridgeSettings';
import { SiteEngineManager } from '@/components/SiteEngineManager';
import { Wordmark } from '@/components/Wordmark';
import { ChevronDownIcon, ChevronUpIcon, SearchIcon, SettingsIcon } from '@/components/icons';
import { t, MSG } from '@/lib/i18n';

function KeyIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="14" r="3.5" />
      <line x1="11" y1="11" x2="19" y2="3" />
      <line x1="16" y1="6" x2="19" y2="3" />
      <line x1="19" y1="6" x2="16" y2="3" />
    </svg>
  );
}

export default function App() {
  const providers = allProviders();
  const [configuredProviderIds, setConfiguredProviderIds] = useState<ProviderId[]>([]);
  const [active, setActive] = useState<SourceId | null>(null);
  const [sourceOrder, setSourceOrder] = useState<SourceId[]>(() => normalizeSourceOrder(undefined));
  const [savingSourceOrder, setSavingSourceOrder] = useState(false);
  const [sourceOrderError, setSourceOrderError] = useState('');
  const [sourceHidden, setSourceHiddenState] = useState<SourceId[]>([]);
  const [savingSourceHidden, setSavingSourceHidden] = useState(false);
  const [siteEngines, setSiteEngines] = useState<SiteEngineDefinition[]>([]);
  const configRequestEpoch = useRef(0);
  const sourceOrderRevision = useRef(0);
  const sourceHiddenRevision = useRef(0);
  const activeSourceRevision = useRef(0);
  const [activeGroup, setActiveGroup] = useState('search');

   const navGroups = [
     { id: 'search', label: '搜索', icon: <SearchIcon size={16} /> },
     { id: 'keys', label: '密钥', icon: <KeyIcon size={16} /> },
     { id: 'general', label: '通用', icon: <SettingsIcon size={16} /> }
   ];

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
      const activeRevisionAtRequest = activeSourceRevision.current;
      const config = await sendMessage('getProviderConfig', undefined);
      // Stale guard: if a newer config request was made while this one was in flight,
      // ignore the entire response so older data doesn't clobber newer optimistic state
      // (siteEngines / configured providers) or optimistic revisions (order / hidden).
      if (requestEpoch !== configRequestEpoch.current) return;
      // active 由 choose()/toggleHidden() 重选乐观推进 revision：仅当请求期间没有发生
      // 本地激活态变更时才采纳响应中的 activeSourceId，避免在途的旧配置覆盖较新的本地态。
      if (activeRevisionAtRequest === activeSourceRevision.current) {
        setActive(config.activeSourceId);
      }
      setConfiguredProviderIds(config.configuredProviderIds);
      // Site Engines 完全由 worker 持有真相：每次 config 刷新直接覆盖本地副本，
      // 让 SiteEngineManager 在 create/update/delete 后看到最新结果。
      const engines = config.siteEngines ?? [];
      setSiteEngines(engines);
      // sourceOrder 必须与同一份 siteEngines 快照一起规范化，否则 site: id 会被误判为未知而丢弃。
      if (orderRevisionAtRequest === sourceOrderRevision.current) {
        setSourceOrder(normalizeSourceOrder(config.sourceOrder, engines));
      }
      if (hiddenRevisionAtRequest === sourceHiddenRevision.current) {
        setSourceHiddenState(config.sourceHidden ?? []);
      }
    })();
  }

  const configuredSources = allSources(configuredProviderIds, sourceOrder, undefined, siteEngines);
  // 激活态下拉框只列可见来源（已隐藏项不出现在下拉框）。
  // 注意：快切栏管理列表仍用 configuredSources（不过滤），否则隐藏项无法再「显示」。
  const visibleSources = allSources(configuredProviderIds, sourceOrder, sourceHidden, siteEngines);
  // active 被隐藏时，下拉框渲染回退到首个可见源；active 本身在 toggleHidden
  // 隐藏当前激活项时已被持久化重选（见 toggleHidden），这里只兜底初次加载的不一致。
  const activeVisible = active == null
    ? null
    : visibleSources.some((s) => s.id === active)
      ? active
      : visibleSources[0]?.id ?? null;

  async function choose(id: SourceId) {
    // 推进 active revision：任何在 choose 之前发起、尚未返回的 getProviderConfig
    // 都不应再用旧 activeSourceId 覆盖本次选择。
    activeSourceRevision.current += 1;
    try {
      await sendMessage('setActiveSource', id);
      setActive(id);
    } catch {
      // 写入失败：本地未推进到 id，再次推进 revision 并从 worker 重新拉取真相，
      // 避免在途响应把 active 锁死在错误值上。
      activeSourceRevision.current += 1;
      syncConfig();
    }
  }

  async function moveSource(sourceId: SourceId, direction: -1 | 1) {
    const visibleIndex = configuredSources.findIndex((source) => source.id === sourceId);
    const adjacentSource = configuredSources[visibleIndex + direction];
    if (visibleIndex === -1 || !adjacentSource || savingSourceOrder) return;

    const previousOrder = sourceOrder;
    const nextOrder = [...sourceOrder];
    const sourceIndex = nextOrder.indexOf(sourceId);
    const adjacentIndex = nextOrder.indexOf(adjacentSource.id);
    // Guard: both ids must be present in the full stored order before swapping.
    if (sourceIndex === -1 || adjacentIndex === -1) return;
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

    // 隐藏当前激活项：把激活态重选到首个仍可见来源并持久化，避免下拉框落到
    // 已隐藏的值上。仅隐藏分支需要；显示分支恢复原激活项由渲染兜底。
    const reselectTo = !isHidden && active === sourceId
      ? allSources(configuredProviderIds, sourceOrder, next, siteEngines).find((s) => s.id !== sourceId)?.id
      : undefined;

    sourceHiddenRevision.current += 1;
    setSourceHiddenState(next);
    if (reselectTo) {
      // 重选同样推进 active revision，防止在途的旧 getProviderConfig 用旧 activeSourceId
      // 覆盖本次重选。
      activeSourceRevision.current += 1;
      setActive(reselectTo);
    }
    setSavingSourceHidden(true);
    try {
      await sendMessage('setSourceHidden', next);
      if (reselectTo) await sendMessage('setActiveSource', reselectTo);
    } catch {
      sourceHiddenRevision.current += 1;
      setSourceHiddenState(previous);
      if (reselectTo) {
        // 回滚激活态同样推进 revision，避免在途响应再次覆盖。
        activeSourceRevision.current += 1;
        setActive(sourceId);
      }
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

      <div className="options-layout">
        <aside className="options-sidebar">
          <div className="options-sidebar-brand">
            <span className="options-sidebar-dot" aria-hidden="true" />
            <span className="options-sidebar-label">{t(MSG.opts_title).split(' · ').slice(1).join(' · ')}</span>
          </div>
          <nav className="options-nav">
            {navGroups.map((group) => (
              <button
                key={group.id}
                type="button"
                className={`options-nav-item${activeGroup === group.id ? ' active' : ''}`}
                onClick={() => setActiveGroup(group.id)}
                data-group={group.id}
              >
                <span className="options-nav-icon" aria-hidden="true">{group.icon}</span>
                <span className="options-nav-label">{group.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="options-content">
          {activeGroup === 'search' && (
          <>
          <section data-section="search-source">
            <h2>{t(MSG.opts_active_engine)}</h2>
            <select value={activeVisible ?? ''} onChange={(e) => choose(e.target.value as SourceId)}>
              <option value="" disabled>
                {t(MSG.opts_choose_placeholder)}
              </option>
              {visibleSources.map((s) => (
                <option key={s.id} value={s.id}>
                  {sourceLabel(s, t)}
                  {s.kind === 'provider' && !s.supportsAnswer ? t(MSG.opts_no_ai_answer) : ''}
                </option>
              ))}
            </select>
          </section>

          <section data-section="site-engines">
            <h2>{t(MSG.opts_site_engines_heading)}</h2>
            <SiteEngineManager siteEngines={siteEngines} onChange={syncConfig} />
          </section>

          <section data-section="quickbar">
            <h2>{t(MSG.opts_quickbar_heading)}</h2>
            <p className="hint">{t(MSG.opts_quickbar_hint)}</p>
            <div className="source-order-list">
              {configuredSources.map((source, index) => {
                const sourceName = sourceLabel(source, t);
                const hidden = sourceHidden.includes(source.id);
                // 不允许隐藏最后一个可见来源：至少保留一个，否则快切栏与下拉框将无可用项。
                const wouldLeaveEmpty = !hidden && visibleSources.length <= 1;
                const hideDisabled = savingSourceHidden || wouldLeaveEmpty;
                const hideLabel = wouldLeaveEmpty
                  ? t(MSG.opts_quickbar_hide_last_visible, sourceName)
                  : t(hidden ? MSG.opts_quickbar_toggle_show : MSG.opts_quickbar_toggle_hide, sourceName);
                return (
                  <div className={`source-order-row${hidden ? ' source-order-row--hidden' : ''}`} key={source.id}>
                    <span>{sourceName}</span>
                    <div className="source-order-actions">
                      <button
                        type="button"
                        className="hide-toggle"
                        aria-label={hideLabel}
                        title={hideLabel}
                        disabled={hideDisabled}
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
          </>
          )}

          {activeGroup === 'keys' && (
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
          )}

          {activeGroup === 'general' && (
          <>
          <section data-section="locale">
            <h2>{t(MSG.locale_group)}</h2>
            <LocaleToggle />
          </section>

          <section data-section="agent-bridge">
            <h2>{t(MSG.opts_agent_bridge_heading)}</h2>
            <p className="hint">{t(MSG.opts_agent_bridge_hint)}</p>
            <AgentBridgeSettings />
          </section>

          <section data-section="config">
            <h2>{t(MSG.opts_config_io_heading)}</h2>
            <ConfigExportImport onImported={syncConfig} />
          </section>
          </>
          )}
        </main>
      </div>
    </div>
  );
}
