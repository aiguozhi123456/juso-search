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
});
