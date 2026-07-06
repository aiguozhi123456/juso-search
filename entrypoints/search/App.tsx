import { useEffect, useRef, useState } from 'react';
import type { NormalizedSearchResponse, ProviderId } from '@/lib/providers/types';
import { allProviders } from '@/lib/providers/registry';
import { sendMessage } from '@/lib/messaging';
import type { SearchReply } from '@/lib/messaging';
import { SearchBox } from '@/components/SearchBox';
import { ProviderSwitcher } from '@/components/ProviderSwitcher';
import { SettingsButton } from '@/components/SettingsButton';
import { ThemeToggle } from '@/components/ThemeToggle';
import { AnswerCard } from '@/components/AnswerCard';
import { ResultList } from '@/components/ResultList';
import { Loading, ErrorState } from '@/components/States';
import { t, MSG } from '@/lib/i18n';

export default function App() {
  const providers = allProviders();
  const [query, setQuery] = useState('');
  const [configuredProviderIds, setConfiguredProviderIds] = useState<ProviderId[]>([]);
  const [active, setActive] = useState<ProviderId | null>(null);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [response, setResponse] = useState<NormalizedSearchResponse | null>(null);
  const [error, setError] = useState<{ message: string; needKey: boolean } | null>(null);
  const reqIdRef = useRef(0);
  const switchReqIdRef = useRef(0);

  useEffect(() => {
    void (async () => {
      const config = await sendMessage('getProviderConfig', undefined);
      setConfiguredProviderIds(config.configuredProviderIds);
      setActive(config.activeProviderId);
    })();
  }, []);

  async function handleSearch(rawQuery: string) {
    const query = rawQuery.trim();
    if (!query) return;
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    setResponse(null);
    try {
      const reply: SearchReply = await sendMessage('search', query);
      if (reqId !== reqIdRef.current) return; // 过期响应丢弃
      if (reply.ok) {
        setResponse(reply.response);
      } else {
        setError({ message: reply.error.message, needKey: reply.error.kind === 'keyMissing' });
      }
    } catch {
      if (reqId !== reqIdRef.current) return;
      setError({ message: t(MSG.search_failed_retry), needKey: false });
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
      if (nextQuery) await handleSearch(nextQuery);
    } finally {
      if (switchReqId === switchReqIdRef.current) setSwitching(false);
    }
  }

  function handleInterrupt() {
    reqIdRef.current += 1;
    setLoading(false);
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
          <ThemeToggle />
          <SettingsButton onClick={openSettings} />
        </div>
      </header>
      <SearchBox value={query} onChange={setQuery} onSearch={handleSearch} onInterrupt={handleInterrupt} loading={loading} />
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
            {response.answer && <AnswerCard answer={response.answer} />}
            <ResultList results={response.results} />
          </>
        )}
      </main>
    </div>
  );
}
