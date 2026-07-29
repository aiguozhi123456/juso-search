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
import { resolveCurrentSiteEngineHandoff, resolveSerpHandoff } from '@/lib/serp-handoff';

type CacheMeta = { hit: boolean; entryId?: string; createdAt?: number };

export default function App() {
  const providers = allProviders();
  const [query, setQuery] = useState('');
  const [configuredProviderIds, setConfiguredProviderIds] = useState<ProviderId[]>([]);
  const [sourceOrder, setSourceOrder] = useState<SourceId[]>([]);
  const [sourceHidden, setSourceHidden] = useState<SourceId[]>([]);
  const [siteEngines, setSiteEngines] = useState<SiteEngineDefinition[]>([]);
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
      setGroupConfig(config.groupConfig);
      // 深链优先：search.html?provider=X&query=Y（SERP 栏跳转 / 后台打开用）。
      // provider 必须已配置才认；query 预填并立即触发一次搜索。
      const link = parseSearchDeepLink(window.location.search);
      const linkProvider = link.provider && config.configuredProviderIds.includes(link.provider) ? link.provider : null;
      const initialSource = linkProvider ?? config.activeSourceId;
      const initialSources = allSources(
        config.configuredProviderIds,
        config.sourceOrder ?? [],
        config.sourceHidden ?? [],
        config.siteEngines ?? [],
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

  async function handleSearch(rawQuery: string, opts: { forceRefresh?: boolean; providerId?: ProviderId; sourceId?: SourceId; selectedSource?: SearchSource } = {}) {
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
    // A manual submit must not navigate using the Site Engine definition embedded
    // in a chip: Options may have edited or deleted it since this page rendered.
    // Do this inline rather than re-entering handleSearch, so there is precisely
    // one fresh read and a deleted source can execute its fresh visible fallback.
    const isManualSiteEngineSubmit = !opts.forceRefresh
      && !opts.providerId
      && !opts.sourceId
      && !opts.selectedSource
      && Boolean(source && (selectedSource?.kind === 'site-engine' || isSiteEngineId(source)));
    if (isManualSiteEngineSubmit) {
      try {
        const refreshed = await loadSourceSnapshot();
        const refreshedSources = allSources(
          refreshed.configuredProviderIds,
          refreshed.sourceOrder ?? [],
          refreshed.sourceHidden ?? [],
          refreshed.siteEngines ?? [],
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
      );
      selectedSource = refreshedSources.find((candidate) => candidate.id === refreshed.activeSourceId);
      source = selectedSource?.id ?? null;
    }
    const handoff = selectedSource && resolveSerpHandoff(selectedSource, query);
    if (handoff?.kind === 'navigate') {
      location.assign(handoff.url);
      return;
    }
    if (!source || !isProviderId(source)) return;
    const providerId = source;
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
    if (!isProviderId(source.id)) return;
    const id = source.id;
    if (loading || switching) return;
    if (id === active) return;
    const switchReqId = ++switchReqIdRef.current;
    setSwitching(true);
    try {
      await sendMessage('setActiveSource', id);
      if (switchReqId !== switchReqIdRef.current) return;
      setActive(id);
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
    if (configuredProviderIds.includes(entry.providerId) && entry.providerId !== active) {
      const switchReqId = ++switchReqIdRef.current;
      setSwitching(true);
      void sendMessage('setActiveSource', entry.providerId)
        .then(() => {
          if (switchReqId === switchReqIdRef.current) setActive(entry.providerId);
        })
        .finally(() => {
          if (switchReqId === switchReqIdRef.current) setSwitching(false);
        });
    }
  }

  async function handleRefresh() {
    await handleSearch(response?.query ?? query, { forceRefresh: true, providerId: response?.provider });
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
    setGroupConfig(config.groupConfig);
    setActive(config.activeSourceId);
  }

  function openSettings() {
    browser.runtime.openOptionsPage();
  }

  const isStart = !loading && !error && !response;
  const sources = allSources(configuredProviderIds, sourceOrder, sourceHidden, siteEngines);
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
                {response.provider === active && <button type="button" onClick={() => void handleRefresh()}>{t(MSG.cache_refresh)}</button>}
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
