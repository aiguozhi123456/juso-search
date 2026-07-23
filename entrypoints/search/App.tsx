import { useEffect, useRef, useState } from 'react';
import type { NormalizedSearchResponse, ProviderId } from '@/lib/providers/types';
import { allProviders } from '@/lib/providers/registry';
import { sendMessage } from '@/lib/messaging';
import type { SearchReply } from '@/lib/messaging';
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
import { allSources, isEngineId, isProviderId } from '@/lib/sources';
import type { SearchSource, SourceId } from '@/lib/sources';
import { getEngine } from '@/lib/engines/registry';
import { parseSearchDeepLink } from '@/lib/deep-link';

type CacheMeta = { hit: boolean; entryId?: string; createdAt?: number };

export default function App() {
  const providers = allProviders();
  const [query, setQuery] = useState('');
  const [configuredProviderIds, setConfiguredProviderIds] = useState<ProviderId[]>([]);
  const [sourceOrder, setSourceOrder] = useState<SourceId[]>([]);
  const [sourceHidden, setSourceHidden] = useState<SourceId[]>([]);
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
      // 深链优先：search.html?provider=X&query=Y（SERP 栏跳转 / 后台打开用）。
      // provider 必须已配置才认；query 预填并立即触发一次搜索。
      const link = parseSearchDeepLink(window.location.search);
      const linkProvider = link.provider && config.configuredProviderIds.includes(link.provider) ? link.provider : null;
      const initialSource = linkProvider ?? config.activeSourceId;
      setActive(initialSource);
      if (link.query) {
        setQuery(link.query);
        if (ignore) return;
        await handleSearch(link.query, linkProvider ? { providerId: linkProvider } : { sourceId: initialSource });
      }
    })();
    return () => {
      ignore = true;
    };
    // mount-only：故意只跑一次；handleSearch 是组件内闭包，列进 deps 会反复触发。
  }, []);

  async function handleSearch(rawQuery: string, opts: { forceRefresh?: boolean; providerId?: ProviderId; sourceId?: SourceId } = {}) {
    const query = rawQuery.trim();
    if (!query) return;
    let source: SourceId | null;
    try {
      source = opts.providerId ?? opts.sourceId ?? visibleActive ?? active ?? await loadSourceSnapshot();
    } catch {
      setError({ message: t(MSG.search_failed_retry), needKey: false });
      return;
    }
    if (source && isEngineId(source)) {
      location.assign(getEngine(source).buildSerpUrl(query));
      return;
    }
    const providerId = source && isProviderId(source) ? source : undefined;
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
    if (source.kind === 'engine' && isEngineId(source.id)) {
      const nextQuery = query.trim();
      const engine = getEngine(source.id);
      setActive(source.id);
      await sendMessage('setActiveSource', source.id).catch(() => undefined);
      // 主页面：仅在有查询时跳该 engine SERP；空查询只切换激活源、不离开扩展页
      // （避免把「选中引擎」误读成「打开引擎首页」）。下次提交搜索时由 handleSearch
      // 的 engine 分支带 q 跳 SERP。SERP 注入栏（serp-handoff.ts）仍保留空查询跳首页语义。
      if (nextQuery) location.assign(engine.buildSerpUrl(nextQuery));
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

  async function loadSourceSnapshot(): Promise<SourceId | null> {
    const config = await sendMessage('getProviderConfig', undefined);
    setConfiguredProviderIds(config.configuredProviderIds);
    setSourceOrder(config.sourceOrder ?? []);
    setSourceHidden(config.sourceHidden ?? []);
    setActive(config.activeSourceId);
    return config.activeSourceId;
  }

  function openSettings() {
    browser.runtime.openOptionsPage();
  }

  const isStart = !loading && !error && !response;
  const sources = allSources(configuredProviderIds, sourceOrder, sourceHidden);
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
        <SourceSwitcher sources={sources} activeId={visibleActive} onSelect={handleSelectSource} disabled={loading || switching} />
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
