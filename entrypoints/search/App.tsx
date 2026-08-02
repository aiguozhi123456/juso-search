import { useEffect, useRef, useState } from 'react';
import type { NormalizedSearchResponse, ProviderId } from '@/lib/providers/types';
import { allProviders } from '@/lib/providers/registry';
import { sendMessage } from '@/lib/messaging';
import type { ProviderConfigReply, SearchReply } from '@/lib/messaging';
import { SearchBox } from '@/components/SearchBox';
import { SourceSwitcher } from '@/components/SourceSwitcher';
import { HistoryButton } from '@/components/HistoryButton';
import { SearchCachePanel } from '@/components/SearchCachePanel';
import { SettingsButton } from '@/components/SettingsButton';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Wordmark } from '@/components/Wordmark';
import { AnswerCard } from '@/components/AnswerCard';
import { ResultList } from '@/components/ResultList';
import { Loading, ErrorState } from '@/components/States';
import { getCurrentLocale, t, MSG } from '@/lib/i18n';
import type { SearchCacheEntry } from '@/lib/search-cache';
import { allSources, isProviderId } from '@/lib/sources';
import type { SearchSource, SourceId } from '@/lib/sources';
import type { GroupConfig } from '@/lib/source-groups';
import { defaultGroupConfig } from '@/lib/source-groups';
import { parseSearchDeepLink } from '@/lib/deep-link';
import { isSiteEngineId } from '@/lib/site-engines';
import type { SiteEngineDefinition } from '@/lib/site-engines';
import type { CustomEngineDefinition } from '@/lib/custom-engines';
import { isCustomEngineId } from '@/lib/custom-engines';
import type { ProviderInstance, ProviderInstanceId } from '@/lib/provider-instances';
import { isProviderInstanceId } from '@/lib/provider-instances';
import { resolveCurrentCustomEngineHandoff, resolveCurrentSiteEngineHandoff, resolveSerpHandoff } from '@/lib/serp-handoff';

type CacheMeta = { hit: boolean; entryId?: string; createdAt?: number };

/** 深链 provider 参数（裸 provider id 或实例 id）是否已配置：实例按 base provider 判定。 */
function isLinkSourceConfigured(provider: ProviderId | ProviderInstanceId, configured: readonly ProviderId[]): boolean {
  if (isProviderId(provider)) return configured.includes(provider);
  if (isProviderInstanceId(provider)) return configured.includes(provider.split(':')[1] as ProviderId);
  return false;
}

export default function App() {
  const providers = allProviders();
  const [query, setQuery] = useState('');
  const [configuredProviderIds, setConfiguredProviderIds] = useState<ProviderId[]>([]);
  const [sourceOrder, setSourceOrder] = useState<SourceId[]>([]);
  const [sourceHidden, setSourceHidden] = useState<SourceId[]>([]);
  const [siteEngines, setSiteEngines] = useState<SiteEngineDefinition[]>([]);
  const [customEngines, setCustomEngines] = useState<CustomEngineDefinition[]>([]);
  const [providerInstances, setProviderInstances] = useState<ProviderInstance[]>([]);
  const [groupConfig, setGroupConfig] = useState<GroupConfig>(() => defaultGroupConfig([]));
  const [active, setActive] = useState<SourceId | null>(null);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [response, setResponse] = useState<NormalizedSearchResponse | null>(null);
  const [cacheMeta, setCacheMeta] = useState<CacheMeta | null>(null);
  const [error, setError] = useState<{ message: string; needKey: boolean } | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const reqIdRef = useRef(0);
  const switchReqIdRef = useRef(0);

  useEffect(() => {
    // ignore guard：StrictMode 下 mount effect 双调；第一次 await 中的请求由第二次
    // 卸载-重挂时 ignore=true 拦截，避免对付费 provider 重复发送 search 请求。
    let ignore = false;
    void (async () => {
      const config = await sendMessage('getProviderConfig', undefined);
      if (ignore) return;
      setConfiguredProviderIds(config.configuredProviderIds);
      setSourceOrder(config.sourceOrder ?? []);
      setSourceHidden(config.sourceHidden ?? []);
      setSiteEngines(config.siteEngines ?? []);
      setCustomEngines(config.customEngines ?? []);
      setProviderInstances(config.providerInstances ?? []);
      setGroupConfig(config.groupConfig);
      // 深链优先：search.html?provider=X&query=Y（SERP 栏跳转 / 后台打开用）。
      // provider 必须已配置才认（实例 id 按 base provider 判定，configuredProviderIds 是 ProviderId[]）；
      // query 预填并立即触发一次搜索。
      const link = parseSearchDeepLink(window.location.search);
      const linkProvider = link.provider && isLinkSourceConfigured(link.provider, config.configuredProviderIds)
        ? link.provider
        : null;
      const initialSource = linkProvider ?? config.activeSourceId;
      const initialSources = allSources(
        config.configuredProviderIds,
        config.sourceOrder ?? [],
        config.sourceHidden ?? [],
        config.siteEngines ?? [],
        config.customEngines ?? [],
        config.providerInstances ?? [],
      );
      // Query-only links honor the persisted source unless it is hidden from
      // the current projection. This executes a visible fallback without
      // overwriting the user's persisted hidden selection.
      const initialExecutionSource = !linkProvider && config.sourceHidden?.includes(initialSource)
        ? initialSources[0]?.id ?? initialSource
        : initialSource;
      const initialSelectedSource = initialSources.find((source) => source.id === initialExecutionSource);
      setActive(initialSource);
      if (link.query) {
        setQuery(link.query);
        if (ignore) return;
        await handleSearch(link.query, linkProvider
          ? { providerId: linkProvider, selectedSource: initialSelectedSource }
          : { sourceId: initialExecutionSource, selectedSource: initialSelectedSource });
      }
    })();
    return () => {
      ignore = true;
    };
    // mount-only：故意只跑一次；handleSearch 是组件内闭包，列进 deps 会反复触发。
  }, []);

  async function handleSearch(rawQuery: string, opts: { forceRefresh?: boolean; providerId?: ProviderId | ProviderInstanceId; sourceId?: SourceId; selectedSource?: SearchSource } = {}) {
    const query = rawQuery.trim();
    if (!query) return;
    let source: SourceId | null;
    try {
      source = opts.providerId ?? opts.sourceId ?? visibleActive ?? active;
      if (!source) source = (await loadSourceSnapshot()).activeSourceId;
    } catch {
      setError({ message: t(MSG.search_failed_retry), needKey: false });
      return;
    }
    let selectedSource = opts.selectedSource ?? (source ? sources.find((candidate) => candidate.id === source) : undefined);
    // A manual submit must not navigate using the dynamic (Site/Custom Engine)
    // definition embedded in a chip: Options may have edited or deleted it since
    // this page rendered. Do this inline rather than re-entering handleSearch, so
    // there is precisely one fresh read and a deleted source can execute its fresh
    // visible fallback.
    const isManualSiteEngineSubmit = !opts.forceRefresh
      && !opts.providerId
      && !opts.sourceId
      && !opts.selectedSource
      && Boolean(source && (selectedSource?.kind === 'site-engine' || isSiteEngineId(source)));
    const isManualCustomEngineSubmit = !opts.forceRefresh
      && !opts.providerId
      && !opts.sourceId
      && !opts.selectedSource
      && Boolean(source && (selectedSource?.kind === 'custom-engine' || isCustomEngineId(source)));
    if (isManualSiteEngineSubmit || isManualCustomEngineSubmit) {
      try {
        const refreshed = await loadSourceSnapshot();
        const refreshedSources = allSources(
          refreshed.configuredProviderIds,
          refreshed.sourceOrder ?? [],
          refreshed.sourceHidden ?? [],
          refreshed.siteEngines ?? [],
          refreshed.customEngines ?? [],
          refreshed.providerInstances ?? [],
        );
        const freshSelectedSource = refreshedSources.find((candidate) => candidate.id === source);
        // If the selected Site Engine disappeared (or is no longer visible), run
        // the first source from the fresh projection. This is execution-only:
        // never overwrite the persisted active preference on the user's behalf.
        selectedSource = freshSelectedSource ?? refreshedSources[0];
        source = selectedSource?.id ?? null;
      } catch {
        setError({ message: t(MSG.search_failed_retry), needKey: false });
        return;
      }
    }
    // A stale dynamic source id must not fall through as an undefined provider.
    // Reload once so edits made in Options while this page was open are honored.
    if (source && !selectedSource && !isProviderId(source)) {
      const refreshed = await loadSourceSnapshot();
      const refreshedSources = allSources(
        refreshed.configuredProviderIds,
        refreshed.sourceOrder ?? [],
        refreshed.sourceHidden ?? [],
        refreshed.siteEngines ?? [],
        refreshed.customEngines ?? [],
        refreshed.providerInstances ?? [],
      );
      selectedSource = refreshedSources.find((candidate) => candidate.id === refreshed.activeSourceId);
      source = selectedSource?.id ?? null;
    }
    const handoff = selectedSource && resolveSerpHandoff(selectedSource, query);
    if (handoff?.kind === 'navigate') {
      location.assign(handoff.url);
      return;
    }
    if (!source || (!isProviderId(source) && !isProviderInstanceId(source))) return;
    // 实例 id 走 SourceId 边界透传给 worker（gateway 在边界解析为 base provider + options），
    // wire 字段仍为 ProviderId 类型——与 SearchRequest.providerId 承载实例 id 的既定约定一致。
    const providerId = source as ProviderId;
    const isRefresh = opts.forceRefresh === true;
    const hadResponse = response !== null;
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    setRefreshError(null);
    if (!isRefresh) {
      setResponse(null);
      setCacheMeta(null);
    }
    try {
      const reply: SearchReply = await sendMessage('search', {
        query,
        forceRefresh: opts.forceRefresh,
        providerId,
      });
      if (reqId !== reqIdRef.current) return; // 过期响应丢弃
      if (reply.ok) {
        setResponse(reply.response);
        setCacheMeta(reply.cache);
      } else {
        if (isRefresh && hadResponse) setRefreshError(reply.error.message);
        else setError({ message: reply.error.message, needKey: reply.error.kind === 'keyMissing' });
      }
    } catch {
      if (reqId !== reqIdRef.current) return;
      if (isRefresh && hadResponse) setRefreshError(t(MSG.search_failed_retry));
      else setError({ message: t(MSG.search_failed_retry), needKey: false });
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }

  /** 统一快切：选 provider → 序列化写 + 重搜（沿用 v1）；选 engine → 当前 tab 跳转 SERP。 */
  async function handleSelectSource(source: SearchSource) {
    if (source.kind === 'site-engine') {
      // Mirror provider path: serialize concurrent source switches so a late
      // applySourceSnapshot cannot overwrite a newer selection.
      if (loading || switching) return;
      const switchReqId = ++switchReqIdRef.current;
      setSwitching(true);
      try {
        const nextQuery = query.trim();
        let config: ProviderConfigReply;
        try {
          config = await sendMessage('getProviderConfig', undefined);
        } catch {
          return;
        }
        if (switchReqId !== switchReqIdRef.current) return;
        // Resolve the clicked id from the fresh snapshot. The chip's embedded
        // definition may have been edited or deleted in Options.
        const handoff = resolveCurrentSiteEngineHandoff(source.id, nextQuery, config.siteEngines ?? []);
        if (!handoff || handoff.kind !== 'navigate') {
          // Drop the stale chip from local UI. Execution-only fallback: do not
          // persist a new active source on the user's behalf.
          applySourceSnapshot(config);
          if (!nextQuery) return;
          const fallbackSources = allSources(
            config.configuredProviderIds,
            config.sourceOrder ?? [],
            config.sourceHidden ?? [],
            config.siteEngines ?? [],
            config.customEngines ?? [],
            config.providerInstances ?? [],
          );
          const fallback = fallbackSources[0];
          if (!fallback) {
            setError({ message: t(MSG.search_failed_retry), needKey: false });
            return;
          }
          const fallbackHandoff = resolveSerpHandoff(fallback, nextQuery);
          if (fallbackHandoff?.kind === 'navigate') {
            if (switchReqId !== switchReqIdRef.current) return;
            location.assign(fallbackHandoff.url);
            return;
          }
          if (isProviderId(fallback.id)) {
            if (switchReqId !== switchReqIdRef.current) return;
            await handleSearch(nextQuery, { providerId: fallback.id, selectedSource: fallback });
            return;
          }
          setError({ message: t(MSG.search_failed_retry), needKey: false });
          return;
        }
        try {
          await sendMessage('setActiveSource', source.id);
        } catch {
          return;
        }
        if (switchReqId !== switchReqIdRef.current) return;
        // Prefer one post-write read so definitions/order/hidden/active match storage.
        try {
          config = await sendMessage('getProviderConfig', undefined);
        } catch {
          // Write succeeded; keep navigating with the pre-write handoff URL.
          if (switchReqId !== switchReqIdRef.current) return;
          setActive(source.id);
          if (nextQuery) location.assign(handoff.url);
          return;
        }
        if (switchReqId !== switchReqIdRef.current) return;
        // Re-resolve from the post-write snapshot: Options may have edited the
        // same Site Engine between the pre-write and post-write reads.
        const postWriteHandoff = resolveCurrentSiteEngineHandoff(
          source.id,
          nextQuery,
          config.siteEngines ?? [],
        );
        if (!postWriteHandoff || postWriteHandoff.kind !== 'navigate') {
          // Deleted between write and re-read: apply snapshot + execution-only fallback.
          applySourceSnapshot(config);
          if (!nextQuery) return;
          const fallbackSources = allSources(
            config.configuredProviderIds,
            config.sourceOrder ?? [],
            config.sourceHidden ?? [],
            config.siteEngines ?? [],
            config.customEngines ?? [],
            config.providerInstances ?? [],
          );
          const fallback = fallbackSources[0];
          if (!fallback) {
            setError({ message: t(MSG.search_failed_retry), needKey: false });
            return;
          }
          const fallbackHandoff = resolveSerpHandoff(fallback, nextQuery);
          if (fallbackHandoff?.kind === 'navigate') {
            if (switchReqId !== switchReqIdRef.current) return;
            location.assign(fallbackHandoff.url);
            return;
          }
          if (isProviderId(fallback.id)) {
            if (switchReqId !== switchReqIdRef.current) return;
            await handleSearch(nextQuery, { providerId: fallback.id, selectedSource: fallback });
            return;
          }
          setError({ message: t(MSG.search_failed_retry), needKey: false });
          return;
        }
        applySourceSnapshot(config);
        // The search surface only navigates an engine after a query is present.
        if (nextQuery) location.assign(postWriteHandoff.url);
        return;
      } finally {
        if (switchReqId === switchReqIdRef.current) setSwitching(false);
      }
    }
    if (source.kind === 'custom-engine') {
      // Mirror the site-engine path: a chip carries a render-time snapshot, so
      // re-read config and re-resolve before navigating; Options may have edited
      // or deleted the engine since this page rendered.
      if (loading || switching) return;
      const switchReqId = ++switchReqIdRef.current;
      setSwitching(true);
      try {
        const nextQuery = query.trim();
        let config: ProviderConfigReply;
        try {
          config = await sendMessage('getProviderConfig', undefined);
        } catch {
          return;
        }
        if (switchReqId !== switchReqIdRef.current) return;
        // Resolve the clicked id from the fresh snapshot. The chip's embedded
        // definition may have been edited or deleted in Options. Note the custom
        // resolver also yields null for an empty query, so gate the stale-chip
        // fallback on the definition being gone — an empty-query selection still
        // persists the source (consistent with built-in/site engines), it just
        // does not navigate.
        const handoff = resolveCurrentCustomEngineHandoff(source.id, nextQuery, config.customEngines ?? []);
        const stillDefined = (config.customEngines ?? []).some((d) => d.id === source.id);
        if (!stillDefined) {
          // Drop the stale chip from local UI. Execution-only fallback: do not
          // persist a new active source on the user's behalf.
          applySourceSnapshot(config);
          if (!nextQuery) return;
          const fallbackSources = allSources(
            config.configuredProviderIds,
            config.sourceOrder ?? [],
            config.sourceHidden ?? [],
            config.siteEngines ?? [],
            config.customEngines ?? [],
            config.providerInstances ?? [],
          );
          const fallback = fallbackSources[0];
          if (!fallback) {
            setError({ message: t(MSG.search_failed_retry), needKey: false });
            return;
          }
          const fallbackHandoff = resolveSerpHandoff(fallback, nextQuery);
          if (fallbackHandoff?.kind === 'navigate') {
            if (switchReqId !== switchReqIdRef.current) return;
            location.assign(fallbackHandoff.url);
            return;
          }
          if (isProviderId(fallback.id)) {
            if (switchReqId !== switchReqIdRef.current) return;
            await handleSearch(nextQuery, { providerId: fallback.id, selectedSource: fallback });
            return;
          }
          setError({ message: t(MSG.search_failed_retry), needKey: false });
          return;
        }
        try {
          await sendMessage('setActiveSource', source.id);
        } catch {
          return;
        }
        if (switchReqId !== switchReqIdRef.current) return;
        // Prefer one post-write read so definitions/order/hidden/active match storage.
        try {
          config = await sendMessage('getProviderConfig', undefined);
        } catch {
          // Write succeeded; keep navigating with the pre-write handoff URL.
          if (switchReqId !== switchReqIdRef.current) return;
          setActive(source.id);
          if (nextQuery && handoff?.kind === 'navigate') location.assign(handoff.url);
          return;
        }
        if (switchReqId !== switchReqIdRef.current) return;
        // Re-resolve from the post-write snapshot: Options may have edited the
        // same Custom Engine between the pre-write and post-write reads.
        const postWriteHandoff = resolveCurrentCustomEngineHandoff(
          source.id,
          nextQuery,
          config.customEngines ?? [],
        );
        const postWriteDefined = (config.customEngines ?? []).some((d) => d.id === source.id);
        if (!postWriteDefined) {
          // Deleted between write and re-read: apply snapshot + execution-only fallback.
          applySourceSnapshot(config);
          if (!nextQuery) return;
          const fallbackSources = allSources(
            config.configuredProviderIds,
            config.sourceOrder ?? [],
            config.sourceHidden ?? [],
            config.siteEngines ?? [],
            config.customEngines ?? [],
            config.providerInstances ?? [],
          );
          const fallback = fallbackSources[0];
          if (!fallback) {
            setError({ message: t(MSG.search_failed_retry), needKey: false });
            return;
          }
          const fallbackHandoff = resolveSerpHandoff(fallback, nextQuery);
          if (fallbackHandoff?.kind === 'navigate') {
            if (switchReqId !== switchReqIdRef.current) return;
            location.assign(fallbackHandoff.url);
            return;
          }
          if (isProviderId(fallback.id)) {
            if (switchReqId !== switchReqIdRef.current) return;
            await handleSearch(nextQuery, { providerId: fallback.id, selectedSource: fallback });
            return;
          }
          setError({ message: t(MSG.search_failed_retry), needKey: false });
          return;
        }
        applySourceSnapshot(config);
        // The search surface only navigates an engine after a query is present.
        if (nextQuery && postWriteHandoff?.kind === 'navigate') location.assign(postWriteHandoff.url);
        return;
      } finally {
        if (switchReqId === switchReqIdRef.current) setSwitching(false);
      }
    }
    if (source.kind === 'engine') {
      // Same generation guard as provider/site-engine so concurrent switches
      // cannot race navigations; write failures still select optimistically.
      if (loading || switching) return;
      const switchReqId = ++switchReqIdRef.current;
      setSwitching(true);
      try {
        const nextQuery = query.trim();
        setActive(source.id);
        await sendMessage('setActiveSource', source.id).catch(() => undefined);
        if (switchReqId !== switchReqIdRef.current) return;
        if (nextQuery) {
          const handoff = resolveSerpHandoff(source, nextQuery);
          if (handoff?.kind === 'navigate') location.assign(handoff.url);
        }
      } finally {
        if (switchReqId === switchReqIdRef.current) setSwitching(false);
      }
      return;
    }
    // 实例 chip 与裸 provider chip 同路径：序列化写 active source（实例 id）并用实例 id 搜索
    // （gateway 在边界解析实例 → base provider + per-instance options，KTD2/R8）。
    if (!isProviderId(source.id) && !isProviderInstanceId(source.id)) return;
    const id = source.id;
    if (loading || switching) return;
    if (id === active) return;
    const switchReqId = ++switchReqIdRef.current;
    setSwitching(true);
    setActive(id);
    try {
      await sendMessage('setActiveSource', id);
      if (switchReqId !== switchReqIdRef.current) return;
      const nextQuery = query.trim();
      if (nextQuery) await handleSearch(nextQuery, { providerId: id });
    } finally {
      if (switchReqId === switchReqIdRef.current) setSwitching(false);
    }
  }

  function handleInterrupt() {
    reqIdRef.current += 1;
    setLoading(false);
  }

  function handleSelectCached(entry: SearchCacheEntry) {
    reqIdRef.current += 1;
    setLoading(false);
    setQuery(entry.query);
    setResponse(entry.response);
    setCacheMeta({ hit: true, entryId: entry.id, createdAt: entry.createdAt });
    setError(null);
    setRefreshError(null);
    // 缓存条目可能是实例搜索的产物：激活态恢复优先用 instanceId，裸 provider 搜索回退 providerId。
    const activeId = (entry.instanceId ?? entry.providerId) as SourceId;
    if (configuredProviderIds.includes(entry.providerId) && activeId !== active) {
      const switchReqId = ++switchReqIdRef.current;
      setSwitching(true);
      void sendMessage('setActiveSource', activeId)
        .then(() => {
          if (switchReqId === switchReqIdRef.current) setActive(activeId);
        })
        .finally(() => {
          if (switchReqId === switchReqIdRef.current) setSwitching(false);
        });
    }
  }

  async function handleRefresh() {
    // 实例搜索的响应 provider 是 base ProviderId；刷新必须回到产出该结果的实例，
    // 否则会路由到默认实例（KTD5）而非用户选择的那一个（BUG-2）。
    const providerId = (active && isProviderInstanceId(active)) ? active : response?.provider;
    await handleSearch(response?.query ?? query, { forceRefresh: true, providerId });
  }

  async function loadSourceSnapshot() {
    const config = await sendMessage('getProviderConfig', undefined);
    applySourceSnapshot(config);
    return config;
  }

  function applySourceSnapshot(config: ProviderConfigReply) {
    setConfiguredProviderIds(config.configuredProviderIds);
    setSourceOrder(config.sourceOrder ?? []);
    setSourceHidden(config.sourceHidden ?? []);
    setSiteEngines(config.siteEngines ?? []);
    setCustomEngines(config.customEngines ?? []);
    setProviderInstances(config.providerInstances ?? []);
    setGroupConfig(config.groupConfig);
    setActive(config.activeSourceId);
  }

  function openSettings() {
    browser.runtime.openOptionsPage();
  }

  const isStart = !loading && !error && !response;
  const sources = allSources(configuredProviderIds, sourceOrder, sourceHidden, siteEngines, customEngines, providerInstances);
  // 激活源被隐藏时（如隐藏当前 engine），快切栏渲染与搜索回退都改用首个可见源，
  // 避免无高亮目标 / 搜索仍跳隐藏 engine 的结果页。active 本身不改动——
  // 取消隐藏后自动恢复用户原激活偏好（最小惊讶）。仅在 active 已解析时回退，
  // 否则保持 null 让 handleSearch 走 loadSourceSnapshot 兜底（首次渲染未拿到配置）。
  const visibleActive = active == null
    ? null
    : sources.some((s) => s.id === active)
      ? active
      : sources[0]?.id ?? null;

  return (
    <div className={`app${isStart ? ' app--start' : ''}`}>
      <header className="topbar">
        <h1 className="topbar-wordmark"><Wordmark /></h1>
        <SourceSwitcher sources={sources} groupConfig={groupConfig} activeId={visibleActive} onSelect={handleSelectSource} disabled={loading || switching} />
        <div className="topbar-actions">
          <HistoryButton onClick={() => setHistoryOpen(true)} disabled={switching} />
          <ThemeToggle />
          <SettingsButton onClick={openSettings} />
        </div>
      </header>
      <SearchBox value={query} onChange={setQuery} onSearch={handleSearch} onInterrupt={handleInterrupt} loading={loading} disabled={switching} />
      <SearchCachePanel open={historyOpen} onClose={() => setHistoryOpen(false)} onSelect={handleSelectCached} />
      <main className="results">
        {loading && <Loading />}
        {!loading && error && (
          <ErrorState
            message={error.message}
            onOpenSettings={error.needKey ? openSettings : undefined}
          />
        )}
        {!loading && !error && response && (
          <>
            {cacheMeta?.hit && (
              <div className="cache-notice">
                <span>{t(MSG.cache_hit_notice, [providerLabel(response.provider, providers), cacheMeta.createdAt ? relativeTime(cacheMeta.createdAt) : ''])}</span>
                {isActiveSourceForProvider(active, response.provider) && <button type="button" onClick={() => void handleRefresh()}>{t(MSG.cache_refresh)}</button>}
                {refreshError && <span className="cache-error">{refreshError}</span>}
              </div>
            )}
            {response.answer && <AnswerCard answer={response.answer} />}
            <ResultList results={response.results} sourceId={response.provider} />
          </>
        )}
      </main>
    </div>
  );
}

function relativeTime(timestamp: number): string {
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  const rtf = new Intl.RelativeTimeFormat(getCurrentLocale() === 'zh_CN' ? 'zh-CN' : 'en', { numeric: 'auto' });
  if (abs < 60) return rtf.format(seconds, 'second');
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  return rtf.format(Math.round(hours / 24), 'day');
}

function providerLabel(providerId: ProviderId, providers: ReturnType<typeof allProviders>): string {
  const provider = providers.find((candidate) => candidate.id === providerId);
  return provider ? t(provider.label) : providerId;
}

/** 刷新按钮显隐：激活源是响应 provider 本身，或是该 provider 的实例（响应来自该 provider）。 */
function isActiveSourceForProvider(active: SourceId | null, provider: ProviderId): boolean {
  if (!active) return false;
  if (active === provider) return true;
  return isProviderInstanceId(active) && active.split(':')[1] === provider;
}
