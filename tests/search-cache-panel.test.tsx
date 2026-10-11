import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SearchCachePanel } from '@/components/SearchCachePanel';
import { sendMessage } from '@/lib/messaging';

vi.mock('@/lib/messaging', () => ({ sendMessage: vi.fn() }));

const storageListeners = new Set<(changes: Record<string, unknown>) => void>();
vi.stubGlobal('browser', {
  storage: {
    onChanged: {
      addListener: (listener: (changes: Record<string, unknown>) => void) => storageListeners.add(listener),
      removeListener: (listener: (changes: Record<string, unknown>) => void) => storageListeners.delete(listener),
    },
  },
});

const mockedSend = vi.mocked(sendMessage);

beforeEach(() => {
  vi.clearAllMocks();
  storageListeners.clear();
});

function installSummaries() {
  mockedSend.mockImplementation(((type: string) => {
    if (type === 'getSearchCacheSummaries') {
      return Promise.resolve([
        { id: 'cache-1', cacheKey: 'tavily:q', query: 'q', normalizedQuery: 'q', providerId: 'tavily', createdAt: 1, lastAccessedAt: 1, answerPreview: 'answer preview', resultPreviews: [{ title: 'Result A', url: 'https://a.test' }], resultCount: 1 },
      ]);
    }
    if (type === 'getCachedSearchEntry') {
      return Promise.resolve({
        id: 'cache-1',
        cacheKey: 'tavily:q',
        query: 'q',
        normalizedQuery: 'q',
        providerId: 'tavily',
        createdAt: 1,
        lastAccessedAt: 1,
        response: { query: 'q', provider: 'tavily', results: [] },
      });
    }
    return Promise.resolve(undefined);
  }) as never);
}

describe('SearchCachePanel', () => {
  it('renders cached search summaries and selects an entry', async () => {
    installSummaries();
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(<SearchCachePanel open onClose={onClose} onSelect={onSelect} />);

    fireEvent.click((await screen.findByText('q')).closest('button') as HTMLButtonElement);

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'cache-1' })));
    expect(onClose).toHaveBeenCalled();
    expect(screen.getByText('answer preview')).toBeInTheDocument();
    expect(screen.getByText('Result A')).toBeInTheDocument();
  });

  it('deletes one cached search', async () => {
    installSummaries();
    render(<SearchCachePanel open onClose={vi.fn()} onSelect={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: '删除 q' }));

    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('deleteCachedSearch', 'cache-1'));
  });

  it('clears all cached searches', async () => {
    installSummaries();
    render(<SearchCachePanel open onClose={vi.fn()} onSelect={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: '清空全部' }));

    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('clearSearchCache', undefined));
  });

  it('renders an empty state', async () => {
    mockedSend.mockResolvedValue([] as never);

    render(<SearchCachePanel open onClose={vi.fn()} onSelect={vi.fn()} />);

    expect(await screen.findByText('暂无搜索历史')).toBeInTheDocument();
  });

  // ── worker 侧失败（storage 不可用 / 扩展上下文失效）必须落到面板错误态，不得悬空 rejection ──

  it('shows an error state and keeps the panel open when loadEntry rejects', async () => {
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getSearchCacheSummaries') {
        return Promise.resolve([
          { id: 'cache-1', cacheKey: 'tavily:q', query: 'q', normalizedQuery: 'q', providerId: 'tavily', createdAt: 1, lastAccessedAt: 1, answerPreview: '', resultPreviews: [], resultCount: 0 },
        ]);
      }
      if (type === 'getCachedSearchEntry') {
        return Promise.reject(new Error('Extension context invalidated'));
      }
      return Promise.resolve(undefined);
    }) as never);
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<SearchCachePanel open onClose={onClose} onSelect={onSelect} />);

    fireEvent.click((await screen.findByText('q')).closest('button') as HTMLButtonElement);

    expect(await screen.findByRole('alert')).toHaveTextContent('操作失败，请重试');
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows an error state when a row delete rejects', async () => {
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getSearchCacheSummaries') {
        return Promise.resolve([
          { id: 'cache-1', cacheKey: 'tavily:q', query: 'q', normalizedQuery: 'q', providerId: 'tavily', createdAt: 1, lastAccessedAt: 1, answerPreview: '', resultPreviews: [], resultCount: 0 },
        ]);
      }
      if (type === 'deleteCachedSearch') {
        return Promise.reject(new Error('quota exceeded'));
      }
      return Promise.resolve(undefined);
    }) as never);
    render(<SearchCachePanel open onClose={vi.fn()} onSelect={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: '删除 q' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('操作失败，请重试');
  });

  it('shows an error state when clear rejects', async () => {
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getSearchCacheSummaries') {
        return Promise.resolve([
          { id: 'cache-1', cacheKey: 'tavily:q', query: 'q', normalizedQuery: 'q', providerId: 'tavily', createdAt: 1, lastAccessedAt: 1, answerPreview: '', resultPreviews: [], resultCount: 0 },
        ]);
      }
      if (type === 'clearSearchCache') {
        return Promise.reject(new Error('quota exceeded'));
      }
      return Promise.resolve(undefined);
    }) as never);
    render(<SearchCachePanel open onClose={vi.fn()} onSelect={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: '清空全部' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('操作失败，请重试');
  });

  // ── 聚合条目 label（R11/Oracle F4）：'aggregate' 哨兵 → i18n「聚合 · 实例名」 ──

  function installAggregateSummary() {
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getSearchCacheSummaries') {
        return Promise.resolve([
          { id: 'agg-cache-1', cacheKey: 'agg:abc:q', query: 'q', normalizedQuery: 'q', providerId: 'aggregate', instanceId: 'agg:abc', createdAt: 1, lastAccessedAt: 1, answerPreview: 'agg answer', resultPreviews: [{ title: 'Result A', url: 'https://a.test' }], resultCount: 1 },
        ]);
      }
      return Promise.resolve(undefined);
    }) as never);
  }

  it('labels an aggregate summary with the i18n aggregate prefix plus the instance name', async () => {
    installAggregateSummary();
    render(<SearchCachePanel open onClose={vi.fn()} onSelect={vi.fn()} aggNameById={{ 'agg:abc': '全家桶' }} />);

    // label 与相对时间同 span（拆分多文本节点）→ 按 class + includes 匹配。
    expect(await screen.findByText((_, element) => element?.classList.contains('history-meta') === true
      && (element.textContent ?? '').includes('聚合 · 全家桶'))).toBeInTheDocument();
  });

  it('falls back to the bare aggregate label when the instance name mapping is missing', async () => {
    installAggregateSummary();
    render(<SearchCachePanel open onClose={vi.fn()} onSelect={vi.fn()} />);

    expect(await screen.findByText((_, element) => element?.classList.contains('history-meta') === true
      && (element.textContent ?? '').includes('聚合'))).toBeInTheDocument();
  });
});
