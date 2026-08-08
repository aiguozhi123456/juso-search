import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ProviderId } from '@/lib/providers/types';
import { allProviders } from '@/lib/providers/registry';
import type { SourceId } from '@/lib/sources';
import { allSources, normalizeSourceOrder, sourceLabel } from '@/lib/sources';
import { compareByPinyin } from '@/lib/pinyin-sort';
import type { SiteEngineDefinition } from '@/lib/site-engines';
import type { CustomEngineDefinition } from '@/lib/custom-engines';
import type { ProviderInstance } from '@/lib/provider-instances';
import type { GroupConfig } from '@/lib/source-groups';
import { defaultGroupConfig } from '@/lib/source-groups';
import { SourceGroupEditor } from '@/components/SourceGroupEditor';
import { sendMessage } from '@/lib/messaging';
import { KeyInput } from '@/components/KeyInput';
import { ThemeToggle } from '@/components/ThemeToggle';
import { StyleToggle } from '@/components/StyleToggle';
import { BarPositionToggle } from '@/components/BarPositionToggle';
import { AiAutoEnterToggle } from '@/components/AiAutoEnterToggle';
import { FlatLayoutToggle } from '@/components/FlatLayoutToggle';
import { LocaleToggle } from '@/components/LocaleToggle';
import { ConfigExportImport } from '@/components/ConfigExportImport';
import { AgentBridgeSettings } from '@/components/AgentBridgeSettings';
import { SiteEngineManager } from '@/components/SiteEngineManager';
import { CustomEngineManager } from '@/components/CustomEngineManager';
import { ProviderInstanceManager } from '@/components/ProviderInstanceManager';
import { Wordmark } from '@/components/Wordmark';
import { SearchIcon, SettingsIcon, InfoIcon, ExternalLinkIcon, BrandMark } from '@/components/icons';
import { t, MSG, getCurrentLocale, type Locale } from '@/lib/i18n';

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

/** 安全读取扩展版本号。测试环境（fake-browser）无 getManifest，需 typeof 守卫。 */
function getAppVersion(): string {
  if (typeof browser === 'undefined') return '';
  return browser?.runtime?.getManifest?.()?.version ?? '';
}

/** 关于页外链常量。 */
const ABOUT_LINKS = {
  home: 'https://aiguozhi123456.github.io/juso-search/',
  github: 'https://github.com/aiguozhi123456/juso-search',
  store: 'https://chromewebstore.google.com/detail/%E5%8F%8C%E9%9D%A2%E6%90%9C/illmhdnglkjfcenboepdgopaeejdgoji',
  docs: 'https://github.com/aiguozhi123456/juso-search/blob/main/docs/DEVELOPMENT.md',
  searchEngineJump: 'https://greasyfork.org/zh-CN/scripts/27752-searchenginejump',
  aiScriptQParam: 'https://greasyfork.org/zh-CN/scripts/550940',
  aiScriptDeepSeek: 'https://gist.github.com/orca131/7f4dd7f2ec377c09cdb8b0ad5cd10e68',
  aiScriptDoubao: 'https://greasyfork.org/zh-CN/scripts/541111',
} as const;

/** 致谢区 AI 引擎段落：每个 locale 的脚本名 token → 外链。
 *  token 即文案中出现的可见脚本名（两个脚本名在中英文下不同），按 locale 提供映射；
 *  renderAckLinks 在渲染时按 token 切分文案并插入链接，避免硬编码某种语言语序。 */
const AI_ACK_LINKS: Record<Locale, Record<string, string>> = {
  zh_CN: {
    '给AI搜索网站添加q查询参数': ABOUT_LINKS.aiScriptQParam,
    'DeepSeek Prompt Automation': ABOUT_LINKS.aiScriptDeepSeek,
    '豆包自动发送助手': ABOUT_LINKS.aiScriptDoubao,
  },
  en: {
    'Add q query parameter to AI search sites': ABOUT_LINKS.aiScriptQParam,
    'DeepSeek Prompt Automation': ABOUT_LINKS.aiScriptDeepSeek,
    'Doubao Auto-Send Assistant': ABOUT_LINKS.aiScriptDoubao,
  },
};

/** 把本地化文案中出现的 token 子串替换为外链。
 *  与既有 searchEngineJump 段落的 split/interleave 同构，扩展为多 token：
 *  token 即文案中可见文本（各 locale 可能不同），由调用方按 locale 提供 token→URL 映射。 */
function renderAckLinks(text: string, tokenUrls: Record<string, string>): ReactNode[] {
  const tokens = Object.keys(tokenUrls);
  if (tokens.length === 0) return [text];
  // 转义正则元字符；按长度降序拼接，避免短 token 误匹配长 token 的子串。
  const pattern = new RegExp(
    `(${tokens
      .map((tok) => tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .sort((a, b) => b.length - a.length)
      .join('|')})`,
  );
  return text.split(pattern).map((part, i) =>
    tokenUrls[part] ? (
      <a key={i} className="about-ack-link" href={tokenUrls[part]} target="_blank" rel="noopener noreferrer">
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export default function App() {
  const providers = allProviders();
  const [configuredProviderIds, setConfiguredProviderIds] = useState<ProviderId[]>([]);
  const [providerMaxResults, setProviderMaxResults] = useState<Partial<Record<ProviderId, number>>>({});
  const [aiAutoEnter, setAiAutoEnterState] = useState(true);
  const [flatLayoutFewSources, setFlatLayoutFewSourcesState] = useState(true);
  const [active, setActive] = useState<SourceId | null>(null);
  const [sourceOrder, setSourceOrder] = useState<SourceId[]>(() => normalizeSourceOrder(undefined));
  const [sourceHidden, setSourceHiddenState] = useState<SourceId[]>([]);
  const [savingSourceHidden, setSavingSourceHidden] = useState(false);
  const [siteEngines, setSiteEngines] = useState<SiteEngineDefinition[]>([]);
  const [customEngines, setCustomEngines] = useState<CustomEngineDefinition[]>([]);
  const [providerInstances, setProviderInstances] = useState<ProviderInstance[]>([]);
  const [groupConfig, setGroupConfig] = useState<GroupConfig>(() => defaultGroupConfig([]));
  const configRequestEpoch = useRef(0);
  const sourceOrderRevision = useRef(0);
  const sourceHiddenRevision = useRef(0);
  const activeSourceRevision = useRef(0);
  // 与 sourceOrder/sourceHidden 同构的乐观修订守卫：SourceGroupEditor.persist 乐观推进本地 groupConfig，
  // 在此期间返回的 getProviderConfig 不应再用旧 groupConfig 覆盖。
  const groupConfigRevision = useRef(0);
  const [activeGroup, setActiveGroup] = useState('search');

   const navGroups = [
     { id: 'search', label: t(MSG.opts_nav_search), icon: <SearchIcon size={16} /> },
     { id: 'keys', label: t(MSG.opts_nav_keys), icon: <KeyIcon size={16} /> },
     { id: 'general', label: t(MSG.opts_nav_general), icon: <SettingsIcon size={16} /> },
     { id: 'about', label: t(MSG.opts_about_heading), icon: <InfoIcon size={16} /> }
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
      const groupRevisionAtRequest = groupConfigRevision.current;
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
      setProviderMaxResults(config.providerMaxResults ?? {});
      setAiAutoEnterState(config.aiAutoEnter ?? true);
      setFlatLayoutFewSourcesState(config.flatLayoutFewSources ?? true);
      // Site Engines 完全由 worker 持有真相：每次 config 刷新直接覆盖本地副本，
      // 让 SiteEngineManager 在 create/update/delete 后看到最新结果。
      const engines = config.siteEngines ?? [];
      setSiteEngines(engines);
      const customs = config.customEngines ?? [];
      setCustomEngines(customs);
      setProviderInstances(config.providerInstances ?? []);
      // 与 sourceOrder/sourceHidden 同构：仅当请求期间没有本地 groupConfig 乐观变更时才采纳响应，
      // 避免在途的旧配置覆盖 SourceGroupEditor.persist 刚写入的乐观态。
      if (groupRevisionAtRequest === groupConfigRevision.current) {
        setGroupConfig(config.groupConfig);
      }
      // sourceOrder 必须与同一份 siteEngines 快照一起规范化，否则 site: id 会被误判为未知而丢弃。
      if (orderRevisionAtRequest === sourceOrderRevision.current) {
        setSourceOrder(normalizeSourceOrder(config.sourceOrder, engines, customs));
      }
      if (hiddenRevisionAtRequest === sourceHiddenRevision.current) {
        setSourceHiddenState(config.sourceHidden ?? []);
      }
    })();
  }

  const configuredSources = allSources(configuredProviderIds, sourceOrder, undefined, siteEngines, customEngines, providerInstances);
  // 激活态下拉框只列可见来源（已隐藏项不出现在下拉框）。
  // 注意：快切栏管理列表仍用 configuredSources（不过滤），否则隐藏项无法再「显示」。
  const visibleSources = allSources(configuredProviderIds, sourceOrder, sourceHidden, siteEngines, customEngines, providerInstances);
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

  async function handleAiAutoEnterChange(value: boolean) {
    setAiAutoEnterState(value);
    try {
      await sendMessage('setAiAutoEnter', value);
    } catch {
      syncConfig();
    }
  }

  async function handleFlatLayoutFewSourcesChange(value: boolean) {
    setFlatLayoutFewSourcesState(value);
    try {
      await sendMessage('setFlatLayoutFewSources', value);
    } catch {
      syncConfig();
    }
  }

  async function toggleHidden(sourceId: SourceId) {
    const previous = sourceHidden;
    const isHidden = sourceHidden.includes(sourceId);
    const next = isHidden ? sourceHidden.filter((id) => id !== sourceId) : [...sourceHidden, sourceId];

    // 隐藏当前激活项：把激活态重选到首个仍可见来源并持久化，避免下拉框落到
    // 已隐藏的值上。仅隐藏分支需要；显示分支恢复原激活项由渲染兜底。
    const reselectTo = !isHidden && active === sourceId
      ? allSources(configuredProviderIds, sourceOrder, next, siteEngines, customEngines, providerInstances).find((s) => s.id !== sourceId)?.id
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

          <section data-section="custom-engines">
            <h2>{t(MSG.opts_custom_engines_heading)}</h2>
            <CustomEngineManager customEngines={customEngines} onChange={syncConfig} />
          </section>

          <SourceGroupEditor
            sources={configuredSources}
            groupConfig={groupConfig}
            onChange={(next) => {
              // 推进乐观修订：任何在本次变更之前发起、尚未返回的 getProviderConfig
              // 都不应再用旧 groupConfig 覆盖本次编辑（同 sourceOrder/sourceHidden 守卫）。
              groupConfigRevision.current += 1;
              setGroupConfig(next);
            }}
            resolveLabel={(source) => sourceLabel(source, t)}
          />

          <section data-section="quickbar">
            <h2>{t(MSG.opts_quickbar_heading)}</h2>
            <div className="bar-position-row">
              <span className="bar-position-label">{t(MSG.bar_position_group)}</span>
              <BarPositionToggle />
            </div>
            <div className="bar-position-row">
              <span className="bar-position-label">{t(MSG.ai_auto_enter_group)}</span>
              <AiAutoEnterToggle enabled={aiAutoEnter} onChange={handleAiAutoEnterChange} />
            </div>
            <p className="hint">{t(MSG.ai_auto_enter_hint)}</p>
            <div className="bar-position-row">
              <span className="bar-position-label">{t(MSG.flat_layout_few_sources_group)}</span>
              <FlatLayoutToggle enabled={flatLayoutFewSources} onChange={handleFlatLayoutFewSourcesChange} />
            </div>
            <p className="hint">{t(MSG.flat_layout_few_sources_hint)}</p>
            <p className="hint">{t(MSG.opts_quickbar_hint)}</p>
            <div className="source-order-list">
              {/* 展示按拼音排序（仅展示，不写入 sourceOrder；实际顺序在「来源布局」中拖动调整）。 */}
              {[...configuredSources]
                .sort((a, b) => compareByPinyin(sourceLabel(a, t), sourceLabel(b, t)))
                .map((source) => {
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
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
          </>
          )}

          {activeGroup === 'keys' && (
          <>
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
                maxResults={providerMaxResults[p.id]}
                onMaxResultsChange={(id, n) =>
                  setProviderMaxResults((prev) => {
                    if (n === undefined) {
                      const next = { ...prev };
                      delete next[id];
                      return next;
                    }
                    return { ...prev, [id]: n };
                  })
                }
              />
            ))}
          </section>

          <section data-section="provider-instances">
            <h2>{t(MSG.opts_instances_heading)}</h2>
            <ProviderInstanceManager />
          </section>
          </>
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

          {activeGroup === 'about' && (
          <>
          <section data-section="about-brand" className="about-brand-hero">
            <div className="about-brand-mark" aria-hidden="true">
              <BrandMark size={48} />
            </div>
            <div className="about-brand-body">
              <div className="about-brand-title">
                <span className="about-brand-wordmark">{t(MSG.search_page_title)}</span>
                {getAppVersion() && (
                  <span className="about-version-badge">v{getAppVersion()}</span>
                )}
              </div>
              <p className="about-brand-tagline">{t(MSG.opts_about_tagline)}</p>
              <p className="about-brand-description">{t(MSG.opts_about_description)}</p>
            </div>
          </section>

          <section data-section="about-links">
            <h2>{t(MSG.opts_about_links_heading)}</h2>
            <div className="about-links-list">
              <a className="about-link-row" href={ABOUT_LINKS.home} target="_blank" rel="noopener noreferrer">
                <span className="about-link-label">{t(MSG.opts_about_link_home)}</span>
                <ExternalLinkIcon size={14} />
              </a>
              <a className="about-link-row" href={ABOUT_LINKS.github} target="_blank" rel="noopener noreferrer">
                <span className="about-link-label">{t(MSG.opts_about_link_github)}</span>
                <ExternalLinkIcon size={14} />
              </a>
              <a className="about-link-row" href={ABOUT_LINKS.store} target="_blank" rel="noopener noreferrer">
                <span className="about-link-label">{t(MSG.opts_about_link_store)}</span>
                <ExternalLinkIcon size={14} />
              </a>
              <a className="about-link-row" href={ABOUT_LINKS.docs} target="_blank" rel="noopener noreferrer">
                <span className="about-link-label">{t(MSG.opts_about_link_docs)}</span>
                <ExternalLinkIcon size={14} />
              </a>
            </div>
          </section>

          <section data-section="about-tech">
            <h2>{t(MSG.opts_about_tech_heading)}</h2>
            <div className="about-tech-list">
              <div className="about-tech-row">
                <span className="about-tech-label">{t(MSG.opts_about_tech_stack)}</span>
              </div>
              <div className="about-tech-row">
                <span className="about-tech-label">{t(MSG.opts_about_license)}</span>
              </div>
            </div>
          </section>

          <section data-section="about-ack">
            <h2>{t(MSG.opts_about_acknowledgements_heading)}</h2>
            <p className="about-ack-text">
              {t(MSG.opts_about_acknowledgements_text)
                .split('searchEngineJump')
                .map((part, i, arr) => (
                  <span key={i}>
                    {part}
                    {i < arr.length - 1 && (
                      <a
                        className="about-ack-link"
                        href={ABOUT_LINKS.searchEngineJump}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        searchEngineJump
                      </a>
                    )}
                  </span>
                ))}
            </p>
            <p className="about-ack-text">
              {renderAckLinks(t(MSG.opts_about_ack_ai_text), AI_ACK_LINKS[getCurrentLocale()])}
            </p>
            <p className="about-ack-text">
              {t(MSG.opts_about_trademark_text)}
            </p>
          </section>
          </>
          )}
        </main>
      </div>
    </div>
  );
}
