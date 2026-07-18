import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { ProviderId } from '@/lib/providers/types';
import type { SearchCacheEntry, SearchCacheSummary } from '@/lib/search-cache';
import { allProviders } from '@/lib/providers/registry';
import { getCurrentLocale, t, MSG } from '@/lib/i18n';
import { useSearchCache } from '@/lib/useSearchCache';
import { CloseIcon, TrashIcon } from './icons';

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (entry: SearchCacheEntry) => void;
}

const providers = allProviders();

export function SearchCachePanel({ open, onClose, onSelect }: Props) {
  const { summaries, loading, loadEntry, deleteEntry, clear, refresh } = useSearchCache(open);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const selectReqIdRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => {
      selectReqIdRef.current += 1;
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open) return null;

  async function select(summary: SearchCacheSummary) {
    const reqId = ++selectReqIdRef.current;
    const entry = await loadEntry(summary.id);
    if (reqId !== selectReqIdRef.current) return; // 丢弃乱序的旧选择
    if (!entry) {
      await refresh();
      return;
    }
    onSelect(entry);
    closePanel();
  }

  function closePanel() {
    selectReqIdRef.current += 1;
    onClose();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closePanel();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>('button, a, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="history-overlay" role="presentation" onMouseDown={closePanel}>
      <aside ref={panelRef} className="history-panel" role="dialog" aria-modal="true" aria-label={t(MSG.history_title)} onMouseDown={(event) => event.stopPropagation()} onKeyDown={handleKeyDown}>
        <header className="history-panel-head">
          <h2>{t(MSG.history_title)}</h2>
          <button ref={closeRef} type="button" className="history-close" onClick={closePanel} aria-label={t(MSG.history_close)}>
            <CloseIcon size={16} />
          </button>
        </header>
        {summaries.length > 0 && (
          <button type="button" className="history-clear" onClick={() => void clear()}>
            {t(MSG.history_clear_all)}
          </button>
        )}
        {loading && <div className="state">{t(MSG.state_loading)}</div>}
        {!loading && summaries.length === 0 && <div className="state">{t(MSG.history_empty)}</div>}
        {!loading && summaries.length > 0 && (
          <div className="history-list">
            {summaries.map((summary) => (
              <article className="history-item" key={summary.id}>
                <button type="button" className="history-item-main" onClick={() => void select(summary)}>
                  <span className="history-query">{summary.query}</span>
                  <span className="history-meta">{providerLabel(summary.providerId)} · {relativeTime(summary.lastAccessedAt)}</span>
                  {summary.answerPreview && <span className="history-answer">{summary.answerPreview}</span>}
                  {summary.resultPreviews.length > 0 && (
                    <span className="history-results">
                      {summary.resultPreviews.map((result) => result.title).join(' · ')}
                    </span>
                  )}
                </button>
                <button type="button" className="history-delete" onClick={() => void deleteEntry(summary.id)} aria-label={t(MSG.history_delete_item, summary.query)}>
                  <TrashIcon size={14} />
                  <span>{t(MSG.history_delete)}</span>
                </button>
              </article>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}

function providerLabel(providerId: ProviderId): string {
  const provider = providers.find((candidate) => candidate.id === providerId);
  return provider ? t(provider.label) : providerId;
}

function relativeTime(timestamp: number): string {
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  const locale = getCurrentLocale() === 'zh_CN' ? 'zh-CN' : 'en';
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (abs < 60) return rtf.format(seconds, 'second');
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  return rtf.format(Math.round(hours / 24), 'day');
}
