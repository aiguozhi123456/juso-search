import { useEffect, useRef, useState } from 'react';
import type { NormalizedSearchResponse, ProviderId } from '@/lib/providers/types';
import { allProviders } from '@/lib/providers/registry';
import { getActiveProviderId, setActiveProviderId } from '@/lib/storage';
import { sendMessage } from '@/lib/messaging';
import type { SearchReply } from '@/lib/messaging';
import { SearchBox } from '@/components/SearchBox';
import { ProviderSwitcher } from '@/components/ProviderSwitcher';
import { AnswerCard } from '@/components/AnswerCard';
import { ResultList } from '@/components/ResultList';
import { Loading, Empty, ErrorState } from '@/components/States';

export default function App() {
  const providers = allProviders();
  const [active, setActive] = useState<ProviderId | null>(null);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<NormalizedSearchResponse | null>(null);
  const [error, setError] = useState<{ message: string; needKey: boolean } | null>(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    void getActiveProviderId().then(setActive);
  }, []);

  async function handleSearch(query: string) {
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
      setError({ message: '搜索失败，请稍后重试', needKey: false });
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }

  async function handleSwitch(id: ProviderId) {
    await setActiveProviderId(id);
    setActive(id);
  }

  function openSettings() {
    browser.runtime.openOptionsPage();
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>AI Search</h1>
        <ProviderSwitcher providers={providers} active={active} onSwitch={handleSwitch} />
      </header>
      <SearchBox onSearch={handleSearch} loading={loading} />
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
        {!loading && !error && !response && <Empty />}
      </main>
    </div>
  );
}
