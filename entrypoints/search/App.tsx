import { useEffect, useRef, useState } from 'react';
import type { NormalizedSearchResponse, ProviderId } from '@/lib/providers/types';
import { allProviders } from '@/lib/providers/registry';
import { sendMessage } from '@/lib/messaging';
import type { SearchReply } from '@/lib/messaging';
import { SearchBox } from '@/components/SearchBox';
import { ProviderSwitcher } from '@/components/ProviderSwitcher';
import { HistoryButton } from '@/components/HistoryButton';
import { SearchCachePanel } from '@/components/SearchCachePanel';
import { SettingsButton } from '@/components/SettingsButton';
import { ThemeToggle } from '@/components/ThemeToggle';
import { AnswerCard } from '@/components/AnswerCard';
import { ResultList } from '@/components/ResultList';
import { Loading, ErrorState } from '@/components/States';
import { getCurrentLocale, t, MSG } from '@/lib/i18n';
import type { SearchCacheEntry } from '@/lib/search-cache';

type CacheMeta = { hit: boolean; entryId?: string; createdAt?: number };

export default function App() {
  const providers = allProviders();
  const [query, setQuery] = useState('');
  const [configuredProviderIds, setConfiguredProviderIds] = useState<ProviderId[]>([]);
  const [active, setActive] = useState<ProviderId | null>(null);
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
    void (async () => {
      const config = await sendMessage('getProviderConfig', undefined);
      setConfiguredProviderIds(config.configuredProviderIds);
      setActive(config.activeProviderId);
    })();
  }, []);

  async function handleSearch(rawQuery: string, opts: { forceRefresh?: boolean; providerId?: ProviderId } = {}) {
    const query = rawQuery.trim();
    if (!query) return;
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
      const providerId = opts.providerId ?? active ?? await loadProviderSnapshot();
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

  async function handleSwitch(id: ProviderId) {
    if (loading || switching) return;
    if (id === active) return;
    const switchReqId = ++switchReqIdRef.current;
    setSwitching(true);
    try {
      await sendMessage('setActiveProvider', id);
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
      void sendMessage('setActiveProvider', entry.providerId)
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

  async function loadProviderSnapshot(): Promise<ProviderId | undefined> {
    const config = await sendMessage('getProviderConfig', undefined);
    setConfiguredProviderIds(config.configuredProviderIds);
    setActive(config.activeProviderId);
    return config.activeProviderId ?? undefined;
  }

  function openSettings() {
    browser.runtime.openOptionsPage();
  }

  const isStart = !loading && !error && !response;
  const configuredProviders = providers.filter((p) => configuredProviderIds.includes(p.id));

  return (
    <div className={`app${isStart ? ' app--start' : ''}`}>
      <header className="topbar">
        <h1>{t(MSG.search_page_title)}</h1>
        <ProviderSwitcher providers={configuredProviders} active={active} onSwitch={handleSwitch} disabled={loading || switching} />
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
            <ResultList results={response.results} />
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
