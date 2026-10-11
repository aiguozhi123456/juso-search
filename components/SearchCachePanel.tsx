import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ProviderId } from '@/lib/providers/types';
import type { SearchCacheEntry, SearchCacheSummary } from '@/lib/search-cache';
import { AGGREGATE_CACHE_PROVIDER_ID } from '@/lib/search-cache';
import { allProviders } from '@/lib/providers/registry';
import { t, MSG } from '@/lib/i18n';
import { useSearchCache } from '@/lib/useSearchCache';
import { relativeTime } from './relativeTime';
import { CloseIcon, TrashIcon } from './icons';

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (entry: SearchCacheEntry) => void;
  /** 聚合条目 label 解析（R11/Oracle F4）：agg 实例 id → 实例名；宿主从快照注入。
   *  'aggregate' 哨兵 summary 走专用分支显示 i18n「聚合 · 实例名」（无映射回退「聚合」）。 */
  aggNameById?: Record<string, string>;
}

const providers = allProviders();

export function SearchCachePanel({ open, onClose, onSelect, aggNameById }: Props) {
  const { summaries, loading, loadEntry, deleteEntry, clear, refresh } = useSearchCache(open);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const selectReqIdRef = useRef(0);
  // loadEntry/deleteEntry/clear 透传 worker 消息，worker 侧 storage 读取可能 reject
  // （扩展上下文失效 / 存储不可用）：面板需有失败反馈态，不能让 rejection 悬空。
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setActionError(null);
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
    setActionError(null);
    try {
      const entry = await loadEntry(summary.id);
      if (reqId !== selectReqIdRef.current) return; // 丢弃乱序的旧选择
      if (!entry) {
        await refresh();
        return;
      }
      onSelect(entry);
      closePanel();
    } catch {
      // 读缓存失败（乱序的旧失败同样丢弃）：保持面板打开并给出失败反馈。
      if (reqId !== selectReqIdRef.current) return;
      setActionError(t(MSG.history_action_failed));
    }
  }

  async function clearAll() {
    setActionError(null);
    try {
      await clear();
    } catch {
      // 清空失败：列表保持原状并提示，用户可重试。
      setActionError(t(MSG.history_action_failed));
    }
  }

  async function removeEntry(id: string) {
    setActionError(null);
    try {
      await deleteEntry(id);
    } catch {
      // 单条删除失败：条目保持原状并提示，用户可重试。
      setActionError(t(MSG.history_action_failed));
    }
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
          <button type="button" className="history-clear" onClick={() => void clearAll()}>
            {t(MSG.history_clear_all)}
          </button>
        )}
        {!loading && actionError && <div className="state" role="alert">{actionError}</div>}
        {loading && <div className="state">{t(MSG.state_loading)}</div>}
        {!loading && summaries.length === 0 && <div className="state">{t(MSG.history_empty)}</div>}
        {!loading && summaries.length > 0 && (
          <div className="history-list">
            {summaries.map((summary) => (
              <article className="history-item" key={summary.id}>
                <button type="button" className="history-item-main" onClick={() => void select(summary)}>
                  <span className="history-query">{summary.query}</span>
                  <span className="history-meta">{providerLabel(summary.providerId, summary.instanceId, aggNameById)} · {relativeTime(summary.lastAccessedAt)}</span>
                  {summary.answerPreview && <span className="history-answer">{summary.answerPreview}</span>}
                  {summary.resultPreviews.length > 0 && (
                    <span className="history-results">
                      {summary.resultPreviews.map((result) => result.title).join(' · ')}
                    </span>
                  )}
                </button>
                <button type="button" className="history-delete" onClick={() => void removeEntry(summary.id)} aria-label={t(MSG.history_delete_item, summary.query)}>
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

/** 历史条目 label（R11/Oracle F4）：'aggregate' 哨兵 → i18n「聚合 · $实例名」（映射缺失回退「聚合」）；
 *  solo 条目 → provider 标签。 */
function providerLabel(providerId: ProviderId | typeof AGGREGATE_CACHE_PROVIDER_ID, instanceId: string | undefined, aggNameById?: Record<string, string>): string {
  if (providerId === AGGREGATE_CACHE_PROVIDER_ID) {
    const name = instanceId ? aggNameById?.[instanceId] : undefined;
    return name ? t(MSG.history_aggregate_label, [name]) : t(MSG.aggregate_label);
  }
  const provider = providers.find((candidate) => candidate.id === providerId);
  return provider ? t(provider.label) : providerId;
}
